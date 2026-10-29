import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { composerStore } from '#lib/stores/composer.svelte.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { syncStore } from '#lib/stores/sync.svelte.js';
import NoteComposer from './NoteComposer.svelte';

const openNote = vi.fn();
vi.mock('#lib/editorContext.js', () => ({
	useEditorActions: () => ({ startNewNote: vi.fn(), openNote, closeNote: vi.fn() })
}));

const prompt = () => screen.getByRole('button', { name: /^Take a note/ });
const titleBox = () => screen.getByPlaceholderText('Title', { exact: true }) as HTMLTextAreaElement;

async function typeTitle(text: string) {
	const box = titleBox();
	box.value = text;
	await fireEvent.input(box);
	// The bar saves 800 ms after the last key.
	await new Promise((done) => setTimeout(done, 900));
}

describe('NoteComposer', () => {
	beforeEach(() => {
		localStorage.clear();
		const account = createSyncIdentity();
		const profile = { id: 'composer', name: 'Composer', syncKey: account.syncKey, createdAt: 1 };
		syncStore.profiles = [profile];
		syncStore.activateProfile(profile);
		notesStore.notes = [];
		notesStore.labels = [];
	});

	afterEach(() => {
		const internals = notesStore as unknown as {
			dirty: boolean;
			syncPushTimer: ReturnType<typeof setTimeout> | null;
		};
		if (internals.syncPushTimer) clearTimeout(internals.syncPushTimer);
		internals.syncPushTimer = null;
		internals.dirty = false;
		syncStore.account = null;
		syncStore.profiles = [];
		notesStore.notes = [];
		composerStore.draftId = null;
		openNote.mockClear();
	});

	it('opens from the bar with the cursor in the title and writes the note once something is typed', async () => {
		render(NoteComposer);
		await fireEvent.click(prompt());
		await tick();
		expect(document.activeElement).toBe(titleBox());
		expect(screen.getByRole('textbox', { name: 'Note body' })).toBeTruthy();
		// A blank bar is not a note yet.
		expect(notesStore.notes).toHaveLength(0);

		await typeTitle('Milk');
		expect(notesStore.notes).toHaveLength(1);
		expect(notesStore.notes[0].title).toBe('Milk');
		// The feed leaves the note out while it is being written.
		expect(composerStore.draftId).toBe(notesStore.notes[0].id);
		expect(notesStore.activeNotes).toHaveLength(0);

		await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
		await waitFor(() => expect(composerStore.draftId).toBeNull());
		expect(notesStore.activeNotes.map((note) => note.title)).toEqual(['Milk']);
		expect(prompt()).toBeTruthy();
	});

	it('makes no note of blank space, and drops a note emptied again on Escape', async () => {
		render(NoteComposer);
		await fireEvent.click(prompt());
		await typeTitle('   ');
		expect(notesStore.notes).toHaveLength(0);
		await typeTitle('Milk');
		expect(notesStore.notes).toHaveLength(1);
		await typeTitle('');
		await fireEvent.keyDown(screen.getByRole('region', { name: 'New note' }), { key: 'Escape' });
		// The note goes before discardIfEmpty settles, and the draft is let go after it.
		await waitFor(() => {
			expect(notesStore.notes).toHaveLength(0);
			expect(composerStore.draftId).toBeNull();
		});
	});

	it('starts a checklist from its button, and leaves nothing behind when it stays empty', async () => {
		const { container } = render(NoteComposer);
		await fireEvent.click(screen.getByRole('button', { name: 'New checklist' }));
		await tick();
		expect(container.querySelector('[data-checklist-toggle]')).toBeTruthy();
		const body = screen.getByRole('textbox', { name: 'Note body' });
		await waitFor(() => expect(body.contains(document.activeElement)).toBe(true));
		expect(notesStore.notes).toHaveLength(0);
		await fireEvent.keyDown(screen.getByRole('region', { name: 'New note' }), { key: 'Escape' });
		await waitFor(() => expect(prompt()).toBeTruthy());
		expect(notesStore.notes).toHaveLength(0);
	});

	it('keeps the cursor in the body when asked to open while already open', async () => {
		render(NoteComposer);
		await fireEvent.click(prompt());
		await tick();
		const body = screen.getByRole('textbox', { name: 'Note body' });
		await fireEvent.keyDown(titleBox(), { key: 'Enter' });
		await waitFor(() => expect(body.contains(document.activeElement)).toBe(true));
		expect(composerStore.open()).toBe(true);
		await tick();
		await tick();
		expect(body.contains(document.activeElement)).toBe(true);
	});

	it('keeps the caret mid-word in the title when asked to open while already open', async () => {
		render(NoteComposer);
		await fireEvent.click(prompt());
		await tick();
		await typeTitle('Shoping');
		const box = titleBox();
		box.focus();
		box.setSelectionRange(4, 4);
		expect(composerStore.open()).toBe(true);
		// Long enough for the body's own focus, which waits for its first paint.
		await new Promise((done) => setTimeout(done, 100));
		expect(document.activeElement).toBe(box);
		expect(box.selectionStart).toBe(4);
	});

	it('hands the note to the editor with what was typed', async () => {
		render(NoteComposer);
		await fireEvent.click(prompt());
		await typeTitle('Plan');
		await fireEvent.click(screen.getByRole('button', { name: 'Open in the editor' }));
		expect(openNote).toHaveBeenCalledWith(notesStore.notes[0].id);
		expect(composerStore.draftId).toBeNull();
		expect(notesStore.activeNotes).toHaveLength(1);
	});

	it('takes pasted text as a note at once, with the view’s label and reminder', async () => {
		notesStore.labels = [{ id: 'work', name: 'Work', createdAt: 1, updatedAt: 1 }];
		render(NoteComposer, { props: { labels: ['work'], reminderDay: '2030-01-07' } });
		expect(composerStore.open({ body: 'pasted text' })).toBe(true);
		await tick();
		expect(notesStore.notes).toHaveLength(1);
		expect(notesStore.notes[0]).toMatchObject({ body: 'pasted text', labels: ['work'] });
		expect(new Date(notesStore.notes[0].reminder as number).getFullYear()).toBe(2030);
		expect(screen.getByRole('button', { name: 'Edit reminder' })).toBeTruthy();
	});

	it('opens labels on a blank bar by writing the note first', async () => {
		notesStore.labels = [{ id: 'work', name: 'Work', createdAt: 1, updatedAt: 1 }];
		render(NoteComposer);
		await fireEvent.click(prompt());
		await fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
		expect(screen.queryByText('Save the note first to add labels')).toBeNull();
		expect(notesStore.notes).toHaveLength(1);
		expect(composerStore.draftId).toBe(notesStore.notes[0].id);
		expect(await screen.findByRole('dialog')).toBeTruthy();
	});

	it('adds a paste to an open bar instead of dropping it', async () => {
		render(NoteComposer);
		await fireEvent.click(prompt());
		await typeTitle('Shopping');
		expect(composerStore.open({ body: 'eggs' })).toBe(true);
		expect(composerStore.open({ title: 'retro' })).toBe(true);
		await tick();
		expect(notesStore.notes).toHaveLength(1);
		expect(notesStore.notes[0]).toMatchObject({ title: 'Shopping', body: 'eggs\nretro' });
	});
});
