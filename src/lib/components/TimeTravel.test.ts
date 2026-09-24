import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteHistoryEntry } from '$lib/historyClient';
import { syncStore } from '$lib/stores/sync.svelte';
import type { SyncNote } from '$lib/syncRecords';
import type { Note } from '$lib/types';
import TimeTravel from './TimeTravel.svelte';

const history = vi.hoisted(() => ({
	loadNoteHistory: vi.fn(),
	hydrateHistoryNote: vi.fn()
}));
vi.mock('$lib/historyClient', () => history);

const account = {
	syncKey: 'test-key',
	accountId: 'test-account',
	authPublicKey: 'test-public',
	pairingCode: 'test-code'
};

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Reading list',
		body: 'Antifragile\nSapiens\nDeep Work',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 40,
		reminder: null,
		labels: [],
		...partial
	};
}

function syncNote(partial: Partial<Note> = {}): SyncNote {
	const { images: _images, ...value } = note(partial);
	return value;
}

function entry(historyId: number, body: string): NoteHistoryEntry {
	return { historyId, savedAt: historyId * 1000, note: syncNote({ body, updatedAt: historyId }) };
}

// Newest first; the newest upload matches the live note and the oldest two look the same,
// so only the newer of that pair is listed.
const entries = [
	entry(40, 'Antifragile\nSapiens\nDeep Work'),
	entry(30, 'Antifragile\nSapiens'),
	entry(20, 'Antifragile'),
	entry(10, 'Antifragile')
];

async function openRail(container: HTMLElement): Promise<HTMLButtonElement> {
	return waitFor(() => {
		const button = container.querySelector<HTMLButtonElement>('nav button');
		if (!button) throw new Error('rail not rendered');
		return button;
	});
}

function renderTimeTravel(props: Record<string, unknown> = {}) {
	const callbacks = {
		onPreviewVersion: vi.fn(),
		onCancelPreview: vi.fn(),
		onStartRestore: vi.fn(),
		onCancelRestore: vi.fn(),
		onConfirmRestore: vi.fn()
	};
	const view = render(TimeTravel, {
		props: {
			account,
			note: note(),
			previewEntry: null,
			restoreConfirmOpen: false,
			restoringPreview: false,
			restoreError: '',
			...callbacks,
			...props
		}
	});
	return { ...view, ...callbacks };
}

beforeEach(() => {
	// jsdom has no layout, so scrolling a row into view is a no-op here.
	Element.prototype.scrollIntoView = vi.fn();
	syncStore.account = account;
	history.loadNoteHistory.mockResolvedValue({ entries, nextBefore: null });
	history.hydrateHistoryNote.mockImplementation(
		async (_account, item: NoteHistoryEntry) => item.note
	);
});

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
	syncStore.account = null;
});

describe('TimeTravel', () => {
	it('stays hidden until the note has been synced', async () => {
		history.loadNoteHistory.mockResolvedValue({ entries: [], nextBefore: null });
		const { container } = renderTimeTravel();
		await waitFor(() => expect(history.loadNoteHistory).toHaveBeenCalled());
		expect(container.querySelector('nav')).toBeNull();
	});

	it('shows the initial sync as the current version', async () => {
		history.loadNoteHistory.mockResolvedValue({ entries: [entries[0]], nextBefore: null });
		const { container } = renderTimeTravel();
		await fireEvent.click(await openRail(container));
		const rows = [...container.querySelectorAll('[data-history-row]')];
		expect(rows.map((row) => row.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			expect.stringMatching(/Current Antifragile$/)
		]);
		expect(rows[0].getAttribute('aria-current')).toBe('true');
	});

	it('adds a Now row while local edits have not synced yet', async () => {
		const { container } = renderTimeTravel({
			note: note({ body: 'Antifragile\nSapiens\nDeep Work\nMore' })
		});
		await fireEvent.click(await openRail(container));
		const rows = [...container.querySelectorAll('[data-history-row]')];
		expect(rows.map((row) => row.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Now Not synced yet',
			expect.stringMatching(/\+1 Deep Work$/),
			expect.stringMatching(/\+1 Sapiens$/),
			expect.stringMatching(/Antifragile$/)
		]);
		expect(rows[0].getAttribute('aria-current')).toBe('true');
	});

	it('marks one tick per saved version with the current save active', async () => {
		const { container } = renderTimeTravel();
		const trigger = await openRail(container);
		expect(trigger.getAttribute('aria-label')).toBe('Version history, 3 saved versions');
		const ticks = [...trigger.querySelectorAll('span')];
		expect(ticks).toHaveLength(3);
		expect(ticks.map((tick) => tick.hasAttribute('data-active'))).toEqual([true, false, false]);
	});

	it('expands into described versions and previews the chosen one', async () => {
		const { container, getByText, onPreviewVersion } = renderTimeTravel();
		const trigger = await openRail(container);
		await fireEvent.click(trigger);

		expect(container.querySelector('nav')?.hasAttribute('data-expanded')).toBe(true);
		const rows = [...container.querySelectorAll<HTMLButtonElement>('[data-history-row]')];
		expect(rows.map((row) => row.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			expect.stringMatching(/Current \+1 Deep Work$/),
			expect.stringMatching(/\+1 Sapiens$/),
			expect.stringMatching(/Antifragile$/)
		]);

		await fireEvent.click(getByText('Sapiens'));
		await waitFor(() => expect(onPreviewVersion).toHaveBeenCalledWith(entries[1].note, entries[1]));
	});

	it('steps older, and newer from the newest version returns to the live note', async () => {
		const { getByRole, onPreviewVersion, onCancelPreview } = renderTimeTravel({
			previewEntry: entries[1]
		});
		await waitFor(() => expect(history.loadNoteHistory).toHaveBeenCalled());

		await fireEvent.click(getByRole('button', { name: 'Older version' }));
		await waitFor(() => expect(onPreviewVersion).toHaveBeenCalledWith(entries[2].note, entries[2]));

		await fireEvent.click(getByRole('button', { name: 'Back to current note' }));
		expect(onCancelPreview).toHaveBeenCalled();
	});

	it('only previews the most recently chosen version', async () => {
		let releaseFirst!: (value: SyncNote) => void;
		history.hydrateHistoryNote.mockImplementationOnce(
			() => new Promise<SyncNote>((resolve) => (releaseFirst = resolve))
		);
		const { container, getByText, onPreviewVersion } = renderTimeTravel();
		const trigger = await openRail(container);
		await fireEvent.click(trigger);

		await fireEvent.click(getByText('Sapiens'));
		await fireEvent.click(getByText('Antifragile'));
		await waitFor(() => expect(onPreviewVersion).toHaveBeenCalledTimes(1));
		releaseFirst(entries[1].note);
		await Promise.resolve();

		expect(onPreviewVersion).toHaveBeenCalledTimes(1);
		expect(onPreviewVersion).toHaveBeenCalledWith(entries[2].note, entries[2]);
	});

	it('previews the tick under the mouse and opens it on click, like T3 Code', async () => {
		// jsdom has no layout: give each tick a 7px row so the pointer can find the nearest.
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
			this: Element
		) {
			const row = Number((this as HTMLElement).dataset?.tick ?? 0);
			return new DOMRect(0, row * 7, 10, 2);
		});
		const pointer = (target: Element, type: string, clientY: number) => {
			const event = new MouseEvent(type, { bubbles: true, clientY });
			Object.defineProperty(event, 'pointerType', { value: 'mouse' });
			target.dispatchEvent(event);
		};
		const { container, onPreviewVersion } = renderTimeTravel();
		const trigger = await openRail(container);

		pointer(trigger, 'pointermove', 7);
		await tick();
		const card = container.querySelector('nav + [aria-hidden="true"]');
		expect(card?.textContent).toContain('Sapiens');
		expect(trigger.querySelector('[data-tick="1"]')?.hasAttribute('data-hovered')).toBe(true);

		pointer(trigger, 'pointerdown', 7);
		await fireEvent.click(trigger);
		await waitFor(() => expect(onPreviewVersion).toHaveBeenCalledWith(entries[1].note, entries[1]));
		expect(container.querySelector('nav')?.hasAttribute('data-expanded')).toBe(false);

		pointer(trigger, 'pointerleave', 7);
		await tick();
		expect(container.querySelector('nav + [aria-hidden="true"]')).toBeNull();
	});
});
