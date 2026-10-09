import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import MasonryGrid from './MasonryGrid.svelte';

function note(id: string, updatedAt = 1): Note {
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
		updatedAt,
		reminder: null,
		labels: []
	};
}

const notes = [note('a'), note('b'), note('c')];

/** The grid's width, the font in use, and the card heights the browser would report. */
let gridWidth = 1200;
let fontLoaded = false;
function cardHeight(id: string): number {
	return (gridWidth > 1000 ? 100 : 180) + (fontLoaded ? 20 : 0) + id.charCodeAt(0) - 96;
}

class FontsStub extends EventTarget {
	status: FontFaceSetLoadStatus = 'loaded';
	ready = Promise.resolve(this as unknown as FontFaceSet);
}
let fonts: FontsStub;

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
	fontLoaded = false;
	observers.length = 0;
	fonts = new FontsStub();
	Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
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
	delete (document as { fonts?: unknown }).fonts;
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

	it('renders every card again when a web font arrives', async () => {
		render(MasonryGrid, { props: { notes, onOpen: () => {} } });
		await nextFrame();
		expect(wrappers()[0].style.containIntrinsicSize).toBe('auto 101px');

		fontLoaded = true;
		fonts.dispatchEvent(new Event('loadingdone'));
		await tick();
		expect(wrappers().map((el) => el.style.contentVisibility)).toEqual(['', '', '']);

		await nextFrame();
		expect(wrappers().map((el) => el.style.containIntrinsicSize)).toEqual([
			'auto 121px',
			'auto 122px',
			'auto 123px'
		]);
	});

	it('stops listening for fonts once unmounted', async () => {
		const { unmount } = render(MasonryGrid, { props: { notes, onOpen: () => {} } });
		await nextFrame();
		unmount();

		const spy = vi.spyOn(window, 'requestAnimationFrame');
		fonts.dispatchEvent(new Event('loadingdone'));
		expect(spy).not.toHaveBeenCalled();
	});

	it('lays a changed note out again before skipping it', async () => {
		const { rerender } = render(MasonryGrid, { props: { notes, onOpen: () => {} } });
		await nextFrame();
		expect(wrappers().every((el) => el.style.contentVisibility === 'auto')).toBe(true);

		await rerender({ notes: [note('a', 2), note('b'), note('c')], onOpen: () => {} });
		const byId = (id: string) => wrappers().find((el) => el.dataset.noteHeight === id)!;
		expect(byId('a').style.contentVisibility).toBe('');
		expect(byId('b').style.contentVisibility).toBe('auto');
		expect(byId('c').style.contentVisibility).toBe('auto');

		// The next measurement records the new revision and skips the card again.
		resize();
		await tick();
		expect(byId('a').style.contentVisibility).toBe('auto');
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
