import { render, screen } from '@testing-library/svelte';
import type { View } from '#lib/stores/ui.svelte.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { uiStore } from '#lib/stores/ui.svelte.js';
import ArchiveView from './ArchiveView.svelte';
import LabelView from './LabelView.svelte';
import TrashView from './TrashView.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));

vi.mock('#lib/editorContext.js', () => ({
	useEditorActions: () => ({
		startNewNote: vi.fn(),
		openNote: vi.fn(),
		closeNote: vi.fn()
	})
}));

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Trip',
		body: 'Pack socks',
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

afterEach(() => {
	notesStore.notes = [];
	notesStore.labels = [];
	uiStore.setView('notes');
});

/** Show `view` with a committed query, as typing there leaves it. */
function searchIn(view: View, query: string, labelId: string | null = null) {
	uiStore.setView(view, labelId);
	uiStore.search = query;
}

/** Let NotesFeed's batch stream run its course. */
function frames(count: number): Promise<void> {
	return new Promise((resolve) => {
		const step = (left: number) =>
			left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
		step(count);
	});
}

describe('ArchiveView search', () => {
	it('shows only archived notes that match the committed search', () => {
		notesStore.notes = [
			note({ id: 'a', title: 'Apples', body: 'needle in the fruit bowl', archived: true }),
			note({ id: 'b', title: 'Bolts', body: 'Hardware', archived: true }),
			note({ id: 'c', title: 'Needle', body: 'needle, but not archived' })
		];
		searchIn('archive', 'needle');
		render(ArchiveView);

		expect(screen.queryByRole('button', { name: /^Open Apples/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Open Bolts/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Open Needle/ })).toBeNull();
	});

	it('names the query when no archived note matches', () => {
		notesStore.notes = [note({ id: 'b', title: 'Bolts', body: 'Hardware', archived: true })];
		searchIn('archive', 'needle');
		render(ArchiveView);

		expect(screen.getByText('No notes match “needle”')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Open Bolts/ })).toBeNull();
	});
});

describe('TrashView search', () => {
	it('shows only trashed notes that match the committed search', () => {
		notesStore.notes = [
			note({ id: 'a', title: 'Apples', body: 'needle', trashed: true, trashedAt: 1 }),
			note({ id: 'b', title: 'Bolts', body: 'Hardware', trashed: true, trashedAt: 1 })
		];
		searchIn('trash', 'needle');
		render(TrashView);

		expect(screen.queryByRole('button', { name: /^Open Apples/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Open Bolts/ })).toBeNull();
	});

	it('names the query, with no Empty control, when no trashed note matches', () => {
		notesStore.notes = [
			note({ id: 'b', title: 'Bolts', body: 'Hardware', trashed: true, trashedAt: 1 })
		];
		searchIn('trash', 'needle');
		render(TrashView);

		expect(screen.getByText('No notes match “needle”')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Empty trash' })).toBeNull();
	});

	it('offers Empty when no search is active', () => {
		notesStore.notes = [note({ id: 'a', title: 'Apples', trashed: true, trashedAt: 1 })];
		uiStore.setView('trash');
		render(TrashView);

		expect(screen.getByRole('button', { name: 'Empty trash' })).toBeTruthy();
	});

	it('hides Empty while a search is active, because it would empty the whole trash', () => {
		notesStore.notes = [
			note({ id: 'a', title: 'Apples', body: 'needle', trashed: true, trashedAt: 1 }),
			note({ id: 'b', title: 'Bolts', body: 'Hardware', trashed: true, trashedAt: 1 })
		];
		searchIn('trash', 'needle');
		render(TrashView);

		expect(screen.queryByRole('button', { name: 'Empty trash' })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Open Apples/ })).toBeTruthy();
	});
});

describe('LabelView search', () => {
	it('filters the label notes by the committed search and keeps the heading', () => {
		notesStore.labels = [{ id: 'label-1', name: 'Shopping', createdAt: 1, updatedAt: 1 }];
		notesStore.notes = [
			note({ id: 'a', title: 'Apples', body: 'needle', labels: ['label-1'] }),
			note({ id: 'b', title: 'Bolts', body: 'Hardware', labels: ['label-1'] }),
			note({ id: 'c', title: 'Nails', body: 'needle', labels: [] })
		];
		searchIn('label', 'needle', 'label-1');
		render(LabelView);

		expect(screen.getByRole('heading', { level: 1, name: 'Shopping' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Open Apples/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Open Bolts/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Open Nails/ })).toBeNull();
	});

	it('names the query under the heading when no label note matches', () => {
		notesStore.labels = [{ id: 'label-1', name: 'Shopping', createdAt: 1, updatedAt: 1 }];
		notesStore.notes = [note({ id: 'b', title: 'Bolts', body: 'Hardware', labels: ['label-1'] })];
		searchIn('label', 'needle', 'label-1');
		render(LabelView);

		expect(screen.getByRole('heading', { level: 1, name: 'Shopping' })).toBeTruthy();
		expect(screen.getByText('No notes match “needle”')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Open Bolts/ })).toBeNull();
	});
});

describe('a search in an empty view', () => {
	it.each([
		['archive', ArchiveView, 'Archive notes you want to keep without showing them in Notes.'],
		['trash', TrashView, 'Deleted notes stay here for 7 days before they are deleted forever.']
	] as const)('keeps the %s view’s own empty copy', (view, View, copy) => {
		searchIn(view, 'needle');
		render(View);

		expect(screen.getByText(copy)).toBeTruthy();
		expect(screen.queryByText(/No notes match/)).toBeNull();
	});

	it('keeps the label view’s own empty copy', () => {
		notesStore.labels = [{ id: 'label-1', name: 'Shopping', createdAt: 1, updatedAt: 1 }];
		searchIn('label', 'needle', 'label-1');
		render(LabelView);

		expect(
			screen.getByText('Create a note to start collecting ideas under this label.')
		).toBeTruthy();
		expect(screen.queryByText(/No notes match/)).toBeNull();
	});
});

describe('a search on another view', () => {
	it('leaves a hidden view’s list whole', () => {
		notesStore.notes = [
			note({ id: 'a', title: 'Apples', body: 'needle', archived: true }),
			note({ id: 'b', title: 'Bolts', body: 'Hardware', archived: true })
		];
		searchIn('notes', 'needle');
		render(ArchiveView);

		expect(screen.queryByRole('button', { name: /^Open Apples/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Open Bolts/ })).toBeTruthy();
	});
});

describe('clearing a search', () => {
	it('brings every note back after no hits, then a few', async () => {
		notesStore.notes = Array.from({ length: 100 }, (_, index) =>
			note({
				id: `n${index}`,
				title: `Card ${index}`,
				body: index < 3 ? 'needle' : 'hay',
				trashed: true,
				trashedAt: 1
			})
		);
		const cards = () => screen.queryAllByRole('button', { name: /^Open Card / });
		searchIn('trash', 'zzzz');
		render(TrashView);
		expect(screen.getByText('No notes match “zzzz”')).toBeTruthy();

		uiStore.search = 'needle';
		await vi.waitFor(() => expect(cards()).toHaveLength(3));
		// The feed came back with three notes; let its stream finish before the list grows.
		await frames(3);

		uiStore.search = '';
		await vi.waitFor(() => expect(cards()).toHaveLength(100));
		expect(screen.getByRole('button', { name: 'Empty trash' })).toBeTruthy();
	});
});

describe('a search with no match here', () => {
	it('offers the other places where the query matches', () => {
		notesStore.notes = [
			note({ id: 'a', title: 'Apples', body: 'hay', archived: true }),
			note({ id: 'n', title: 'Needle', body: 'needle' }),
			note({ id: 't', title: 'Thread', body: 'needle', trashed: true, trashedAt: 1 })
		];
		searchIn('archive', 'needle');
		render(ArchiveView);

		expect(screen.getByRole('button', { name: 'Look in Notes' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Look in Trash' })).toBeTruthy();
		expect(screen.getByText('Only archived notes are searched here.')).toBeTruthy();
	});

	it('offers the rest of Notes from a label', () => {
		notesStore.labels = [{ id: 'label-1', name: 'Shopping', createdAt: 1, updatedAt: 1 }];
		notesStore.notes = [
			note({ id: 'b', title: 'Bolts', body: 'hay', labels: ['label-1'] }),
			note({ id: 'n', title: 'Needle', body: 'needle' })
		];
		searchIn('label', 'needle', 'label-1');
		render(LabelView);

		expect(screen.getByRole('button', { name: 'Look in Notes' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Look in Archive' })).toBeNull();
	});
});
