import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { tickAppClock } from '#lib/appClock.svelte.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { trashCountdownRow } from '$panda/styles';
import NoteCard from './NoteCard.svelte';

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

function metaTime(): HTMLElement | null {
	return document.querySelector('[data-note-meta] time');
}

afterEach(() => {
	notesStore.notes = [];
	notesStore.labels = [];
});

describe('NoteCard created/updated meta', () => {
	it('shows Created for a never-edited note', () => {
		const at = new Date(2026, 8, 15, 14, 30).getTime();
		render(NoteCard, { props: { note: note({ createdAt: at, updatedAt: at }), onOpen: () => {} } });

		const time = metaTime();
		expect(time?.textContent).toMatch(/^Created /);
		expect(time?.getAttribute('datetime')).toBe(new Date(at).toISOString());
		expect(time?.getAttribute('title')).toMatch(/^Created /);
	});

	it('shows Edited once the note has been modified', () => {
		const created = new Date(2026, 8, 15, 10, 0).getTime();
		const updated = new Date(2026, 8, 15, 14, 28).getTime();
		render(NoteCard, {
			props: { note: note({ createdAt: created, updatedAt: updated }), onOpen: () => {} }
		});

		const time = metaTime();
		expect(time?.textContent).toMatch(/^Edited /);
		expect(time?.getAttribute('title')).toMatch(/ · Edited /);
	});

	it('shows Deleted from trashedAt for a trashed note', () => {
		const trashedAt = new Date(2026, 8, 15, 12, 30).getTime();
		notesStore.notes = [note({ trashed: true, trashedAt, updatedAt: Math.max(trashedAt, 1) })];
		render(NoteCard, {
			props: {
				note: note({ trashed: true, trashedAt, updatedAt: Math.max(trashedAt, 1) }),
				onOpen: () => {}
			}
		});

		const time = metaTime();
		expect(time?.textContent).toMatch(/^Deleted /);
		expect(time?.getAttribute('datetime')).toBe(new Date(trashedAt).toISOString());
		expect(screen.getByRole('button', { name: /Open Trip/ })).toBeTruthy();
	});
});

describe('NoteCard trash countdown', () => {
	afterEach(() => {
		vi.useRealTimers();
		tickAppClock();
	});

	// appClock.now is a stored value that only tickAppClock() moves, so it follows the fake clock.
	function renderAt(target: Note, now: number): void {
		vi.useFakeTimers();
		vi.setSystemTime(now);
		tickAppClock();
		notesStore.notes = [target];
		render(NoteCard, { props: { note: target, onOpen: () => {} } });
	}

	it('shows the days left until a trashed note is deleted', () => {
		const trashedAt = new Date(2026, 9, 10, 10, 0).getTime();
		const trashed = note({ trashed: true, trashedAt, updatedAt: trashedAt });
		renderAt(trashed, new Date(2026, 9, 12, 10, 0).getTime());

		expect(document.querySelector('[data-trash-countdown]')?.textContent).toBe('Deletes in 5 days');
	});

	it('uses the soon style on the last day', () => {
		const trashedAt = new Date(2026, 9, 10, 10, 0).getTime();
		const trashed = note({ trashed: true, trashedAt, updatedAt: trashedAt });
		renderAt(trashed, new Date(2026, 9, 16, 10, 0).getTime());

		const countdown = document.querySelector('[data-trash-countdown]');
		expect(countdown?.textContent).toBe('Deletes tomorrow');
		expect(countdown?.className).toBe(trashCountdownRow({ soon: true }));
		expect(countdown?.className).not.toBe(trashCountdownRow({ soon: false }));
	});

	it('shows no countdown on an active note', () => {
		const at = new Date(2026, 9, 10, 10, 0).getTime();
		renderAt(note({ createdAt: at, updatedAt: at }), at);

		expect(document.querySelector('[data-trash-countdown]')).toBeNull();
	});

	it('rolls over from tomorrow to today at midnight on a mounted card', async () => {
		const trashedAt = new Date(2026, 9, 10, 10, 0).getTime();
		const trashed = note({ trashed: true, trashedAt, updatedAt: trashedAt });
		renderAt(trashed, new Date(2026, 9, 16, 23, 59).getTime());
		expect(document.querySelector('[data-trash-countdown]')?.textContent).toBe('Deletes tomorrow');

		vi.setSystemTime(new Date(2026, 9, 17, 0, 1).getTime());
		tickAppClock();
		await tick();

		expect(document.querySelector('[data-trash-countdown]')?.textContent).toBe('Deletes today');
	});

	it('says the countdown on the control assistive technology lands on', () => {
		const trashedAt = new Date(2026, 9, 10, 10, 0).getTime();
		const trashed = note({ trashed: true, trashedAt, updatedAt: trashedAt });
		renderAt(trashed, new Date(2026, 9, 12, 10, 0).getTime());

		expect(screen.getByRole('button', { name: 'Open Trip, deletes in 5 days' })).toBeTruthy();
	});
});
