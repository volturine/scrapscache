import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import {
	getAllNotesMetadata,
	getStoredAttachmentVersions,
	resolveDbName,
	hydrateNoteAttachments,
	pruneOrphanImageBlobs,
	putNote
} from '#lib/db/idb.js';
import { sha256 } from '#lib/syncHash.js';
import type { Note, NoteImage } from '#lib/types.js';
import { TEST_WORKSPACE } from '../../tests/workspace';

function image(id: string, dataUrl: string): NoteImage {
	return {
		id,
		mime: 'image/png',
		dataUrl,
		createdAt: 1,
		contentHash: `hash-${id}`
	};
}

function note(id: string, images: NoteImage[]): Note {
	return {
		id,
		title: id,
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
		images
	};
}

async function storedImageKeys(): Promise<string[]> {
	const db = await openDB(resolveDbName(TEST_WORKSPACE));
	try {
		return (await db.getAllKeys('note-images')).map(String).sort();
	} finally {
		db.close();
	}
}

/**
 * Issue #82: metadata-only writes keep existing blobs by design (crash
 * safety), so a shrunk image list orphans the removed image's bytes. Boot
 * reclaims ownership with a GC sweep over unreferenced keys.
 */
describe('orphaned image blob reclamation', () => {
	it('reclaims blobs no note row references at boot', async () => {
		const original = note('n1', [
			image('kept', 'data:image/png;base64,QQ=='),
			image('gone', 'data:image/png;base64,Qg==')
		]);
		await putNote(TEST_WORKSPACE, original);
		expect(await storedImageKeys()).toEqual(['n1::gone', 'n1::kept']);

		// Crash-recovery style replay: byte-less metadata listing only 'kept'.
		await putNote(TEST_WORKSPACE, {
			...original,
			title: 'replayed from mirror',
			images: [image('kept', '')]
		});
		// The write itself must not drop bytes it cannot verify (crash safety).
		expect(await storedImageKeys()).toEqual(['n1::gone', 'n1::kept']);

		await pruneOrphanImageBlobs(TEST_WORKSPACE);

		expect(await storedImageKeys()).toEqual(['n1::kept']);
		const stored = (await getAllNotesMetadata(TEST_WORKSPACE)).find((item) => item.id === 'n1');
		expect(stored?.images?.map(({ id }) => id)).toEqual(['kept']);
		const hydrated = await hydrateNoteAttachments(TEST_WORKSPACE, stored!);
		expect(hydrated.images?.[0]?.dataUrl?.startsWith('data:image/png')).toBe(true);
	});

	it('keeps blobs that are still referenced after recovery reattaches them', async () => {
		await getAllNotesMetadata(TEST_WORKSPACE);
		const db = await openDB(resolveDbName(TEST_WORKSPACE));
		await db.put('note-images', { mime: 'image/png', bytes: Uint8Array.from([65]) }, 'lost::pic');
		db.close();

		const lost = note('lost', [image('pic', '')]);
		await putNote(TEST_WORKSPACE, lost);
		await pruneOrphanImageBlobs(TEST_WORKSPACE);

		expect(await storedImageKeys()).toEqual(['lost::pic']);
	});
});

describe('the version of stored attachment bytes', () => {
	it('lists which version is held without the note saying so', async () => {
		await putNote(TEST_WORKSPACE, note('n1', [image('pic', 'data:image/png;base64,QQ==')]));

		expect([...(await getStoredAttachmentVersions(TEST_WORKSPACE))]).toEqual([
			['n1::pic', 'hash-pic']
		]);
	});

	it('gives bytes stored before versions were kept the hash of what they are', async () => {
		await getAllNotesMetadata(TEST_WORKSPACE);
		const db = await openDB(resolveDbName(TEST_WORKSPACE));
		await db.put('note-images', { mime: 'image/png', bytes: Uint8Array.from([65]) }, 'n1::pic');
		db.close();

		expect([...(await getStoredAttachmentVersions(TEST_WORKSPACE))]).toEqual([
			['n1::pic', await sha256('data:image/png;base64,QQ==')]
		]);
	});

	it('does not read bytes as a version they are not', async () => {
		const first = image('pic', 'data:image/png;base64,QQ==');
		await putNote(TEST_WORKSPACE, note('n1', [first]));
		// The note moves on to another version whose bytes have not been stored.
		const listing = note('n1', [{ ...first, dataUrl: '', contentHash: 'hash-recropped' }]);
		await putNote(TEST_WORKSPACE, listing);

		const hydrated = await hydrateNoteAttachments(TEST_WORKSPACE, listing);

		expect(hydrated.images?.[0]?.dataUrl).toBe('');
		// The bytes are still there, under the version they are.
		expect((await getStoredAttachmentVersions(TEST_WORKSPACE)).get('n1::pic')).toBe('hash-pic');
	});
});
