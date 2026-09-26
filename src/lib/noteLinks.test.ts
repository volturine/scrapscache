import { describe, expect, it } from 'vitest';
import {
	noteLink,
	profileForWorkspaceTag,
	readNoteLink,
	withoutNoteLink,
	workspaceLinkTag
} from './noteLinks';
import { identityFromSyncKey } from './syncPairing';

const KEY_A = 'A'.repeat(43);
const KEY_B = 'B'.repeat(43);
const synced = { id: 'profile-on-this-device', syncKey: KEY_A };

describe('note links', () => {
	it('names a synced workspace the same on every device that holds its key', () => {
		const elsewhere = { id: 'another-device-profile-id', syncKey: KEY_A };

		expect(workspaceLinkTag(synced)).toBe(workspaceLinkTag(elsewhere));
		expect(workspaceLinkTag(synced)).not.toBe(workspaceLinkTag({ id: synced.id, syncKey: KEY_B }));
	});

	it('reveals neither the sync key nor the account id', () => {
		const link = noteLink('https://scrapscache.com', synced, 'note-1');
		const { accountId } = identityFromSyncKey(KEY_A);

		expect(link).not.toContain(KEY_A);
		expect(link).not.toContain(accountId);
		expect(link).not.toContain(synced.id);
	});

	it('names a private workspace by its local id', () => {
		const local = { id: 'local-profile', syncKey: '' };

		expect(workspaceLinkTag(local)).toBe(workspaceLinkTag({ ...local }));
		expect(workspaceLinkTag(local)).not.toBe(workspaceLinkTag({ id: 'other', syncKey: '' }));
	});

	it('round-trips a note and its workspace through a URL', () => {
		const link = new URL(noteLink('https://scrapscache.com', synced, 'note/1?x'));
		const target = readNoteLink(link);

		expect(target).toEqual({ noteId: 'note/1?x', workspaceTag: workspaceLinkTag(synced) });
		expect(
			profileForWorkspaceTag([{ id: 'p', syncKey: KEY_B }, synced], target!.workspaceTag!)
		).toBe(synced);
		expect(profileForWorkspaceTag([{ id: 'p', syncKey: KEY_B }], target!.workspaceTag!)).toBeNull();
	});

	it('reads a reminder link, which carries no workspace', () => {
		expect(readNoteLink(new URL('https://scrapscache.com/?note=n1'))).toEqual({
			noteId: 'n1',
			workspaceTag: null
		});
		expect(readNoteLink(new URL('https://scrapscache.com/?pair=x'))).toBeNull();
	});

	it('drops only the link from the address once it is handled', () => {
		const url = new URL('https://scrapscache.com/archive?w=t&note=n1&pair=x#top');

		expect(withoutNoteLink(url)).toBe('/archive?pair=x#top');
	});
});
