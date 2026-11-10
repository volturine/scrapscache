import { fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteImage } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { actionUndo } from '#lib/stores/actionUndo.svelte.js';
import NoteEditor from './NoteEditor.svelte';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function photo(id: string): NoteImage {
	return { id, mime: 'image/png', dataUrl: PNG, thumbUrl: PNG, name: `${id}.png`, createdAt: 1 };
}

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Beach day',
		body: '![shot.png](photo:shot)\nSunscreen',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		images: [photo('shot')],
		...partial
	};
}

beforeEach(() => {
	vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
	vi.spyOn(notesStore, 'flushNote').mockImplementation(async (id, patch) => {
		if (patch) notesStore.updateNote(id, patch);
	});
	actionUndo.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
	notesStore.notes = [];
	notesStore.labels = [];
});

describe('NoteEditor photo removal and undo', () => {
	it('brings a removed photo back to the strip and the store on Undo', async () => {
		notesStore.notes = [note()];
		const { getByRole, queryByRole } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const toggle = queryByRole('button', { name: 'Show previews' });
		if (toggle) await fireEvent.click(toggle);
		expect(getByRole('button', { name: 'Open shot.png' })).toBeTruthy();

		await fireEvent.click(getByRole('button', { name: 'Remove photo' }));
		await tick();
		expect(queryByRole('button', { name: 'Open shot.png' })).toBeNull();
		expect(notesStore.notes[0].images?.map((image) => image.id)).toEqual([]);
		expect(actionUndo.bar).toBe('Attachment removed');

		actionUndo.undo();
		await tick();
		await tick();
		expect(notesStore.notes[0].images?.map((image) => image.id)).toEqual(['shot']);
		expect(queryByRole('button', { name: 'Open shot.png' })).toBeTruthy();
	});

	it('takes the photo’s marker line out with it, and puts one back on Undo', async () => {
		notesStore.notes = [note()];
		const { getByRole, queryByRole, container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const lines = () =>
			[...container.querySelectorAll('[data-body-editor] [data-line-text]')].map((line) =>
				(line.textContent ?? '').replaceAll('​', '')
			);
		const toggle = queryByRole('button', { name: 'Show previews' });
		if (toggle) await fireEvent.click(toggle);
		expect(lines()).toEqual(['![shot.png](photo:shot)', 'Sunscreen']);

		await fireEvent.click(getByRole('button', { name: 'Remove photo' }));
		await tick();
		expect(lines()).toEqual(['Sunscreen']);
		expect(notesStore.notes[0].body).toBe('Sunscreen');

		actionUndo.undo();
		await tick();
		await tick();
		expect(notesStore.notes[0].images?.map((image) => image.id)).toEqual(['shot']);
		expect(lines()).toEqual(['![shot.png](photo:shot)', 'Sunscreen']);
		expect(notesStore.notes[0].body).toBe('![shot.png](photo:shot)\nSunscreen');

		actionUndo.redo();
		await tick();
		expect(lines()).toEqual(['Sunscreen']);
		expect(notesStore.notes[0].images).toEqual([]);
	});

	it('refuses a file too large to sync, with a message, and keeps the rest', async () => {
		notesStore.notes = [note({ body: 'Sunscreen', images: [] })];
		const { container, queryByRole } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const big = new File([new Uint8Array(9 * 1024 * 1024)], 'clip.mp4', { type: 'video/mp4' });
		const small = new File([new Uint8Array(16)], 'notes.txt', { type: 'text/plain' });
		const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
		Object.defineProperty(event, 'clipboardData', {
			value: {
				files: [big, small],
				items: [big, small].map((file) => ({
					kind: 'file',
					type: file.type,
					getAsFile: () => file
				})),
				types: ['Files'],
				getData: () => ''
			}
		});
		container.querySelector('[data-body-editor]')!.dispatchEvent(event);
		await new Promise((resolve) => setTimeout(resolve, 50));
		await tick();
		expect(container.textContent).toMatch(
			/clip\.mp4 is 9(\.0)? MB; a file over 8(\.0)? MB cannot sync, so it was not added\./
		);
		expect(queryByRole('button', { name: 'Open clip.mp4' })).toBeNull();
		expect(queryByRole('button', { name: 'Open notes.txt' })).toBeTruthy();
	});
});
