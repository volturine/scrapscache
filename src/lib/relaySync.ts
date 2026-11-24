// One sync of a workspace with the relay: an end-to-end encrypted delta, record by
// record. It is handed what the workspace's database holds and a way to save what
// it pulls there; which workspace a window shows plays no part. What it learns of
// the relay on the way (progress, usage, errors) it records with its host.

import type { Note } from '#lib/types.js';
import { loadNoteHistory } from '#lib/historyClient.js';
import type { StoredProfile } from '#lib/profiles.js';
import {
	type RelayAnswer,
	type RelayClient,
	type SyncAccount,
	type SyncProgress
} from '#lib/relayClient.js';
import { identityFromSyncKey } from '#lib/syncPairing.js';
import { recordKey, syncSnapshot, type SyncSnapshot } from '#lib/syncRecords.js';
import { RELAY_SILENCE_MS, withinTime } from '#lib/syncRetry.js';
import { SyncRun } from '#lib/relaySyncRun.js';

/**
 * How long an answer about which photos a note's history needs is trusted. The relay can
 * drop old versions for quota without the note changing; a photo they named waits at
 * most this long, plus a sync, to be reclaimed.
 */
export const HISTORY_RECHECK_MS = 60 * 60_000;

export interface SyncUsage {
	ciphertextBytes: number;
	envelopeCount: number;
	storageBytes: number;
	maxBytes: number;
}

export type SyncResult = RelayAnswer & {
	/** The workspace as the sync left it. */
	snapshot?: SyncSnapshot;
	/** The relay was reset, so the next sync has to send this device's whole copy. */
	bootstrap?: boolean;
	/** The relay answered and will not take this as it is: asking again changes nothing. */
	refused?: boolean;
	/**
	 * After `read`: the sync state of a device that holds exactly `snapshot`, by its
	 * workspace state key. Whoever writes that copy commits this with it.
	 */
	control?: Record<string, unknown>;
};

/**
 * How a sync of a workspace ended, for whoever decides when it runs next: settled
 * with the relay; failed in a way that trying again later may get past; or refused
 * by the relay, which the same request would be again.
 */
export type SyncOutcome = 'synced' | 'failed' | 'refused';

export function syncOutcome(result: { success: boolean; refused?: boolean }): SyncOutcome {
	if (result.success) return 'synced';
	return result.refused ? 'refused' : 'failed';
}

/**
 * Applies what a flight pulled. The workspace is handed over with it: a flight
 * belongs to the workspace it started in, and the window may have moved to
 * another one by the time the bytes are decrypted.
 */
export type ApplyPulled = (
	snapshot: SyncSnapshot,
	pid: string,
	pulled: PulledRelayState
) => Promise<SyncSnapshot>;

/** What a drained download tells whoever saves it about the relay. */
export type PulledRelayState = {
	/** True when the relay holds this attachment version and a note there lists it. */
	relayHolds: (id: string, hash: string) => boolean;
	/** Record the version found when the relay was asked for an attachment by name. */
	relayHas: (id: string, hash: string | null) => void;
	/** Queue records this device now has to send. */
	owes: (keys: string[]) => Promise<void>;
};

/**
 * What a workspace's last sync has to say, in words, and what kind of thing it is:
 * the interface decides by the kind, never by the wording.
 */
export type SyncIssue = {
	kind:
		| /** The relay was not reached. Nothing is wrong here, and it is tried again by itself. */ 'unreachable'
		| /** The sync went through and has something to say. */ 'warning'
		| /** The relay would not sign this key in. */ 'sign-in'
		| /** The sync stopped for any other reason. */ 'stopped';
	message: string;
};

/** What is known of one workspace's sync. */
export type WorkspaceSyncState = {
	lastSync: number;
	issue: SyncIssue | null;
	/** The key's cloud data was deleted, so the relay will never accept it again.
	 * The workspace can only keep syncing on a new key. */
	keyRetired: boolean;
	progress: SyncProgress | null;
	usage: SyncUsage | null;
	syncedCursor: number;
};

export const NOTHING_KNOWN: Readonly<WorkspaceSyncState> = Object.freeze({
	lastSync: 0,
	issue: null,
	keyRetired: false,
	progress: null,
	usage: null,
	syncedCursor: 0
});

/** What a sync needs to know of the device it runs on, and where it records what it learns. */
export interface SyncHost {
	/** True while this device holds the workspace under this key. A sync ends once it does not. */
	holds(pid: string, syncKey: string): boolean;
	/** The workspace's name here, which travels as an encrypted record of its own. */
	name(pid: string): string;
	/** The name another device gave the workspace. */
	named(pid: string, name: string): void;
	/**
	 * The record of what is known of the workspace's sync, to write into. What was
	 * learned under `syncKey` is kept only while the workspace is still on that key.
	 */
	state(pid: string, syncKey: string): WorkspaceSyncState;
	/** The workspace settled with the relay at `at`. */
	settled(pid: string, at: number): void;
}

export class RelaySync {
	/**
	 * Attachment ids a note's retained versions list, as of the note's last change. Quota
	 * eviction can drop a version without changing the note, so an answer is also only
	 * trusted for HISTORY_RECHECK_MS; until then a photo it still names is just kept longer.
	 */
	private versionAttachments = new Map<
		string,
		{ updatedAt: number; checkedAt: number; ids: Set<string> }
	>();
	/** Notes open in the editor, by record key, with the envelope id each session last uploaded. */
	private editSessions = new Map<string, { uploadedId: string | null }>();

	constructor(
		private readonly relay: RelayClient,
		private readonly host: SyncHost
	) {}

	/**
	 * Start one history version for a note opened in the editor: every upload until the
	 * returned function ends the session continues that version instead of adding one.
	 */
	beginEditSession(noteId: string): () => void {
		const key = recordKey('note', noteId);
		const session = { uploadedId: null };
		this.editSessions.set(key, session);
		return () => {
			if (this.editSessions.get(key) === session) this.editSessions.delete(key);
		};
	}

	/** Attachment ids the note's retained history lists; null when it cannot be read. */
	private async versionAttachmentIds(
		account: SyncAccount,
		note: Note,
		signal?: AbortSignal
	): Promise<Set<string> | null> {
		const key = `${account.accountId}\u0000${note.id}`;
		const cached = this.versionAttachments.get(key);
		if (cached?.updatedAt === note.updatedAt && Date.now() - cached.checkedAt < HISTORY_RECHECK_MS)
			return cached.ids;
		try {
			const versions = await withinTime(RELAY_SILENCE_MS, signal, (limited) =>
				loadNoteHistory(account, note.id, limited)
			);
			const ids = new Set(
				versions.flatMap((version) => (version.note.images ?? []).map((image) => image.id))
			);
			this.versionAttachments.set(key, { updatedAt: note.updatedAt, checkedAt: Date.now(), ids });
			return ids;
		} catch {
			return null;
		}
	}

	/**
	 * Read everything the relay holds for a workspace, sending nothing. It starts
	 * from the beginning whatever this device has synced before, and nothing on this
	 * device records that it was read: `snapshot` is the relay's copy, and `control`
	 * the sync state of a device holding exactly that. For an operation that rewrites
	 * the workspace from the relay's copy and commits both in one step.
	 */
	read(profile: StoredProfile, signal: AbortSignal): Promise<SyncResult> {
		if (!profile.syncKey) return Promise.resolve({ success: false, error: 'Not linked' });
		return this.start(profile, syncSnapshot(), true, undefined, signal);
	}

	/**
	 * Sync a workspace with the relay. `local` is what its database holds and
	 * `applyPulled` saves there. Progress, usage and errors are recorded for that
	 * workspace with the host.
	 */
	sync(
		profile: StoredProfile,
		local: SyncSnapshot,
		applyPulled: ApplyPulled,
		signal: AbortSignal
	): Promise<SyncResult> {
		if (!profile.syncKey) return Promise.resolve({ success: false, error: 'Not linked' });
		return this.start(profile, local, false, applyPulled, signal);
	}

	/** One sync of the workspace: an end-to-end encrypted delta, record by record. */
	private start(
		profile: StoredProfile,
		local: SyncSnapshot,
		read: boolean,
		applyPulled: ApplyPulled | undefined,
		signal: AbortSignal
	): Promise<SyncResult> {
		return new SyncRun(
			{
				relay: this.relay,
				host: this.host,
				editSessions: this.editSessions,
				versionAttachmentIds: (account, note, limit) =>
					this.versionAttachmentIds(account, note, limit)
			},
			identityFromSyncKey(profile.syncKey),
			profile.id,
			local,
			read,
			applyPulled,
			signal
		).run();
	}
}
