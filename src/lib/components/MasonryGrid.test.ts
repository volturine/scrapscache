import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import MasonryGrid from './MasonryGrid.svelte';

function note(id: string): Note {
	return {
		id,
		title: id,
		body: 'Body',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: []
	};
}

const notes = [note('a'), note('b'), note('c')];

/** The grid's width and the card heights the browser would report at it. */
let gridWidth = 1200;
function cardHeight(id: string): number {
	return (gridWidth > 1000 ? 100 : 180) + id.charCodeAt(0) - 96;
}

const observers: Array<(entries: ResizeObserverEntry[]) => void> = [];

function wrappers(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('[data-note-height]'));
}

async function nextFrame() {
	await new Promise((resolve) => requestAnimationFrame(resolve));
	await tick();
}

function resize() {
	for (const callback of observers) callback([]);
}

beforeEach(() => {
	gridWidth = 1200;
	observers.length = 0;
	vi.stubGlobal(
		'ResizeObserver',
		class {
			constructor(callback: (entries: ResizeObserverEntry[]) => void) {
				observers.push(callback);
			}
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
	vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => gridWidth);
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
		this: HTMLElement
	) {
		const id = this.dataset.noteHeight;
		const height = id ? cardHeight(id) : 0;
		return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: height, width: 0, height } as DOMRect;
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	notesStore.notes = [];
});

describe('MasonryGrid offscreen cards', () => {
	it('skips a card only after measuring it, at its measured height', async () => {
		render(MasonryGrid, { props: { notes, onOpen: () => {} } });

		// Nothing is skipped before the first measurement, so every card lays out.
		expect(wrappers().map((el) => el.style.contentVisibility)).toEqual(['', '', '']);

		await nextFrame();

		for (const el of wrappers()) {
			expect(el.style.contentVisibility).toBe('auto');
			expect(el.style.containIntrinsicSize).toBe(`auto ${cardHeight(el.dataset.noteHeight!)}px`);
		}
	});

	it('renders every card again when the grid width changes, then skips them at the new heights', async () => {
		render(MasonryGrid, { props: { notes, onOpen: () => {} } });
		await nextFrame();
		expect(wrappers()[0].style.containIntrinsicSize).toBe('auto 101px');

		gridWidth = 700;
		resize();
		await tick();
		// Skipped cards keep their old height, so they must lay out before being measured.
		expect(wrappers().map((el) => el.style.contentVisibility)).toEqual(['', '', '']);

		await nextFrame();
		expect(wrappers().map((el) => el.style.containIntrinsicSize)).toEqual([
			'auto 181px',
			'auto 182px',
			'auto 183px'
		]);
	});

	it('keeps measuring in place while the width holds', async () => {
		render(MasonryGrid, { props: { notes, onOpen: () => {} } });
		await nextFrame();

		const spy = vi.spyOn(window, 'requestAnimationFrame');
		resize();
		await tick();
		expect(spy).not.toHaveBeenCalled();
		expect(wrappers().every((el) => el.style.contentVisibility === 'auto')).toBe(true);
	});
});
