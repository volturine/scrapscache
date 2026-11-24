// When a note is sent because of what the person did with it, decided in one
// place: the editor and the composer say what happened, not when to sync.
import { relaySync, syncStore } from '#lib/stores/sync.svelte.js';
import { syncScheduler } from '#lib/stores/syncScheduler.js';

/**
 * A note was put away: what its workspace has queued is sent now, not after the
 * pause that typing gets. False when there was nothing to send.
 */
export function notePutAway(): Promise<boolean> {
	return syncScheduler.flush(syncStore.activeId);
}

/**
 * A note open in an editor. Everything it uploads while it is open continues one
 * history version on the relay, where each later sync would otherwise add one.
 */
export class EditSession {
	private endVersion: () => void;

	/** `noteId` is null for an editor that has no note yet. */
	constructor(noteId: string | null) {
		this.endVersion = noteId ? relaySync.beginEditSession(noteId) : () => undefined;
	}

	/**
	 * What was written so far stays a version of its own: it is sent now, and
	 * `cut` then starts the next one.
	 */
	send(): Promise<boolean> {
		return notePutAway();
	}

	/** The next change of the note starts another version. */
	cut(noteId: string): void {
		this.endVersion();
		this.endVersion = relaySync.beginEditSession(noteId);
	}

	/** The note is put away: its last upload still belongs to this version, which ends with it. */
	close(): void {
		void this.send().finally(this.endVersion);
	}

	/** The editor went away without closing the note: the version ends, and nothing is sent for it. */
	drop(): void {
		this.endVersion();
	}
}
