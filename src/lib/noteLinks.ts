// The address of an open note: its fragment names the note and the workspace
// it lives in, so the address is a link that opens the note on any device
// holding that workspace. It lives in the fragment, which never leaves the
// browser, so no server or proxy log sees it. The workspace is named by a
// one-way tag: it reveals neither the sync key nor the account id.
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

/** The note an address points at. A reminder link names no workspace and opens in the active one. */
export function readNoteLink(url: URL): NoteLinkTarget | null {
	const params = new URLSearchParams(url.hash.slice(1));
	const noteId = params.get(NOTE_PARAM);
	if (!noteId) return null;
	return { noteId, workspaceTag: params.get(WORKSPACE_PARAM) || null };
}

type OpenNote = { profile: Pick<StoredProfile, 'id' | 'syncKey'>; noteId: string };

/**
 * This address with `note` open, or with no note when `note` is null. Only the
 * note's own fragment parameters change; the view path, query and any other
 * fragment parameter (a pairing code) stay.
 */
export function withNoteLink(url: URL, note: OpenNote | null): string {
	const params = new URLSearchParams(url.hash.slice(1));
	params.delete(WORKSPACE_PARAM);
	params.delete(NOTE_PARAM);
	if (note) {
		params.set(WORKSPACE_PARAM, workspaceLinkTag(note.profile));
		params.set(NOTE_PARAM, note.noteId);
	}
	const hash = params.toString();
	return `${url.pathname}${url.search}${hash ? `#${hash}` : ''}`;
}

/** A link to share: the app's home with the note in its fragment. */
export function noteShareLink(origin: string, note: OpenNote): string {
	return new URL(withNoteLink(new URL('/', origin), note), origin).toString();
}

export function profileForWorkspaceTag<T extends Pick<StoredProfile, 'id' | 'syncKey'>>(
	profiles: readonly T[],
	tag: string
): T | null {
	return profiles.find((profile) => workspaceLinkTag(profile) === tag) ?? null;
}
