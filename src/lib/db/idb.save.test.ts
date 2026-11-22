import { describe, expect, it } from 'vitest';
import {
	applyNoteEdit,
	createEditContext,
	mergeTwoNotes,
	stableStringify,
	stampNewNote
} from '#lib/model/index.js';
import type { Note } from '#lib/types.js';
import {
	getAllNotesMetadata,
	getSyncOutboxKeys,
	hydrateNoteAttachments,
	mergeNote,
	putNote,
	saveNote
} from './idb';
import { TEST_WORKSPACE } from '../../tests/workspace';

// Every edit is saved merged with the copy stored at that moment. The database
// only moves forward: a window, a sync and another window can save the same note
// in any order, and none of them goes over what another saved.

function blank(id: string): Note {
	return {
		id,
		title: '',
		body: '',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1_000,
		updatedAt: 1_000,
		reminder: null,
		labels: [],
		images: []
	};
}

const stored = async (id: string) =>
	(await getAllNotesMetadata(TEST_WORKSPACE)).find((note) => note.id === id);

describe('saving an edited note', () => {
	it('stores what the window holds when the stored copy is an earlier one of the same note', () => {
		let now = 2_000;
		const context = createEditContext(() => now);
		const versions = [stampNewNote(blank('lineage'), context.writer)];
		const edit = (patch: Parameters<typeof applyNoteEdit>[1], tick = 1) => {
			now += tick;
			versions.push(applyNoteEdit(versions.at(-1)!, patch, context));
		};
		let body = '';
		for (const letter of 'A body typed\nletter by letter') {
			body += letter;
			// Several edits land within one millisecond.
			edit({ body }, body.length % 3 ? 0 : 1);
		}
		edit({ title: 'Titled' });
		edit({ body: body.replace('typed', 'retyped') });
		edit({
			images: [
				{ id: 'photo', mime: 'image/png', dataUrl: 'data:image/png;base64,QQ==', createdAt: 5 }
			]
		});
		edit({ labels: ['label'] });
		edit({ images: [] });
		edit({ body: '' });
		edit({ body: 'Written again from nothing' });
		edit({ reminder: 9_999 });
		edit({ trashed: true, trashedAt: 123, pinned: false });

		// Whichever earlier copy is stored, the merge is the later one, field for field.
		const fields = ({ bodyDoc: _doc, ...rest }: Note) => stableStringify(rest);
		for (let earlier = 0; earlier < versions.length; earlier += 1) {
			for (let later = earlier; later < versions.length; later += 1) {
				const merged = mergeTwoNotes(versions[earlier], versions[later]);
				expect(fields(merged)).toBe(fields(versions[later]));
				expect(stableStringify(mergeTwoNotes(versions[later], versions[earlier]))).toBe(
					stableStringify(merged)
				);
			}
		}
	});

	it('keeps what a sync saved meanwhile, and queues the edit to upload in the same step', async () => {
		const context = createEditContext(() => 5_000);
		const opened = stampNewNote(blank('raced'), context.writer);
		await putNote(TEST_WORKSPACE, opened);
		// A sync saves a title another device wrote; the window still holds the copy it opened.
		const elsewhere = createEditContext(() => 4_000);
		const pulled = applyNoteEdit(opened, { title: 'Titled elsewhere' }, elsewhere);
		await mergeNote(TEST_WORKSPACE, pulled, (now) => mergeTwoNotes(now!, pulled));

		await saveNote(TEST_WORKSPACE, applyNoteEdit(opened, { pinned: true }, context), [
			'note:raced'
		]);

		expect(await stored('raced')).toMatchObject({ title: 'Titled elsewhere', pinned: true });
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['note:raced']);
	});

	it('keeps the later write of one field, whichever is saved last', async () => {
		const here = createEditContext(() => 3_000);
		const elsewhere = createEditContext(() => 9_000);
		const opened = stampNewNote(blank('same-field'), here.writer);
		await putNote(TEST_WORKSPACE, opened);
		await saveNote(TEST_WORKSPACE, applyNoteEdit(opened, { title: 'Later' }, elsewhere));

		await saveNote(TEST_WORKSPACE, applyNoteEdit(opened, { title: 'Earlier' }, here));

		expect((await stored('same-field'))?.title).toBe('Later');
	});

	// The relay corrects this device's clock, which can step it back behind stamps
	// it has already written. What is done after still has to come after.
	it('keeps a photo removed, replaced or put back on a clock that is behind the stored copy', async () => {
		let now = 9_000;
		const context = createEditContext(() => now);
		const first = 'data:image/png;base64,QUJD';
		const second = 'data:image/png;base64,REVG';
		const photo = { id: 'shot', mime: 'image/png', dataUrl: first, createdAt: 5 };
		let held = applyNoteEdit(
			stampNewNote(blank('behind'), context.writer),
			{ images: [photo] },
			context
		);
		await saveNote(TEST_WORKSPACE, held);
		const listed = async () => {
			const saved = await hydrateNoteAttachments(TEST_WORKSPACE, (await stored('behind'))!);
			return (saved.images ?? []).map((image) => image.dataUrl);
		};

		now = 2_000;
		held = applyNoteEdit(held, { images: [{ ...photo, dataUrl: second }] }, context);
		await saveNote(TEST_WORKSPACE, held);
		expect(await listed()).toEqual([second]);

		const removed = applyNoteEdit(held, { images: [] }, context);
		await saveNote(TEST_WORKSPACE, removed);
		expect(await listed()).toEqual([]);

		// Undo puts it back, bytes and all.
		await saveNote(TEST_WORKSPACE, applyNoteEdit(removed, { images: held.images }, context));
		expect(await listed()).toEqual([second]);
	});

	it('keeps a photo’s bytes when the note is saved again without them', async () => {
		const context = createEditContext(() => 5_000);
		const dataUrl = 'data:image/png;base64,QUJD';
		const withPhoto = applyNoteEdit(
			stampNewNote(blank('photo'), context.writer),
			{ images: [{ id: 'shot', mime: 'image/png', dataUrl, createdAt: 5 }] },
			context
		);
		await saveNote(TEST_WORKSPACE, withPhoto);
		// Memory lets go of the bytes once they are saved; the next edit comes without them.
		const lean = {
			...withPhoto,
			images: withPhoto.images!.map((image) => ({ ...image, dataUrl: '' }))
		};

		await saveNote(TEST_WORKSPACE, applyNoteEdit(lean, { title: 'Captioned' }, context));

		const saved = await hydrateNoteAttachments(TEST_WORKSPACE, (await stored('photo'))!);
		expect(saved.title).toBe('Captioned');
		expect(saved.images?.[0].dataUrl).toBe(dataUrl);
	});
});
