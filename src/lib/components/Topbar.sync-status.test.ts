import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock('$lib/editorContext', () => ({
	useEditorActions: () => ({ startNewNote: vi.fn(), closeNote: vi.fn() })
}));

import { syncStore } from '$lib/stores/sync.svelte';
import { notesStore } from '$lib/stores/notes.svelte';
import Topbar from './Topbar.svelte';

afterEach(() => {
	syncStore.lastError = null;
	syncStore.usage = null;
	syncStore.account = null;
	syncStore.onSyncStart = null;
	syncStore.onSyncEnd = null;
	(notesStore as unknown as { syncFlight: Promise<boolean> | null }).syncFlight = null;
	(notesStore as unknown as { lastAutoSyncAt: number }).lastAutoSyncAt = 0;
	vi.restoreAllMocks();
});

describe('Topbar sync status', () => {
	it('uses only the cloud color and accessible label to surface persistent sync attention', async () => {
		syncStore.usage = {
			ciphertextBytes: 700,
			envelopeCount: 1,
			storageBytes: 850,
			maxBytes: 1_000
		};
		const { container } = render(Topbar);
		const icon = container.querySelector('[data-scrapscache-sync-icon]');

		expect(screen.getByRole('button', { name: 'Sync settings, storage nearly full' })).toBeTruthy();
		expect(icon?.getAttribute('class')).toContain('text-[var(--scrapscache-warning)]');

		syncStore.lastError = 'Sync network error';
		await vi.waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Sync settings, sync needs attention' })
			).toBeTruthy()
		);
		expect(icon?.getAttribute('class')).toContain('text-[var(--scrapscache-danger)]');
	});

	it('spins the cloud for the full notes sync flight', async () => {
		const { container } = render(Topbar);
		const icon = container.querySelector('[data-scrapscache-sync-icon]');

		(notesStore as unknown as { syncFlight: Promise<boolean> | null }).syncFlight = new Promise(
			() => undefined
		);
		await tick();
		expect(icon?.classList.contains('scrapscache-sync-icon-active')).toBe(true);

		(notesStore as unknown as { syncFlight: Promise<boolean> | null }).syncFlight = null;
		await tick();
		expect(icon?.classList.contains('scrapscache-sync-icon-active')).toBe(false);
	});

	it('notifies sync indicator to spin during syncWithCloud and flushSync', async () => {
		const startSpy = vi.fn();
		const endSpy = vi.fn();
		syncStore.onSyncStart = startSpy;
		syncStore.onSyncEnd = endSpy;
		syncStore.account = {
			syncKey: 'k',
			accountId: 'acc',
			authPublicKey: 'pub',
			pairingCode: 'code'
		};
		vi.spyOn(syncStore, 'sync').mockImplementation(async () => {
			expect(startSpy).toHaveBeenCalledOnce();
			return { success: true, notes: [], labels: [] };
		});

		await notesStore.syncWithCloud();
		expect(startSpy).toHaveBeenCalledOnce();
		expect(endSpy).toHaveBeenCalledOnce();

		startSpy.mockClear();
		endSpy.mockClear();

		await notesStore.flushSync();
		expect(startSpy).toHaveBeenCalledOnce();
		expect(endSpy).toHaveBeenCalledOnce();
	});
});
