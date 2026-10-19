import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { uiStore } from '#lib/stores/ui.svelte.js';
import ArchiveView from './ArchiveView.svelte';
import LabelView from './LabelView.svelte';
import TrashView from './TrashView.svelte';

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
	uiStore.search = '';
	uiStore.searchInput = '';
	uiStore.activeLabelId = null;
});

describe('ArchiveView search', () => {
	it('shows only archived notes that match the committed search', () => {
		notesStore.notes = [
			note({ id: 'a', title: 'Apples', body: 'needle in the fruit bowl', archived: true }),
			note({ id: 'b', title: 'Bolts', body: 'Hardware', archived: true }),
			note({ id: 'c', title: 'Needle', body: 'needle, but not archived' })
		];
		uiStore.search = 'needle';
		render(ArchiveView);

		expect(screen.queryByRole('button', { name: /^Open Apples/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Open Bolts/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Open Needle/ })).toBeNull();
	});

	it('shows No notes found when no archived note matches', () => {
		notesStore.notes = [note({ id: 'b', title: 'Bolts', body: 'Hardware', archived: true })];
		uiStore.search = 'needle';
		render(ArchiveView);

		expect(screen.getByText('No notes found')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Open Bolts/ })).toBeNull();
	});
});

describe('TrashView search', () => {
	it('shows only trashed notes that match the committed search', () => {
		notesStore.notes = [
			note({ id: 'a', title: 'Apples', body: 'needle', trashed: true, trashedAt: 1 }),
			note({ id: 'b', title: 'Bolts', body: 'Hardware', trashed: true, trashedAt: 1 })
		];
		uiStore.search = 'needle';
		render(TrashView);

		expect(screen.queryByRole('button', { name: /^Open Apples/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Open Bolts/ })).toBeNull();
	});

	it('shows No notes found and no Empty control when no trashed note matches', () => {
		notesStore.notes = [
			note({ id: 'b', title: 'Bolts', body: 'Hardware', trashed: true, trashedAt: 1 })
		];
		uiStore.search = 'needle';
		render(TrashView);

		expect(screen.getByText('No notes found')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Empty' })).toBeNull();
	});

	it('offers Empty when no search is active', () => {
		notesStore.notes = [note({ id: 'a', title: 'Apples', trashed: true, trashedAt: 1 })];
		render(TrashView);

		expect(screen.getByRole('button', { name: 'Empty' })).toBeTruthy();
	});

	it('hides Empty while a search is active, because it would empty the whole trash', () => {
		notesStore.notes = [
			note({ id: 'a', title: 'Apples', body: 'needle', trashed: true, trashedAt: 1 }),
			note({ id: 'b', title: 'Bolts', body: 'Hardware', trashed: true, trashedAt: 1 })
		];
		uiStore.search = 'needle';
		render(TrashView);

		expect(screen.queryByRole('button', { name: 'Empty' })).toBeNull();
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
		uiStore.activeLabelId = 'label-1';
		uiStore.search = 'needle';
		render(LabelView);

		expect(screen.getByRole('heading', { level: 1, name: 'Shopping' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Open Apples/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Open Bolts/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Open Nails/ })).toBeNull();
	});

	it('shows No notes found under the heading when no label note matches', () => {
		notesStore.labels = [{ id: 'label-1', name: 'Shopping', createdAt: 1, updatedAt: 1 }];
		notesStore.notes = [note({ id: 'b', title: 'Bolts', body: 'Hardware', labels: ['label-1'] })];
		uiStore.activeLabelId = 'label-1';
		uiStore.search = 'needle';
		render(LabelView);

		expect(screen.getByRole('heading', { level: 1, name: 'Shopping' })).toBeTruthy();
		expect(screen.getByText('No notes found')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Open Bolts/ })).toBeNull();
	});
});
