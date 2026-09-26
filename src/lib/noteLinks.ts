// The address of an open note: it names the note and the workspace it lives in,
// so copying it gives a link that opens the note on any device holding that
// workspace. A link names the workspace by a one-way tag: it reveals
// neither the sync key nor the account id, and the relay, which never sees
// sync keys, cannot map it back to an account.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { StoredProfile } from '$lib/profiles';

const WORKSPACE_PARAM = 'w';
const NOTE_PARAM = 'note';
const encoder = new TextEncoder();

/**
 * Stable per workspace and the same on every device that holds it. A private
 * workspace has no shared key, so its tag only matches on this device.
 */
export function workspaceLinkTag(profile: Pick<StoredProfile, 'id' | 'syncKey'>): string {
	const source = profile.syncKey
		? `scraps-cache-workspace-link:v1:${profile.syncKey}`
		: `scraps-cache-workspace-link:local:v1:${profile.id}`;
	return bytesToHex(sha256(encoder.encode(source)).slice(0, 12));
}

export type NoteLinkTarget = { noteId: string; workspaceTag: string | null };

/** The note a URL points at. Links without a workspace (reminder notifications) open in the active one. */
export function readNoteLink(url: URL): NoteLinkTarget | null {
	const noteId = url.searchParams.get(NOTE_PARAM);
	if (!noteId) return null;
	return { noteId, workspaceTag: url.searchParams.get(WORKSPACE_PARAM) || null };
}

/**
 * The address for this URL with `note` open in `profile`, or with no note when
 * `note` is null. Only the link parameters change; path, other params and hash stay.
 */
export function withNoteLink(
	url: URL,
	note: { profile: Pick<StoredProfile, 'id' | 'syncKey'>; noteId: string } | null
): string {
	const next = new URL(url);
	next.searchParams.delete(WORKSPACE_PARAM);
	next.searchParams.delete(NOTE_PARAM);
	if (note) {
		next.searchParams.set(WORKSPACE_PARAM, workspaceLinkTag(note.profile));
		next.searchParams.set(NOTE_PARAM, note.noteId);
	}
	return `${next.pathname}${next.search}${next.hash}`;
}

export function profileForWorkspaceTag<T extends Pick<StoredProfile, 'id' | 'syncKey'>>(
	profiles: readonly T[],
	tag: string
): T | null {
	return profiles.find((profile) => workspaceLinkTag(profile) === tag) ?? null;
}
