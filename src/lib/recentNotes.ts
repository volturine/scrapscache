// The notes opened last in a workspace, newest first, for the palette's Recent list.
// They stay on this device: a list of ids in localStorage, never synced or backed up.
import { workspaceKey } from '#lib/db/idb.js';

const KEY = 'scrapscache-recent-notes';
const LIMIT = 8;

export function readRecentNotes(pid: string): string[] {
	if (!pid || typeof localStorage === 'undefined') return [];
	try {
		const ids: unknown = JSON.parse(localStorage.getItem(workspaceKey(KEY, pid)) ?? '[]');
		if (!Array.isArray(ids)) return [];
		return ids.filter((id): id is string => typeof id === 'string').slice(0, LIMIT);
	} catch {
		return [];
	}
}

export function rememberRecentNote(pid: string, id: string): void {
	if (!pid || typeof localStorage === 'undefined') return;
	const ids = [id, ...readRecentNotes(pid).filter((known) => known !== id)].slice(0, LIMIT);
	try {
		localStorage.setItem(workspaceKey(KEY, pid), JSON.stringify(ids));
	} catch {
		// A full localStorage costs the Recent list an entry, nothing else.
	}
}

export function clearRecentNotes(pid: string): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.removeItem(workspaceKey(KEY, pid));
}
