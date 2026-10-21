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

afterEach(() => {
	notesStore.notes = [];
	notesStore.labels = [];
});

describe('NoteCard created/updated meta', () => {
	it('leaves the created or edited time to the open note', () => {
		render(NoteCard, {
			props: { note: note({ createdAt: 1, updatedAt: 2 }), onOpen: vi.fn() }
		});
		expect(document.querySelector('[data-note-meta]')).toBeNull();
		expect(document.body.textContent).not.toMatch(/Edited|Created/);
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
