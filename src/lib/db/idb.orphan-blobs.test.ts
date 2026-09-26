import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import {
	getAllNotesMetadata,
	resolveDbName,
	hydrateNoteAttachments,
	pruneOrphanImageBlobs,
	putNote
} from '$lib/db/idb';
import type { Note, NoteImage } from '$lib/types';
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
