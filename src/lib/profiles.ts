// Workspace keyring: every workspace on this device, private or synced. Each one
// owns its own database, so switching is a pointer change plus an in-memory
// reload — no data copying.
import {
	deleteStoredProfile,
	listStoredProfiles,
	readStoredProfiles,
	putStoredProfile,
	getAllNotesMetadata,
	hydrateNoteAttachments
} from '#lib/db/idb.js';
import type { Note } from '#lib/types.js';
import { randomWorkspaceName } from '#lib/workspaceNames.js';

export type { StoredProfile } from '#lib/db/idb.js';
import type { StoredProfile } from '#lib/db/idb.js';

const LS_LAST_ACTIVE = 'scrapscache-last-active-profile';
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
		return localStorage.getItem(LS_LAST_ACTIVE);
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
		if (id) localStorage.setItem(LS_LAST_ACTIVE, id);
		else localStorage.removeItem(LS_LAST_ACTIVE);
	} catch (err) {
		console.error('[profiles] could not save the last active profile:', err);
	}
}

/**
 * Boot selection: the last active pointer when it still exists in the keyring,
 * else the oldest entry.
 */
export function pickBootProfile(profiles: StoredProfile[]): StoredProfile | null {
	if (!profiles.length) return null;
	const pointer = getLastActiveProfileId();
	if (pointer) {
		const pointed = profiles.find((profile) => profile.id === pointer);
		if (pointed) return pointed;
	}
	return profiles[0];
}

// --- Per-profile exports ----------------------------------------------------

/** Read every note and its attachment bytes from one workspace without activating it. */
export async function buildProfileMarkdownNotes(pid: string): Promise<Note[] | null> {
	const noteRows = await getAllNotesMetadata(pid);
	if (!noteRows.length) return null;
	const notes: Note[] = [];
	for (const row of noteRows) notes.push(await hydrateNoteAttachments(pid, row));
	return notes;
}
