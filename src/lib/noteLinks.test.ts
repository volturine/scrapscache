import { describe, expect, it } from 'vitest';
import { profileForWorkspaceTag, readNoteLink, withNoteLink, workspaceLinkTag } from './noteLinks';
import { identityFromSyncKey } from './syncPairing';

const KEY_A = 'A'.repeat(43);
const KEY_B = 'B'.repeat(43);
const synced = { id: 'profile-on-this-device', syncKey: KEY_A };
const home = new URL('https://scrapscache.com/');

describe('note addresses', () => {
	it('names a synced workspace the same on every device that holds its key', () => {
		const elsewhere = { id: 'another-device-profile-id', syncKey: KEY_A };

		expect(workspaceLinkTag(synced)).toBe(workspaceLinkTag(elsewhere));
		expect(workspaceLinkTag(synced)).not.toBe(workspaceLinkTag({ id: synced.id, syncKey: KEY_B }));
	});

	it('reveals neither the sync key nor the account id', () => {
		const address = withNoteLink(home, { profile: synced, noteId: 'note-1' });
		const { accountId } = identityFromSyncKey(KEY_A);

		expect(address).not.toContain(KEY_A);
		expect(address).not.toContain(accountId);
		expect(address).not.toContain(synced.id);
	});

	it('names a private workspace by its local id', () => {
		const local = { id: 'local-profile', syncKey: '' };

		expect(workspaceLinkTag(local)).toBe(workspaceLinkTag({ ...local }));
		expect(workspaceLinkTag(local)).not.toBe(workspaceLinkTag({ id: 'other', syncKey: '' }));
	});

	it('round-trips an open note and its workspace through the address', () => {
		const address = new URL(withNoteLink(home, { profile: synced, noteId: 'note/1?x' }), home);
		const target = readNoteLink(address);

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

	it('changes only the note in the address, keeping the view and anything else', () => {
		const archive = new URL('https://scrapscache.com/archive?w=old&note=n0&pair=x#top');
		const opened = withNoteLink(archive, { profile: synced, noteId: 'n1' });

		expect(opened).toBe(`/archive?pair=x&w=${workspaceLinkTag(synced)}&note=n1#top`);
		expect(withNoteLink(new URL(opened, archive), null)).toBe('/archive?pair=x#top');
	});
});
