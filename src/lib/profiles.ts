// Profile keyring: saved sync keys ("profiles"). Each profile owns a
// namespaced dataset directly in the shared object stores, so switching is a
// pointer change plus an in-memory reload — no data copying.
import {
	deleteStoredProfile,
	listStoredProfiles,
	readStoredProfiles,
	putStoredProfile,
	LOCAL_PROFILE_ID,
	copyProfileNamespace,
	getAllNotesMetadata,
	getAllLabels,
	getSyncState,
	hydrateNoteAttachments,
	scopedStateKey
} from '$lib/db/idb';
import { BOARDS_IDB, BOARD_IDB, LABEL_IDB, NOTE_IDB } from '$lib/syncTombstones';
import {
	readNotesMirror,
	writeNotesMirror,
	readLabelsMirror,
	writeLabelsMirror
} from './noteStorage';
import type { KanbanBoard } from '$lib/kanban';
import type { Note } from '$lib/types';
import type { ScrapsCacheBackup } from '$lib/backup';
import { randomWorkspaceName } from '$lib/workspaceNames';

export type { StoredProfile } from '$lib/db/idb';
import type { StoredProfile } from '$lib/db/idb';

const LS_LAST_ACTIVE = 'scrapscache-last-active-profile';
const LS_LAST_ACTIVE_LEGACY = 'gkc-last-active-profile';
const LS_LEGACY_ACCOUNT = 'scrapscache-sync-account';
const LS_ADOPTED_LOCAL = 'scrapscache-adopted-local-into';
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
	return profiles.find((profile) => profile.syncKey === syncKey) ?? null;
}

export function nextProfileName(existing: readonly { name: string }[]): string {
	return randomWorkspaceName(existing.map((entry) => entry.name));
}

// --- Active-profile pointer -------------------------------------------------
// Per-origin default for newly opened windows; each window keeps its own
// active profile in memory once booted.

export function getLastActiveProfileId(): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(LS_LAST_ACTIVE) ?? localStorage.getItem(LS_LAST_ACTIVE_LEGACY);
	} catch {
		return null;
	}
}

export function setLastActiveProfileId(id: string | null): void {
	if (typeof localStorage === 'undefined') return;
	try {
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
 * else the legacy single-account mirror's entry, else the only entry, else
 * none (the window runs on the local no-key namespace until one is created).
 */
export function pickBootProfile(profiles: StoredProfile[]): StoredProfile | null {
	if (!profiles.length) return null;
	const pointer = getLastActiveProfileId();
	if (pointer === LOCAL_PROFILE_ID) return null;
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

/**
 * Give a key created from the anonymous workspace ownership of its local data
 * so registering does not look like data loss.
 */
export async function adoptLocalDatasetInto(pid: string): Promise<void> {
	await copyProfileDatasetInto(LOCAL_PROFILE_ID, pid);
}

/** Copy one workspace's device-local dataset into a newly created profile. */
export async function copyProfileDatasetInto(fromPid: string, toPid: string): Promise<void> {
	await copyProfileNamespace(fromPid, toPid);
	try {
		const notes = readNotesMirror(fromPid);
		if (notes.length) writeNotesMirror(notes, toPid);
		const labels = readLabelsMirror(fromPid);
		if (labels.length) writeLabelsMirror(labels, toPid);
	} catch {}
}

// --- Adopted anonymous data ----------------------------------------------
// Adoption copies the anonymous workspace into the profile that now owns it,
// which leaves the rows in two places. The copy is only dropped once the cloud
// has confirmed it, so a failed or partial sync keeps the originals and retries
// on a later sync. Recorded in localStorage so a reload cannot lose the intent.

export function markAdoptedLocalData(pid: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(LS_ADOPTED_LOCAL, pid);
	} catch (err) {
		console.error('[profiles] could not record the adopted anonymous workspace:', err);
	}
}

export function adoptedLocalDataPid(): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(LS_ADOPTED_LOCAL);
	} catch {
		return null;
	}
}

/**
 * Stop tracking the adopted copy. Called both when it has been dropped and
 * whenever the anonymous workspace gains data of its own, so notes the user put
 * there deliberately are never mistaken for a leftover copy.
 */
export function forgetAdoptedLocalData(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(LS_ADOPTED_LOCAL);
	} catch {
		/* nothing durable depends on the marker going away */
	}
}

// --- Per-profile exports ----------------------------------------------------

/**
 * Build a standard notes backup file from any profile's namespace without
 * activating it. Never carries sync identity: importing lands as plain notes.
 */
export async function buildProfileNotesExport(pid: string): Promise<ScrapsCacheBackup | null> {
	const noteRows = await getAllNotesMetadata(pid);
	if (!noteRows.length && !(await getAllLabels(pid)).length) return null;
	const notes: Note[] = [];
	for (const row of noteRows) notes.push(await hydrateNoteAttachments(pid, row));
	const [labels, boards, tombstones, labelTombstones, boardTombstones] = await Promise.all([
		getAllLabels(pid),
		getSyncState<KanbanBoard[]>(scopedStateKey(BOARDS_IDB, pid)),
		getSyncState<Record<string, number>>(scopedStateKey(NOTE_IDB, pid)),
		getSyncState<Record<string, number>>(scopedStateKey(LABEL_IDB, pid)),
		getSyncState<Record<string, number>>(scopedStateKey(BOARD_IDB, pid))
	]);
	return {
		version: 4,
		exportedAt: Date.now(),
		notes,
		labels,
		boards: Array.isArray(boards) ? boards : [],
		activeBoardId: '',
		tombstones: tombstones ?? {},
		labelTombstones: labelTombstones ?? {},
		boardTombstones: boardTombstones ?? {},
		ui: { sidebarOpen: true, dark: null, layout: 'grid', view: 'notes' }
	};
}
