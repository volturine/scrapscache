import { fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '$lib/types';
import { notesStore } from '$lib/stores/notes.svelte';
import NoteEditor from './NoteEditor.svelte';

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Title',
		body: 'Body',
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

/** Replace the stored note the way an applied sync does. */
function receiveSynced(partial: Partial<Note>) {
	notesStore.notes = notesStore.notes.map((item) =>
		item.id === 'note-1' ? { ...item, ...partial, updatedAt: item.updatedAt + 1 } : item
	);
}

function stored(): Note {
	return notesStore.notes.find((item) => item.id === 'note-1')!;
}

function lineTexts(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-line-text]')].map((line) =>
		(line.textContent ?? '').replaceAll('\u200b', '')
	);
}

function caretAtEnd(container: HTMLElement) {
	const text = container.querySelector('[data-line-text]')!;
	const range = document.createRange();
	range.selectNodeContents(text);
	range.collapse(false);
	window.getSelection()?.removeAllRanges();
	window.getSelection()?.addRange(range);
}

async function typeBody(container: HTMLElement, text: string) {
	const editor = container.querySelector('[data-body-editor]') as HTMLElement;
	caretAtEnd(container);
	for (const data of text) {
		editor.dispatchEvent(
			new InputEvent('beforeinput', {
				bubbles: true,
				cancelable: true,
				inputType: 'insertText',
				data
			})
		);
	}
	await tick();
}

async function typeTitle(container: HTMLElement, value: string) {
	const title = container.querySelector('textarea[placeholder="Title"]') as HTMLTextAreaElement;
	await fireEvent.input(title, { target: { value } });
}

function openEditor() {
	let close = () => {};
	const view = render(NoteEditor, {
		props: {
			noteId: 'note-1',
			onClose: () => {},
			registerClose: (fn: () => void) => {
				close = fn;
			}
		}
	});
	return { ...view, close: async () => close() };
}

beforeEach(() => {
	vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
	vi.spyOn(notesStore, 'flushNote').mockResolvedValue();
	vi.spyOn(notesStore, 'discardIfEmpty').mockResolvedValue();
	vi.spyOn(notesStore, 'syncPendingChanges').mockResolvedValue(false);
	notesStore.notes = [note()];
});

afterEach(() => {
	vi.restoreAllMocks();
	notesStore.notes = [];
});

describe('NoteEditor draft and synced changes', () => {
	it('shows a synced edit that arrives while the note is open', async () => {
		const { container } = openEditor();
		receiveSynced({ title: 'Synced title', body: 'Synced body' });
		await tick();

		const title = container.querySelector('textarea[placeholder="Title"]') as HTMLTextAreaElement;
		expect(title.value).toBe('Synced title');
		expect(lineTexts(container)).toEqual(['Synced body']);
	});

	it('saves only the field being typed, keeping a synced edit to another field', async () => {
		const update = vi.spyOn(notesStore, 'updateNote');
		const { container, close } = openEditor();

		await typeTitle(container, 'Local title');
		receiveSynced({ body: 'Synced body' });
		await tick();
		await close();

		expect(update.mock.calls.map(([, patch]) => Object.keys(patch))).toEqual([['title']]);
		expect(stored().title).toBe('Local title');
		expect(stored().body).toBe('Synced body');
	});

	it('keeps body typing over a synced body that arrives mid-edit', async () => {
		const { container, close } = openEditor();

		await typeBody(container, '!');
		receiveSynced({ title: 'Synced title', body: 'Synced body' });
		await tick();
		await close();

		expect(stored().body).toBe('Body!');
		expect(stored().title).toBe('Synced title');
	});

	it('saves text still being composed when the note closes', async () => {
		const { container, close } = openEditor();
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const line = container.querySelector('[data-line-text]') as HTMLElement;
		caretAtEnd(container);

		// An accent or a keyboard prediction: the browser writes it before it is final.
		await fireEvent.compositionStart(editor);
		line.firstChild!.textContent = 'Bodyé';
		await fireEvent.input(editor, { inputType: 'insertCompositionText', isComposing: true });
		await close();

		expect(stored().body).toBe('Bodyé');
	});

	it('writes nothing when a note is opened and closed without edits', async () => {
		const update = vi.spyOn(notesStore, 'updateNote');
		const { close } = openEditor();
		receiveSynced({ body: 'Synced body' });
		await tick();
		await close();

		expect(update).not.toHaveBeenCalled();
		expect(notesStore.flushNote).not.toHaveBeenCalled();
		expect(stored().body).toBe('Synced body');
	});
});
