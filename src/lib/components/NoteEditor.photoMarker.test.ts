import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteImage } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import NoteEditor from './NoteEditor.svelte';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

// jsdom has no canvas, so the optimizer cannot run; attach the pasted file as a photo as is.
vi.mock('#lib/noteImages.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/noteImages.js')>();
	return {
		...original,
		fileToNoteImage: async (file: File): Promise<NoteImage> => ({
			id: `img-${file.name}`,
			mime: file.type,
			dataUrl: PNG,
			name: file.name,
			createdAt: 1,
			contentHash: `hash-${file.name}`
		})
	};
});

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Beach day',
		body: 'Sunscreen\nThe cove:\nParking',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		...partial
	};
}

function pasteEvent(files: File[]): ClipboardEvent {
	const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
	Object.defineProperty(event, 'clipboardData', {
		value: {
			files,
			items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
			types: ['Files'],
			getData: () => '',
			setData: () => {},
			clearData: () => {}
		}
	});
	return event;
}

function lineTexts(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-body-editor] [data-line-text]')].map((line) =>
		(line.textContent ?? '').replaceAll('​', '')
	);
}

function caretAt(container: HTMLElement, lineIndex: number, offset: number) {
	const editor = container.querySelector('[data-body-editor]') as HTMLElement;
	const text = container.querySelectorAll('[data-body-editor] [data-line-text]')[lineIndex];
	const node = text.firstChild ?? text;
	editor.focus();
	const range = document.createRange();
	range.setStart(node, offset);
	range.collapse(true);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
	return editor;
}

beforeEach(() => {
	vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
	vi.spyOn(notesStore, 'flushNote').mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
	notesStore.notes = [];
	notesStore.labels = [];
});

describe('NoteEditor photo markers', () => {
	it('marks a pasted photo at the caret and leaves the caret on a blank line below', async () => {
		notesStore.notes = [note()];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const editor = caretAt(container, 1, 'The cove:'.length);

		editor.dispatchEvent(pasteEvent([new File(['x'], 'cove.png', { type: 'image/png' })]));
		await vi.waitFor(() => {
			expect(container.querySelector('#photo-quality-title')).not.toBeNull();
		});
		(document.querySelector('button[class*="primary"]') as HTMLButtonElement).click();

		await vi.waitFor(() => {
			expect(lineTexts(container)).toEqual([
				'Sunscreen',
				'The cove:',
				'![cove.png](photo:img-cove.png)',
				'',
				'Parking'
			]);
		});
		const chip = container.querySelector('[data-photo="img-cove.png"]');
		expect(chip?.textContent).toBe('cove.png');
		expect(chip?.className).not.toContain('markdown-token-photo-missing');
	});

	it('draws a marker whose photo is gone as inert', () => {
		notesStore.notes = [note({ body: '![old.png](photo:missing)', images: [] })];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		const chip = container.querySelector('[data-photo="missing"]');
		expect(chip?.className).toContain('markdown-token-photo-missing');
	});
});
