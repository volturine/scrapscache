import { describe, expect, it } from 'vitest';
import type { Label, Note } from '#lib/types.js';
import { readNotesMirror, writeNotesMirror, clearNotesMirror } from './noteStorage';
import { readProfiles } from './profiles';
import {
	estimateProfileBytes,
	getAllLabels,
	getAllNotesMetadata,
	getFiredReminderKeys,
	getSyncOutboxKeys,
	getSyncState,
	markSyncOutbox,
	putLabel,
	putNote,
	addFiredReminderKeys
} from '#lib/db/idb.js';
import {
	buildProfileMarkdownNotes,
	getLastActiveProfileId,
	isLocalWorkspace,
	loadProfiles,
	nextProfileName,
	pickBootProfile,
	profileForSyncKey,
	saveProfile,
	setLastActiveProfileId,
	type StoredProfile,
	mcpWorkspaceGrant
} from './profiles';
import {
	hydrateTombstones,
	writeTombstones,
	writeLabelTombstones,
	NOTE_IDB
} from './syncTombstones';

function note(id: string): Note {
	return {
		id,
		title: `title-${id}`,
		body: '',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		images: []
	};
}

function label(id: string): Label {
	return { id, name: `label-${id}`, createdAt: 1, updatedAt: 1 };
}

describe('profile namespaces', () => {
	it('keeps notes, labels, outbox, tombstones, and reminders isolated per profile', async () => {
		await putNote('p-one', note('shared-id'));
		await putNote('p-two', note('other-note'));
		await putLabel('p-one', label('label-1'));
		await markSyncOutbox('p-one', ['note:shared-id']);
		await writeTombstones('p-one', { gone: 5 });
		await addFiredReminderKeys('p-one', ['wake-1']);

		expect((await getAllNotesMetadata('p-one')).map(({ id }) => id)).toEqual(['shared-id']);
		expect((await getAllNotesMetadata('p-two')).map(({ id }) => id)).toEqual(['other-note']);
		expect((await getAllLabels('p-two')).map(({ id }) => id)).toEqual([]);
		expect(await getSyncOutboxKeys('p-two')).toEqual([]);
		expect(await getSyncState('p-two', NOTE_IDB)).toBeUndefined();
		expect(await getFiredReminderKeys('p-two')).toEqual([]);
		await hydrateTombstones('p-two');
		expect((await hydrateTombstones('p-two')).notes).toEqual({});
		expect(await getFiredReminderKeys('p-two')).toEqual([]);
	});
});

describe('per-profile size estimation', () => {
	it('grows with stored notes and stays separate per profile', async () => {
		expect(await estimateProfileBytes('p-empty')).toBe(0);
		await putNote('p-full', note('n1'));
		expect(await estimateProfileBytes('p-full')).toBeGreaterThan(0);
	});

	it('shows the same size on every device, whatever previews each one rendered', async () => {
		const photo = (thumbUrl?: string) => ({
			...note('photo-note'),
			images: [
				{
					id: 'photo',
					mime: 'image/jpeg',
					dataUrl: '',
					createdAt: 1,
					byteSize: 50_000,
					...(thumbUrl ? { thumbUrl } : {})
				}
			]
		});
		// Different browsers encode the preview differently; one may not have made it yet.
		await putNote('p-phone', photo(`data:image/jpeg;base64,${'a'.repeat(4_000)}`));
		await putNote('p-desktop', photo(`data:image/jpeg;base64,${'b'.repeat(3_000)}`));
		await putNote('p-new', photo());
		const phone = await estimateProfileBytes('p-phone');
		expect(await estimateProfileBytes('p-desktop')).toBe(phone);
		expect(await estimateProfileBytes('p-new')).toBe(phone);
	});
});

describe('single-profile Markdown export source', () => {
	it('reads workspace notes with attachment bytes without activating that workspace', async () => {
		await putNote('p-exp', note('exported'));
		const attachment = {
			id: 'photo',
			mime: 'image/png',
			dataUrl: 'data:image/png;base64,AQID',
			createdAt: 1
		};
		await putNote('p-exp', { ...note('photo-note'), images: [attachment] });
		await putNote('p-exp', { ...note('hidden'), secret: true });
		await putNote('p-other', note('other'));

		const notes = await buildProfileMarkdownNotes('p-exp');

		expect(notes?.map(({ id }) => id).sort()).toEqual(['exported', 'hidden', 'photo-note']);
		expect(notes?.find(({ id }) => id === 'photo-note')?.images?.[0]?.dataUrl).toBe(
			attachment.dataUrl
		);
		expect(notes?.find(({ id }) => id === 'hidden')?.secret).toBe(true);
		expect((await buildProfileMarkdownNotes('p-other'))?.map(({ id }) => id)).toEqual(['other']);
		expect(await buildProfileMarkdownNotes('p-empty')).toBeNull();
	});
});

describe('local workspaces', () => {
	it('treats empty sync keys as local-only and ignores them when matching keys', () => {
		const local: StoredProfile = { id: 'local', name: 'Studio', syncKey: '', createdAt: 1 };
		const synced: StoredProfile = { id: 'synced', name: 'Cloud', syncKey: 'k-cloud', createdAt: 2 };
		expect(isLocalWorkspace(local)).toBe(true);
		expect(isLocalWorkspace(synced)).toBe(false);
		expect(profileForSyncKey([local, synced], '')).toBeNull();
		expect(profileForSyncKey([local, synced], 'k-cloud')).toBe(synced);
	});
	it('formats a single synced workspace grant and ignores local workspaces', () => {
		const local: StoredProfile = { id: 'local', name: 'Studio', syncKey: '', createdAt: 1 };
		const cloud: StoredProfile = { id: 'cloud', name: 'Cloud', syncKey: 'k-cloud', createdAt: 2 };

		expect(mcpWorkspaceGrant([cloud, local])).toEqual([{ name: 'Cloud', syncKey: 'k-cloud' }]);
	});
});

describe('keyring boot selection', () => {
	it('prefers the pointer, then the first entry, and names later keys by count', () => {
		const first: StoredProfile = {
			id: 'a',
			name: 'First',
			syncKey: 'k-a',
			createdAt: 1
		};
		const second: StoredProfile = { id: 'b', name: 'Second', syncKey: 'k-b', createdAt: 2 };

		localStorage.clear();
		sessionStorage.clear();
		expect(pickBootProfile([first, second])).toBe(first);

		localStorage.setItem('scrapscache-last-active-profile', 'b');
		expect(pickBootProfile([first, second])).toBe(second);
		// A generated name is a fresh two-word pair, never one already on the device.
		const generated = nextProfileName([first, second]);
		expect(generated).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
		expect([first.name, second.name]).not.toContain(generated);
		void saveProfile;
		void loadProfiles;
	});
});

describe('per-tab active-profile pointer', () => {
	it('a tab refresh restores its own workspace before the shared pointer', () => {
		localStorage.clear();
		sessionStorage.clear();
		const first: StoredProfile = { id: 'tab-a', name: 'TabA', syncKey: 'k-a', createdAt: 1 };
		const second: StoredProfile = { id: 'tab-b', name: 'TabB', syncKey: 'k-b', createdAt: 2 };

		// Another tab switched later, moving the shared pointer.
		setLastActiveProfileId('tab-b');
		// This tab had switched earlier and keeps its own pointer from that time.
		sessionStorage.setItem('scrapscache-last-active-profile-tab', 'tab-a');

		expect(getLastActiveProfileId()).toBe('tab-a');
		expect(pickBootProfile([first, second])).toBe(first);

		// Without a per-tab pointer (fresh window), the shared pointer applies.
		sessionStorage.clear();
		expect(pickBootProfile([first, second])).toBe(second);
	});

	it('writes both pointers together and clears both on null', () => {
		localStorage.clear();
		sessionStorage.clear();
		setLastActiveProfileId('tab-a');
		expect(sessionStorage.getItem('scrapscache-last-active-profile-tab')).toBe('tab-a');
		expect(localStorage.getItem('scrapscache-last-active-profile')).toBe('tab-a');

		setLastActiveProfileId(null);
		expect(sessionStorage.getItem('scrapscache-last-active-profile-tab')).toBeNull();
		expect(localStorage.getItem('scrapscache-last-active-profile')).toBeNull();
	});
});

describe('profile localStorage mirror isolation', () => {
	it('scopes mirrors by profile ID without cross-profile leakage', () => {
		localStorage.clear();
		const n1 = note('note-p1');
		const n2 = note('note-p2');

		writeNotesMirror([n1], 'p-one');
		writeNotesMirror([n2], 'p-two');

		expect(readNotesMirror('p-one').map((n) => n.id)).toEqual(['note-p1']);
		expect(readNotesMirror('p-two').map((n) => n.id)).toEqual(['note-p2']);
		expect(readNotesMirror('p-empty')).toEqual([]);
	});
});

describe('readProfiles and clearNotesMirror', () => {
	it('synchronously loads stored profiles from localStorage', () => {
		localStorage.clear();
		expect(readProfiles()).toEqual([]);

		const p1: StoredProfile = { id: 'p-1', name: 'P1', syncKey: 'k1', createdAt: 100 };
		const p2: StoredProfile = { id: 'p-2', name: 'P2', syncKey: 'k2', createdAt: 50 };
		localStorage.setItem('scrapscache-sync-profiles', JSON.stringify([p1, p2]));

		const loaded = readProfiles();
		expect(loaded.map((p) => p.id)).toEqual(['p-2', 'p-1']);
	});

	it('clearNotesMirror removes only target profile mirrors', () => {
		localStorage.clear();
		writeNotesMirror([note('n-1')], 'p-target');
		writeNotesMirror([note('n-2')], 'p-other');

		expect(readNotesMirror('p-target')).toHaveLength(1);
		expect(readNotesMirror('p-other')).toHaveLength(1);

		clearNotesMirror('p-target');
		expect(readNotesMirror('p-target')).toEqual([]);
		expect(readNotesMirror('p-other')).toHaveLength(1);
	});
});
