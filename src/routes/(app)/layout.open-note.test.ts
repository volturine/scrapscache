import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { reminderStore, type ReminderHost } from '#lib/stores/reminders.svelte.js';
import { TEST_WORKSPACE } from '../../tests/workspace';
import Layout from './+layout.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$app/state', () => ({
	page: { url: new URL('https://scrapscache.com/'), state: {}, params: {}, route: { id: '/' } }
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const empty = createRawSnippet(() => ({ render: () => '<div></div>' }));

function openTitle(container: HTMLElement): HTMLTextAreaElement | null {
	return container.querySelector('textarea[placeholder="Title"]');
}

describe('opening a note from a reminder', () => {
	let host: ReminderHost | null = null;
	let booted: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		host = null;
		vi.spyOn(reminderStore, 'attach').mockImplementation((given) => {
			host = given;
			return () => {};
		});
		// The layout hands the loaded notes to the reminders once the store has booted.
		booted = vi.spyOn(reminderStore, 'activateProfile').mockResolvedValue();
		vi.spyOn(notesStore, 'syncPendingChanges').mockResolvedValue(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		notesStore.notes = [];
	});

	it('saves the note being left when a reminder opens another note in the same workspace', async () => {
		const { container, unmount } = render(Layout, { props: { children: empty } });
		await waitFor(() => expect(host).not.toBeNull());
		await waitFor(() => expect(booted).toHaveBeenCalled());
		const left = notesStore.createNote({ title: 'Left', body: '', labels: [], reminder: null });
		const target = notesStore.createNote({
			title: 'Target',
			body: '',
			labels: [],
			reminder: Date.now() - 1
		});

		host!.openNote(TEST_WORKSPACE, left.id);
		await waitFor(() => expect(openTitle(container)?.value).toBe('Left'));
		await fireEvent.input(openTitle(container)!, { target: { value: 'Left, edited' } });

		const flush = vi.spyOn(notesStore, 'flushNote');
		host!.openNote(TEST_WORKSPACE, target.id);
		await waitFor(() => expect(openTitle(container)?.value).toBe('Target'));

		// The note being left closes properly: saved durably, not just unmounted.
		expect(flush).toHaveBeenCalledWith(left.id);
		expect(notesStore.notes.find((note) => note.id === left.id)?.title).toBe('Left, edited');
		unmount();
	});
});
