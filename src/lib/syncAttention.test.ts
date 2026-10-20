import { describe, expect, it } from 'vitest';
import {
	friendlySyncError,
	OFFLINE_ATTENTION_MS,
	resolveSyncAttention,
	SyncAttentionKind,
	type SyncAttentionInput
} from './syncAttention';

const DAY = 24 * 60 * 60 * 1000;
const quiet: SyncAttentionInput = {
	synced: true,
	keyRetired: false,
	lastError: null,
	usage: { storageBytes: 10, maxBytes: 100 },
	online: true,
	lastSync: 1_000_000,
	now: 1_000_000 + 60_000
};

describe('resolveSyncAttention', () => {
	it('says nothing while sync is quiet, and nothing at all for a private workspace', () => {
		expect(resolveSyncAttention(quiet)).toBeNull();
		expect(
			resolveSyncAttention({
				...quiet,
				synced: false,
				lastError: 'Failed to fetch',
				keyRetired: true
			})
		).toBeNull();
	});

	it('asks for a new key when the workspace key was retired, with no way to dismiss', () => {
		const attention = resolveSyncAttention({ ...quiet, keyRetired: true });
		expect(attention).toMatchObject({
			kind: SyncAttentionKind.KeyRetired,
			tone: 'danger',
			action: 'open-settings',
			actionLabel: 'Create new key',
			dismissible: false
		});
	});

	it('offers a retry for a sync error, in plain words for a dead connection', () => {
		const attention = resolveSyncAttention({ ...quiet, lastError: 'TypeError: Failed to fetch' });
		expect(attention).toMatchObject({
			kind: SyncAttentionKind.Error,
			tone: 'danger',
			title: 'Sync stopped: the server could not be reached.',
			body: 'Your notes are safe on this device.',
			action: 'retry',
			dismissible: true
		});
		expect(
			resolveSyncAttention({ ...quiet, lastError: 'Skipped 2 unreadable sync records' })?.title
		).toBe('Sync stopped: Skipped 2 unreadable sync records.');
	});

	it('warns from 80% of cloud storage and insists at 100%', () => {
		expect(
			resolveSyncAttention({ ...quiet, usage: { storageBytes: 79, maxBytes: 100 } })
		).toBeNull();
		expect(
			resolveSyncAttention({ ...quiet, usage: { storageBytes: 85, maxBytes: 100 } })
		).toMatchObject({
			kind: SyncAttentionKind.StorageNearlyFull,
			tone: 'warning',
			title: 'Cloud storage is 85% full.',
			actionLabel: 'Open workspaces',
			dismissible: true
		});
		expect(
			resolveSyncAttention({ ...quiet, usage: { storageBytes: 100, maxBytes: 100 } })
		).toMatchObject({ kind: SyncAttentionKind.StorageFull, tone: 'danger', dismissible: false });
	});

	it('mentions being offline only after a day without a sync', () => {
		const offline = { ...quiet, online: false };
		expect(resolveSyncAttention(offline)).toBeNull();
		expect(
			resolveSyncAttention({ ...offline, now: offline.lastSync + OFFLINE_ATTENTION_MS })
		).toMatchObject({
			kind: SyncAttentionKind.Offline,
			tone: 'muted',
			title: 'Offline for a day.'
		});
		expect(resolveSyncAttention({ ...offline, now: offline.lastSync + 2.5 * DAY })?.title).toBe(
			'Offline for 2 days.'
		);
		// A workspace that never synced has no last sync to count from.
		expect(resolveSyncAttention({ ...offline, lastSync: 0, now: 5 * DAY })).toBeNull();
	});

	it('ranks what needs attention most: key, then error, then storage, then offline', () => {
		const everything: SyncAttentionInput = {
			...quiet,
			keyRetired: true,
			lastError: 'Failed to fetch',
			usage: { storageBytes: 100, maxBytes: 100 },
			online: false,
			now: quiet.lastSync + 3 * DAY
		};
		expect(resolveSyncAttention(everything)?.kind).toBe(SyncAttentionKind.KeyRetired);
		expect(resolveSyncAttention({ ...everything, keyRetired: false })?.kind).toBe(
			SyncAttentionKind.Error
		);
		expect(resolveSyncAttention({ ...everything, keyRetired: false, lastError: null })?.kind).toBe(
			SyncAttentionKind.StorageFull
		);
	});

	it('keeps other error wording as it is', () => {
		expect(friendlySyncError('NetworkError when attempting to fetch resource.', 'x')).toBe(
			'the server could not be reached'
		);
		expect(friendlySyncError('Sync network error', 'x')).toBe('the server could not be reached');
		expect(friendlySyncError('Quota exceeded', 'x')).toBe('Quota exceeded');
		expect(friendlySyncError(null, 'fallback')).toBe('fallback');
	});
});
