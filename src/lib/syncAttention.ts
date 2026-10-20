/**
 * What, if anything, sync needs from the user right now. The cloud icon stays
 * quiet; a banner above the feed speaks up only for these states, each with the
 * next step as a button.
 */
export const SyncAttentionKind = {
	KeyRetired: 'key-retired',
	Error: 'error',
	StorageFull: 'storage-full',
	StorageNearlyFull: 'storage-nearly-full',
	Offline: 'offline'
} as const;
export type SyncAttentionKind = (typeof SyncAttentionKind)[keyof typeof SyncAttentionKind];

export type SyncAttentionTone = 'danger' | 'warning' | 'muted';

/** The one button on a banner: open Sync settings, or try the sync again. */
export type SyncAttentionAction = 'open-settings' | 'retry';

export type SyncAttention = {
	kind: SyncAttentionKind;
	tone: SyncAttentionTone;
	title: string;
	body: string;
	action: SyncAttentionAction | null;
	actionLabel: string | null;
	/** A dismissed banner stays away while this key stays the same. */
	key: string;
	dismissible: boolean;
};

export type SyncAttentionInput = {
	/** Whether the open workspace syncs at all; a private one has nothing to say. */
	synced: boolean;
	keyRetired: boolean;
	lastError: string | null;
	usage: { storageBytes: number; maxBytes: number } | null;
	online: boolean;
	/** Time of the last sync, 0 when none. */
	lastSync: number;
	now: number;
};

/** Offline for a day without a sync is worth a word; a flaky hour is not. */
export const OFFLINE_ATTENTION_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A sync that went through but has something to say: skipped records, a photo
 * that could not be prepared, uploads the quota held back. Those read as written;
 * everything else in `lastError` is a sync that stopped.
 */
export function isSyncWarning(raw: string): boolean {
	return /^(Synced\b|Skipped\b|Sync incomplete\b)/.test(raw);
}

/** Sync errors as people read them: a dead connection is not a stack of fetch jargon. */
export function friendlySyncError(raw: string | null | undefined, fallback: string): string {
	if (!raw) return fallback;
	if (/Failed to fetch|NetworkError|network error/i.test(raw))
		return 'the server could not be reached';
	return raw;
}

/** "a day", "2 days": how long the device has gone without a sync. */
export function offlineFor(ms: number): string {
	const days = Math.max(1, Math.floor(ms / DAY_MS));
	return days === 1 ? 'a day' : `${days} days`;
}

/** Every state that needs attention right now, the most pressing first. */
export function syncAttentions(input: SyncAttentionInput): SyncAttention[] {
	const all: SyncAttention[] = [];
	if (!input.synced) return all;
	if (input.keyRetired) {
		all.push({
			kind: SyncAttentionKind.KeyRetired,
			tone: 'danger',
			title: 'This workspace can no longer sync.',
			body: 'Its key was deleted from the cloud. A new key keeps your notes here.',
			action: 'open-settings',
			actionLabel: 'Create new key',
			key: SyncAttentionKind.KeyRetired,
			dismissible: false
		});
	}
	if (input.lastError) {
		const warning = isSyncWarning(input.lastError);
		const reason = friendlySyncError(input.lastError, 'something went wrong');
		all.push({
			kind: SyncAttentionKind.Error,
			tone: warning ? 'warning' : 'danger',
			title: warning ? input.lastError : `Sync stopped: ${reason.replace(/\.$/, '')}.`,
			body: warning ? '' : 'Your notes are safe on this device.',
			action: 'retry',
			actionLabel: 'Retry',
			key: `${SyncAttentionKind.Error}:${input.lastError}`,
			dismissible: true
		});
	}
	const ratio =
		input.usage && input.usage.maxBytes > 0 ? input.usage.storageBytes / input.usage.maxBytes : 0;
	if (ratio >= 1) {
		all.push({
			kind: SyncAttentionKind.StorageFull,
			tone: 'danger',
			title: 'Cloud storage is full.',
			body: 'New changes stop syncing until there is room.',
			action: 'open-settings',
			actionLabel: 'Open workspaces',
			key: SyncAttentionKind.StorageFull,
			dismissible: false
		});
	} else if (ratio >= 0.8) {
		all.push({
			kind: SyncAttentionKind.StorageNearlyFull,
			tone: 'warning',
			title: `Cloud storage is ${Math.floor(ratio * 100)}% full.`,
			body: 'At 100%, new changes stop syncing.',
			action: 'open-settings',
			actionLabel: 'Open workspaces',
			key: SyncAttentionKind.StorageNearlyFull,
			dismissible: true
		});
	}
	if (!input.online && input.lastSync > 0 && input.now - input.lastSync >= OFFLINE_ATTENTION_MS) {
		all.push({
			kind: SyncAttentionKind.Offline,
			tone: 'muted',
			title: `Offline for ${offlineFor(input.now - input.lastSync)}.`,
			body: 'Your notes are safe here and will sync when you are back online.',
			action: null,
			actionLabel: null,
			key: SyncAttentionKind.Offline,
			dismissible: true
		});
	}
	return all;
}

/** The one state to show when nothing has been dismissed. */
export function resolveSyncAttention(input: SyncAttentionInput): SyncAttention | null {
	return syncAttentions(input)[0] ?? null;
}
