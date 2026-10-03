// Workspace keyring: every workspace on this device, private or synced. Each one
// owns its own database, so switching is a pointer change plus an in-memory
// reload — no data copying.
import {
	deleteStoredProfile,
	listStoredProfiles,
	readStoredProfiles,
	putStoredProfile,
	getAllNotesMetadata,
	getAllLabels,
	getSyncState,
	hydrateNoteAttachments
} from '#lib/db/idb.js';
import { BOARDS_IDB, BOARD_IDB, LABEL_IDB, NOTE_IDB } from '#lib/syncTombstones.js';
import type { KanbanBoard } from '#lib/kanban.js';
import type { Note } from '#lib/types.js';
import type { ScrapsCacheBackup } from '#lib/backup.js';
import { randomWorkspaceName } from '#lib/workspaceNames.js';
import { libraryItemsFor, readCanvasLibrary } from '#lib/canvasLibrary.js';
import { readReminderHistory } from '#lib/reminderHistory.js';

export type { StoredProfile } from '#lib/db/idb.js';
import type { StoredProfile } from '#lib/db/idb.js';

const LS_LAST_ACTIVE = 'scrapscache-last-active-profile';
const LS_LAST_ACTIVE_LEGACY = 'gkc-last-active-profile';
const LS_LEGACY_ACCOUNT = 'scrapscache-sync-account';
const LS_LEGACY_ACCOUNT_OLD = 'gkc-sync-account';
export function readProfiles(): StoredProfile[] {
	const profiles = readStoredProfiles();
	return profiles.sort((a, b) => a.createdAt - b.createdAt);
}

export async function loadProfiles(): Promise<StoredProfile[]> {
	const profiles = await listStoredProfiles();
	return profiles.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveProfile(profile: StoredProfile): Promise<void> {
	await putStoredProfile(profile);
}

/** Removes the keyring entry together with its entire namespaced dataset. */
export async function removeProfileRecord(id: string): Promise<void> {
	await deleteStoredProfile(id);
}

/** The keyring entry matching an active sync key, if any. */
export function profileForSyncKey(
	profiles: StoredProfile[],
	syncKey: string
): StoredProfile | null {
	if (!syncKey) return null;
	return profiles.find((profile) => profile.syncKey === syncKey) ?? null;
}

/** Local-only workspaces have no sync key and never talk to the relay. */
export function isLocalWorkspace(profile: StoredProfile): boolean {
	return !profile.syncKey;
}

/** Names sent with a grant. Repeated names get a numeric suffix so each vault stays addressable. */
export function mcpWorkspaceGrant(
	profiles: readonly StoredProfile[]
): { name: string; syncKey: string }[] {
	const used = new Map<string, number>();
	return profiles
		.filter((profile) => profile.syncKey)
		.map((profile) => {
			const base = profile.name.trim() || 'Workspace';
			const count = used.get(base) ?? 0;
			used.set(base, count + 1);
			return {
				name: count === 0 ? base : `${base} ${count + 1}`,
				syncKey: profile.syncKey
			};
		});
}

export function nextProfileName(existing: readonly { name: string }[]): string {
	return randomWorkspaceName(existing.map((entry) => entry.name));
}

// --- Active-profile pointer -------------------------------------------------
// Two layers: a per-tab pointer in sessionStorage keeps a tab on its own
// workspace across refreshes, while the shared localStorage pointer stays the
// per-origin default for newly opened windows.

const SS_LAST_ACTIVE = 'scrapscache-last-active-profile-tab';

export function getLastActiveProfileId(): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		if (typeof sessionStorage !== 'undefined') {
			const tabPointer = sessionStorage.getItem(SS_LAST_ACTIVE);
			if (tabPointer) return tabPointer;
		}
		return localStorage.getItem(LS_LAST_ACTIVE) ?? localStorage.getItem(LS_LAST_ACTIVE_LEGACY);
	} catch {
		return null;
	}
}

export function setLastActiveProfileId(id: string | null): void {
	if (typeof localStorage === 'undefined') return;
	try {
		if (typeof sessionStorage !== 'undefined') {
			if (id) sessionStorage.setItem(SS_LAST_ACTIVE, id);
			else sessionStorage.removeItem(SS_LAST_ACTIVE);
		}
		if (id) {
			localStorage.setItem(LS_LAST_ACTIVE, id);
		} else {
			localStorage.removeItem(LS_LAST_ACTIVE);
			localStorage.removeItem(LS_LAST_ACTIVE_LEGACY);
		}
	} catch (err) {
		console.error('[profiles] could not save the last active profile:', err);
	}
}

/**
 * Boot selection: the last active pointer when it still exists in the keyring,
 * else the legacy single-account mirror's entry, else the oldest entry.
 */
export function pickBootProfile(profiles: StoredProfile[]): StoredProfile | null {
	if (!profiles.length) return null;
	const pointer = getLastActiveProfileId();
	if (pointer) {
		const pointed = profiles.find((profile) => profile.id === pointer);
		if (pointed) return pointed;
	}
	let wantedSyncKey: string | null = null;
	try {
		const raw =
			typeof localStorage !== 'undefined'
				? (localStorage.getItem(LS_LEGACY_ACCOUNT) ?? localStorage.getItem(LS_LEGACY_ACCOUNT_OLD))
				: null;
		const parsed = raw ? (JSON.parse(raw) as { syncKey?: unknown }) : null;
		if (parsed && typeof parsed.syncKey === 'string') wantedSyncKey = parsed.syncKey;
	} catch {
		/* unreadable mirror falls through */
	}
	if (wantedSyncKey) {
		const match = profileForSyncKey(profiles, wantedSyncKey);
		if (match) return match;
	}
	return profiles[0];
}

// --- Per-profile exports ----------------------------------------------------

/**
 * Build a standard notes backup file from any profile's namespace without
 * activating it. Never carries sync identity: importing lands as plain notes.
 */
export async function buildProfileNotesExport(pid: string): Promise<ScrapsCacheBackup | null> {
	const noteRows = await getAllNotesMetadata(pid);
	const [labels, boards, tombstones, labelTombstones, boardTombstones, library, reminderHistory] =
		await Promise.all([
			getAllLabels(pid),
			getSyncState<KanbanBoard[]>(pid, BOARDS_IDB),
			getSyncState<Record<string, number>>(pid, NOTE_IDB),
			getSyncState<Record<string, number>>(pid, LABEL_IDB),
			getSyncState<Record<string, number>>(pid, BOARD_IDB),
			readCanvasLibrary(pid),
			readReminderHistory(pid)
		]);
	if (!noteRows.length && !labels.length && !library.entries.length) return null;
	const notes: Note[] = [];
	for (const row of noteRows) notes.push(await hydrateNoteAttachments(pid, row));
	return {
		version: 5,
		exportedAt: Date.now(),
		notes,
		labels,
		boards: Array.isArray(boards) ? boards : [],
		activeBoardId: '',
		tombstones: tombstones ?? {},
		labelTombstones: labelTombstones ?? {},
		boardTombstones: boardTombstones ?? {},
		canvasLibrary: libraryItemsFor(library.entries),
		reminderHistory,
		ui: { sidebarOpen: true, dark: null, layout: 'grid', view: 'notes', rawMarkdown: false }
	};
}
