// Links that open one note in the workspace it lives in, on any device that
// holds that workspace. A link names the workspace by a one-way tag: it reveals
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

export function noteLink(
	origin: string,
	profile: Pick<StoredProfile, 'id' | 'syncKey'>,
	noteId: string
): string {
	const url = new URL('/', origin);
	url.searchParams.set(WORKSPACE_PARAM, workspaceLinkTag(profile));
	url.searchParams.set(NOTE_PARAM, noteId);
	return url.toString();
}

export type NoteLinkTarget = { noteId: string; workspaceTag: string | null };

/** The note a URL points at. Links without a workspace (reminder notifications) open in the active one. */
export function readNoteLink(url: URL): NoteLinkTarget | null {
	const noteId = url.searchParams.get(NOTE_PARAM);
	if (!noteId) return null;
	return { noteId, workspaceTag: url.searchParams.get(WORKSPACE_PARAM) || null };
}

/** The same URL without its note link, for replaceState once the link is handled. */
export function withoutNoteLink(url: URL): string {
	const next = new URL(url);
	next.searchParams.delete(WORKSPACE_PARAM);
	next.searchParams.delete(NOTE_PARAM);
	return `${next.pathname}${next.search}${next.hash}`;
}

export function profileForWorkspaceTag<T extends Pick<StoredProfile, 'id' | 'syncKey'>>(
	profiles: readonly T[],
	tag: string
): T | null {
	return profiles.find((profile) => workspaceLinkTag(profile) === tag) ?? null;
}
