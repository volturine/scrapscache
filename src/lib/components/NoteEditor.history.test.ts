import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteHistoryEntry } from '$lib/historyClient';
import { notesStore } from '$lib/stores/notes.svelte';
import { syncStore } from '$lib/stores/sync.svelte';
import type { SyncNote } from '$lib/syncRecords';
import type { Note } from '$lib/types';
import NoteEditor from './NoteEditor.svelte';

const history = vi.hoisted(() => ({
	loadNoteHistory: vi.fn(),
	hydrateHistoryNote: vi.fn()
}));
vi.mock('$lib/historyClient', () => history);

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Reading list',
		body: 'Antifragile\nSapiens',
		color: 'blue',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 20,
		reminder: null,
		labels: [],
		...partial
	};
}

function syncNote(partial: Partial<Note> = {}): SyncNote {
	const { images: _images, ...value } = note(partial);
	return value;
}

const earlier: NoteHistoryEntry = {
	historyId: 10,
	savedAt: 10_000,
	note: syncNote({ title: 'Books', body: 'Antifragile', updatedAt: 10 })
};

beforeEach(() => {
	vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
	Element.prototype.scrollIntoView = vi.fn();
	vi.spyOn(notesStore, 'syncPendingChanges').mockResolvedValue(true);
	syncStore.account = {
		syncKey: 'test-key',
		accountId: 'test-account',
		authPublicKey: 'test-public',
		pairingCode: 'test-code'
	};
	notesStore.notes = [note()];
	history.loadNoteHistory.mockResolvedValue({ entries: [earlier], nextBefore: null });
	history.hydrateHistoryNote.mockImplementation(async (_account, entry: NoteHistoryEntry) => ({
		...entry.note,
		images: []
	}));
});

afterEach(() => {
	vi.restoreAllMocks();
	syncStore.account = null;
	notesStore.notes = [];
});

describe('NoteEditor time travel', () => {
	it('restores a version in place and keeps editing the restored note', async () => {
		const onClose = vi.fn();
		const { container, getByRole } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose }
		});

		const trigger = await waitFor(() => {
			const button = container.querySelector<HTMLButtonElement>('nav button');
			if (!button) throw new Error('rail not rendered');
			return button;
		});
		await fireEvent.click(trigger);
		await fireEvent.click(container.querySelectorAll('[data-history-row]')[1]);
		await waitFor(() => expect(container.querySelector('h1')?.textContent?.trim()).toBe('Books'));

		await fireEvent.click(getByRole('button', { name: 'Restore' }));
		await fireEvent.click(getByRole('button', { name: 'Restore' }));

		await waitFor(() => expect(notesStore.notes[0]).toMatchObject({ title: 'Books' }));
		expect(notesStore.notes[0].body).toBe('Antifragile');
		expect(onClose).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(container.querySelector<HTMLTextAreaElement>('[data-note-title]')?.value).toBe('Books')
		);
		expect(container.querySelector('[data-body-editor]')?.textContent).toContain('Antifragile');
		expect(container.querySelector('[data-body-editor]')?.textContent).not.toContain('Sapiens');
		expect(container.querySelector('[aria-label="Time travel"]')).toBeNull();
	});

	it('shows body changes that sync in while a version is being previewed', async () => {
		const { container, getByRole } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: vi.fn() }
		});
		const trigger = await waitFor(() => {
			const button = container.querySelector<HTMLButtonElement>('nav button');
			if (!button) throw new Error('rail not rendered');
			return button;
		});
		await fireEvent.click(trigger);
		await fireEvent.click(container.querySelectorAll('[data-history-row]')[1]);
		await waitFor(() => expect(container.querySelector('h1')?.textContent?.trim()).toBe('Books'));

		// Another device edits the body while the live editor is not mounted.
		notesStore.notes = [note({ body: 'Antifragile\nSapiens\nDeep Work', updatedAt: 30 })];
		await tick();
		await fireEvent.click(getByRole('button', { name: 'Close time travel' }));

		await waitFor(() =>
			expect(container.querySelector('[data-body-editor]')?.textContent).toContain('Deep Work')
		);
	});
});
