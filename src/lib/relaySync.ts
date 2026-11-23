// One sync of a workspace with the relay: an end-to-end encrypted delta, record by
// record. It is handed what the workspace's database holds and a way to save what
// it pulls there; which workspace a window shows plays no part. What it learns of
// the relay on the way (progress, usage, errors) it records with its host.

import type { Note, NoteImage } from '#lib/types.js';
import { withoutAttachmentsHistoryNeeds } from '#lib/attachmentRetention.js';
import { mergeCanvasLibrary } from '#lib/canvasLibrary.js';
import {
	commitSyncControl,
	getOutboxGeneration,
	getSyncOutboxKeys,
	getSyncState,
	markSyncOutbox
} from '#lib/db/idb.js';
import { loadNoteHistory } from '#lib/historyClient.js';
import { mergeKanbanBoards } from '#lib/kanban.js';
import { mergeLabelLists, mergeNoteLists, withoutTombstoned } from '#lib/model/index.js';
import { SYNC_DELTA_PATH } from '#lib/model/protocol.js';
import type { StoredProfile } from '#lib/profiles.js';
import {
	relayNotReached,
	type RelayAnswer,
	type RelayClient,
	type SyncAccount,
	type SyncProgress
} from '#lib/relayClient.js';
import {
	currentRecordKeys,
	emptyRelayAttachments,
	fingerprintMapFrom,
	noteRecordForRelay,
	planDeletableKeys,
	reconcileBaseline,
	referencedAttachmentIds,
	relayHeldVersions,
	syncRoundHasMore,
	syncControlKeys,
	type RelayAttachments
} from '#lib/syncEngine.js';
import { sha256 } from '#lib/syncHash.js';
import { MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST } from '#lib/syncLimits.js';
import {
	decryptSyncPayload,
	encryptSyncPayload,
	identityFromSyncKey,
	randomOpaqueId
} from '#lib/syncPairing.js';
import {
	attachmentToImage,
	attachmentRefKey,
	buildSyncRecords,
	hydrateNoteImages,
	isSyncRecordPayload,
	syncRecordKey,
	syncSnapshot,
	type SyncRecord,
	type SyncRecordPayload,
	type SyncSnapshot
} from '#lib/syncRecords.js';
import { RELAY_SILENCE_MS, wait, withinTime } from '#lib/syncRetry.js';

/**
 * How long an answer about which photos a note's history needs is trusted. The relay can
 * drop old versions for quota without the note changing; a photo they named waits at
 * most this long, plus a sync, to be reclaimed.
 */
export const HISTORY_RECHECK_MS = 60 * 60_000;

/** Encrypted profile-name record; the name follows its sync key across devices. */
export const PROFILE_META_KEY = 'profile-meta';

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

/** The workspace a sync runs for, and the account it syncs with. */
type SyncTarget = { account: SyncAccount; pid: string };

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

function mergeTombstoneMaps(
	local: Record<string, number>,
	remote: unknown
): Record<string, number> {
	if (!remote || typeof remote !== 'object') return local;
	const merged = { ...local };
	for (const [id, timestamp] of Object.entries(remote as Record<string, unknown>)) {
		const value = Number(timestamp) || 0;
		if (value > (merged[id] || 0)) merged[id] = value;
	}
	return merged;
}

/** What is known of one workspace's sync. */
export type WorkspaceSyncState = {
	lastSync: number;
	lastError: string | null;
	/** The error of the last sync that failed only because the relay was not reached. */
	unreachableError: string | null;
	/** The key's cloud data was deleted, so the relay will never accept it again.
	 * The workspace can only keep syncing on a new key. */
	keyRetired: boolean;
	progress: SyncProgress | null;
	usage: SyncUsage | null;
	syncedCursor: number;
};

export const NOTHING_KNOWN: Readonly<WorkspaceSyncState> = Object.freeze({
	lastSync: 0,
	lastError: null,
	unreachableError: null,
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
		const key = `note:${noteId}`;
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
		return this.syncTarget(
			{ account: identityFromSyncKey(profile.syncKey), pid: profile.id },
			syncSnapshot(),
			true,
			undefined,
			signal
		);
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
		return this.syncTarget(
			{ account: identityFromSyncKey(profile.syncKey), pid: profile.id },
			local,
			false,
			applyPulled,
			signal
		);
	}

	/** End-to-end encrypted per-record delta. Uploads only dirty outbox keys. */
	private async syncTarget(
		{ account, pid }: SyncTarget,
		local: SyncSnapshot,
		/** Only read the relay's copy: see `read`. */
		read: boolean,
		applyPulled?: ApplyPulled,
		signal?: AbortSignal
	): Promise<SyncResult> {
		// Aborting `signal` ends the sync at its next step without waiting on the relay.
		// What it had not committed stays queued, and the next sync sends or reads it again.
		// So does taking the workspace, or its key, off this device.
		const syncCancelled = (): boolean =>
			signal?.aborted === true || !this.host.holds(pid, account.syncKey);
		// What this sync learns is recorded for its workspace, while it is on this key.
		const record = (): WorkspaceSyncState => this.host.state(pid, account.syncKey);
		let bootstrap = false;
		try {
			const ATTACHMENT_UPLOAD_BUDGET = 2;
			// A large page is bounded by the relay's own byte cap, so notes pull
			// tens at once while photos keep their own rounds small.
			const DOWNLOAD_LIMIT = 50;
			const MAX_RESET_RETRIES = 3;
			const MAX_THROTTLED_WAITS = 5;
			let resetRetries = 0;
			let throttledWaits = 0;
			const quotaBlockedKeys = new Set<string>();
			let quotaSingleUpload = false;
			const keys = syncControlKeys(account.accountId);
			// A read starts from nothing: what this device has synced before is not its business.
			const stored = <T>(key: string): Promise<T | undefined> =>
				read ? Promise.resolve(undefined) : getSyncState<T>(pid, key).catch(() => undefined);
			let baseline: Record<string, string> = {};
			const durable = await stored<unknown>(keys.baseline);
			if (durable && typeof durable === 'object' && !Array.isArray(durable))
				baseline = Object.fromEntries(
					Object.entries(durable).filter(
						([key, value]) => typeof key === 'string' && typeof value === 'string'
					)
				);
			// What the relay holds of attachments is learned from what this device downloads
			// and uploads. A device without that record starts over and downloads everything.
			const knownRelay = await stored<RelayAttachments>(keys.relayAttachments);
			if (!knownRelay?.versions || !knownRelay.listed) baseline = {};
			const firstFullUpload = Object.keys(baseline).length === 0;
			let relay: RelayAttachments =
				firstFullUpload || !knownRelay ? emptyRelayAttachments() : knownRelay;
			let recordIds = (await stored<Record<string, string>>(keys.recordIds)) ?? {};
			if (!recordIds || typeof recordIds !== 'object' || Array.isArray(recordIds)) recordIds = {};
			// A first upload sends everything over several rounds, and a rewrite of the workspace or a
			// closed tab may cut it short. Queued before it starts, what was not sent
			// yet is sent by the sync after; otherwise only later edits would be.
			if (firstFullUpload && !read) await markSyncOutbox(pid, currentRecordKeys(local));
			const outboxSnapshotAt = await getOutboxGeneration(pid);
			let outboxKeys = new Set(read ? [] : await getSyncOutboxKeys(pid).catch(() => []));
			let cursor = Number((await stored<number>(keys.cursor)) || 0);
			if (firstFullUpload && cursor > 0) cursor = 0;

			let merged: SyncSnapshot = {
				...local,
				tombstones: { ...local.tombstones },
				labelTombstones: { ...local.labelTombstones },
				boardTombstones: { ...local.boardTombstones },
				libraryTombstones: { ...local.libraryTombstones }
			};
			const attachments = new Map<string, NoteImage>();
			for (const note of local.notes) {
				for (const image of note.images ?? []) {
					if (!image.dataUrl?.length) continue;
					const hash = await sha256(image.dataUrl);
					const withHash = { ...image, contentHash: hash };
					attachments.set(attachmentRefKey(image.id, hash), withHash);
					attachments.set(image.id, withHash);
				}
			}

			let hasMore = true;
			let downloadsDrained = false;
			// One history lookup per note version for the whole sync: the plan before a round
			// and the check after it ask the same question, and a lookup that failed is not
			// worth repeating until the next sync.
			const historyLookups = new Map<string, Promise<Set<string> | null>>();
			const historyAttachmentIds = (note: Note) => {
				const key = `${note.id}\u0000${note.updatedAt}`;
				let lookup = historyLookups.get(key);
				if (!lookup) {
					lookup = this.versionAttachmentIds(account, note, signal);
					historyLookups.set(key, lookup);
				}
				return lookup;
			};
			// Deletes a history version still needs wait for a later sync, so they are neither
			// sent nor counted as work that keeps this one going.
			const plannedDeletes = async () =>
				(
					await withoutAttachmentsHistoryNeeds(
						planDeletableKeys({
							recordIds,
							snapshot: merged,
							pullOnly: read,
							catchUpComplete: downloadsDrained
						}),
						merged.notes,
						merged.tombstones,
						historyAttachmentIds
					)
				).filter((key) => key !== PROFILE_META_KEY);
			const acknowledgedOutbox = new Set<string>();
			const uploadedThisSync = new Map<string, string>();
			/** Keep the record of the relay's attachments in step with a record it holds. */
			const sawOnRelay = (payload: SyncRecordPayload): void => {
				if (payload.kind === 'attachment') relay.versions[payload.value.id] = payload.value.hash;
				else if (payload.kind === 'note-tombstone') delete relay.listed[payload.id];
				else if (payload.kind === 'note') {
					// A deleted note's record protects nothing: its attachments may be cleaned up.
					if (Number(merged.tombstones[payload.value.id]) > 0)
						delete relay.listed[payload.value.id];
					else
						relay.listed[payload.value.id] = (payload.value.images ?? []).map((image) => image.id);
				}
			};
			const internallyMarkedOutbox = new Map<string, number>();
			let poisonCount = 0;
			let stalledWrites = 0;
			while (hasMore) {
				if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
				const startedWithDownloadsDrained = downloadsDrained;
				const uploadKeys =
					read || !downloadsDrained ? new Set<string>() : firstFullUpload ? undefined : outboxKeys;
				const currentRecords = await buildSyncRecords(merged, uploadKeys);
				const metaUploadDue =
					!read &&
					downloadsDrained &&
					outboxKeys.has(PROFILE_META_KEY) &&
					!quotaBlockedKeys.has(PROFILE_META_KEY) &&
					(uploadKeys === undefined || uploadKeys.has(PROFILE_META_KEY));
				if (metaUploadDue) {
					const metaPayload = {
						kind: 'profile-meta' as const,
						value: { name: this.host.name(pid) }
					};
					currentRecords.push({
						key: PROFILE_META_KEY,
						fingerprint: await sha256(metaPayload),
						payload: metaPayload
					});
				}
				// The relay never lists an attachment version it does not hold: a request
				// commits whole, so bytes travel in the same one as the notes that list them,
				// and every note is sent listing only what the relay holds once it commits.
				const uploading = read || !downloadsDrained ? [] : currentRecords;
				const relayHeld = relayHeldVersions(relay);
				const noteRecords = uploading.filter((record) => record.payload.kind === 'note');
				const listsAttachment = (record: SyncRecord, id: string, hash: string): boolean =>
					record.payload.kind === 'note' &&
					(record.payload.value.images ?? []).some(
						(image) => image.id === id && image.hash === hash
					);
				const sendingAttachments: SyncRecord[] = [];
				const carriers: SyncRecord[] = [];
				for (const record of uploading) {
					if (sendingAttachments.length >= (quotaSingleUpload ? 1 : ATTACHMENT_UPLOAD_BUDGET))
						break;
					if (record.payload.kind !== 'attachment' || quotaBlockedKeys.has(record.key)) continue;
					const { id, hash } = record.payload.value;
					if (relayHeld.get(id) === hash) continue;
					// Every note the relay has listing this attachment is rewritten with it, and
					// at least one note lists the new version: none may be left naming bytes
					// the relay has replaced.
					const listing = noteRecords.filter((note) => listsAttachment(note, id, hash));
					const listedOnRelay = Object.entries(relay.listed)
						.filter(([, ids]) => ids.includes(id))
						.map(([noteId]) => `note:${noteId}`);
					const rewritten = noteRecords.filter((note) => listedOnRelay.includes(note.key));
					const needed = [...new Set([...listing.slice(0, 1), ...rewritten])];
					const together = new Set([...carriers, ...needed]).size + sendingAttachments.length + 1;
					if (
						listing.length === 0 ||
						rewritten.length < listedOnRelay.length ||
						needed.some((note) => quotaBlockedKeys.has(note.key)) ||
						together > MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST
					)
						continue;
					sendingAttachments.push(record);
					for (const note of needed) if (!carriers.includes(note)) carriers.push(note);
				}
				const heldAfter = new Map(relayHeld);
				for (const record of sendingAttachments) {
					if (record.payload.kind === 'attachment')
						heldAfter.set(record.payload.value.id, record.payload.value.hash);
				}
				const forRelay = (record: SyncRecord) => noteRecordForRelay(record, heldAfter);
				const changed = (
					await Promise.all(
						uploading
							.filter((record) => record.payload.kind !== 'attachment')
							.map(async (record) => ({ local: record, sent: await forRelay(record) }))
					)
				).filter(
					// A note the relay already holds as it would be sent needs no sending.
					({ sent }) => !quotaBlockedKeys.has(sent.key) && baseline[sent.key] !== sent.fingerprint
				);
				// The notes an attachment travels with go first, so the request holds them.
				const first = changed.filter(({ local }) => carriers.includes(local));
				const rest = changed.filter(({ local }) => !carriers.includes(local));
				// Under quota pressure a round sends the least that commits alone: one
				// attachment with its notes, or one other record.
				const outgoing: SyncRecord[] = quotaSingleUpload
					? sendingAttachments.length
						? [...sendingAttachments, ...first.map(({ sent }) => sent)]
						: rest.slice(0, 1).map(({ sent }) => sent)
					: [...sendingAttachments, ...[...first, ...rest].map(({ sent }) => sent)].slice(
							0,
							MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST
						);
				// Attachments past this round's budget go in the next one, once this one is in.
				const dueAttachments = uploading.filter(
					(record) =>
						record.payload.kind === 'attachment' &&
						!quotaBlockedKeys.has(record.key) &&
						relayHeld.get(record.payload.value.id) !== record.payload.value.hash
				).length;
				const uploadsLeft =
					outgoing.length > 0 ? dueAttachments + changed.length - outgoing.length : 0;
				const sentRecordKeys = new Set(outgoing.map((record) => record.key));
				const sentIds = new Set<string>();
				const sentRecordIds = new Map<string, string>();
				const sentSlots = new Map<string, string>();
				const outbound = await Promise.all(
					outgoing.map(async (record: SyncRecord) => {
						const id = randomOpaqueId();
						sentIds.add(id);
						sentRecordIds.set(record.key, id);
						// Keyed, non-reversible slot token: relay can replace old ciphertext but cannot
						// infer whether this is a note, attachment, board, or its plaintext identity.
						const slot = await sha256(`${account.syncKey}\u0000${record.key}`);
						sentSlots.set(slot, record.key);
						const expectedId = recordIds[record.key] ?? null;
						// Only a version this editing session uploaded is continued; one another
						// device or an earlier session wrote stays in the history.
						// So is a note this sync sent a moment ago with fewer attachments listed:
						// the two are one version, arriving in steps.
						const uploadedId =
							this.editSessions.get(record.key)?.uploadedId ?? uploadedThisSync.get(record.key);
						return {
							id,
							slot,
							expectedId,
							...(uploadedId && uploadedId === expectedId ? { continues: true } : {}),
							ciphertext: encryptSyncPayload(account.syncKey, record.payload, slot)
						};
					})
				);
				const currentKeys = currentRecordKeys(merged);
				if (recordIds[PROFILE_META_KEY] || sentRecordIds.has(PROFILE_META_KEY) || metaUploadDue)
					currentKeys.add(PROFILE_META_KEY);
				// Slot tokens are keyed hashes of record keys, so an unreadable envelope can
				// still be identified locally. Adopting its id lets a later upload replace
				// it or a delete reclaim it instead of stranding the slot on the relay;
				// keys this device already tracks keep their existing mapping.
				let knownSlotMap: Promise<Map<string, string>> | null = null;
				const knownSlotKey = async (slot: string): Promise<string | undefined> => {
					const sentKey = sentSlots.get(slot);
					if (sentKey) return sentKey;
					knownSlotMap ??= Promise.all(
						[...new Set([...Object.keys(recordIds), ...currentKeys])].map(
							async (key) => [await sha256(`${account.syncKey}\u0000${key}`), key] as const
						)
					).then((entries) => new Map(entries));
					return (await knownSlotMap).get(slot);
				};
				const deletableKeys = (await plannedDeletes()).slice(
					0,
					MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST - outbound.length
				);
				const deleteSlots = await Promise.all(
					deletableKeys.map(async (key) => ({
						id: recordIds[key],
						slot: await sha256(`${account.syncKey}\u0000${key}`)
					}))
				);
				const payload = JSON.stringify({
					cursor,
					limit: DOWNLOAD_LIMIT,
					envelopes: outbound,
					deleteSlots
				});
				const response = await this.relay.sendSyncRequest(
					SYNC_DELTA_PATH,
					payload,
					new Blob([payload]).size,
					(progress) => (record().progress = progress),
					account,
					signal,
					syncCancelled
				);
				if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
				if (!response.success && response.status === 507 && outgoing.length > 0) {
					if (!quotaSingleUpload && outgoing.length > 1) quotaSingleUpload = true;
					else {
						const blockedKey = outgoing[0].key;
						quotaBlockedKeys.add(blockedKey);
						await markSyncOutbox(pid, [blockedKey]);
						outboxKeys.add(blockedKey);
						quotaSingleUpload = false;
					}
					hasMore = true;
					continue;
				}
				// A large sync can outrun the relay's per-minute budget. Nothing was written,
				// so it waits as long as the relay asks and sends the round again.
				if (
					!response.success &&
					response.retryAfterSeconds !== undefined &&
					throttledWaits < MAX_THROTTLED_WAITS
				) {
					throttledWaits += 1;
					await wait(Math.min(response.retryAfterSeconds, 30) * 1000, signal);
					continue;
				}
				if (!response.success || !response.data) return this.fail(response, record());
				throttledWaits = 0;
				const remoteUsage = response.data.usage;
				if (remoteUsage && typeof remoteUsage === 'object') {
					const candidate = remoteUsage as Partial<SyncUsage>;
					if (
						[
							candidate.ciphertextBytes,
							candidate.envelopeCount,
							candidate.storageBytes,
							candidate.maxBytes
						].every((value) => typeof value === 'number' && Number.isFinite(value))
					) {
						record().usage = candidate as SyncUsage;
					}
				}
				const writesAccepted = response.data.writesAccepted === true;
				const conflicts = Array.isArray(response.data.conflicts) ? response.data.conflicts : [];
				// A conflict response returns only conflicting slots, but its cursor may
				// include unrelated writes. Catch those up before retrying the upload.
				const conflictNeedsCatchUp = !writesAccepted && conflicts.length > 0;
				if (writesAccepted) {
					if (outgoing.length > 0 || deleteSlots.length > 0) stalledWrites = 0;
					for (const key of deletableKeys) {
						delete recordIds[key];
						if (key.startsWith('attachment:')) delete relay.versions[key.slice(11)];
						if (key.startsWith('note:')) delete relay.listed[key.slice(5)];
					}
					for (const record of outgoing) sawOnRelay(record.payload);
					for (const [key, id] of sentRecordIds) {
						recordIds[key] = id;
						uploadedThisSync.set(key, id);
						const session = this.editSessions.get(key);
						if (session) session.uploadedId = id;
					}
					for (const key of deletableKeys) acknowledgedOutbox.add(key);
				}
				if (response.data.reset === true) {
					// The relay was deliberately reset while this device retained a baseline.
					// The caller sends this device's whole copy, attachments included, next.
					resetRetries += 1;
					if (resetRetries > MAX_RESET_RETRIES)
						throw new Error('Relay repeatedly requested a state reset');
					bootstrap = true;
					baseline = {};
					recordIds = {};
					relay = emptyRelayAttachments();
					cursor = 0;
					continue;
				}

				const pendingNotes: Note[] = [];
				const remoteFingerprints: Record<string, string> = {};
				let decodedAny = false;
				let adoptedConflictId = false;
				const applyPayload = (record: SyncRecordPayload) => {
					sawOnRelay(record);
					switch (record.kind) {
						case 'attachment': {
							const image = attachmentToImage(record.value);
							attachments.set(attachmentRefKey(record.value.id, record.value.hash), image);
							attachments.set(record.value.id, image);
							break;
						}
						case 'note':
							pendingNotes.push(hydrateNoteImages(record.value, attachments));
							break;
						case 'label':
							merged.labels = mergeLabelLists(merged.labels, [record.value]);
							break;
						case 'board':
							merged.boards = mergeKanbanBoards(
								merged.boards,
								[record.value],
								merged.boardTombstones
							);
							break;
						case 'library-item':
							merged.libraryItems = mergeCanvasLibrary(
								merged.libraryItems,
								[record.value],
								merged.libraryTombstones
							);
							break;
						case 'note-tombstone':
							merged.tombstones = mergeTombstoneMaps(merged.tombstones, {
								[record.id]: record.deletedAt
							});
							break;
						case 'label-tombstone':
							merged.labelTombstones = mergeTombstoneMaps(merged.labelTombstones, {
								[record.id]: record.deletedAt
							});
							break;
						case 'board-tombstone':
							merged.boardTombstones = mergeTombstoneMaps(merged.boardTombstones, {
								[record.id]: record.deletedAt
							});
							break;
						case 'library-item-tombstone':
							merged.libraryTombstones = mergeTombstoneMaps(merged.libraryTombstones, {
								[record.id]: record.deletedAt
							});
							break;
						case 'profile-meta':
							// A read changes nothing on this device, the workspace's name included.
							if (
								!read &&
								typeof (record as { value?: { name?: unknown } }).value?.name === 'string'
							)
								this.host.named(pid, (record as { value: { name: string } }).value.name);
							break;
					}
				};
				const downloaded = Array.isArray(response.data.envelopes) ? response.data.envelopes : [];
				const envelopes = [...downloaded, ...conflicts];
				for (const envelope of envelopes) {
					if (!envelope || typeof envelope !== 'object') {
						poisonCount += 1;
						continue;
					}
					const id =
						typeof (envelope as { id?: unknown }).id === 'string'
							? (envelope as { id: string }).id
							: '';
					const slot =
						typeof (envelope as { slot?: unknown }).slot === 'string'
							? (envelope as { slot: string }).slot
							: '';
					if (id && sentIds.has(id)) continue;
					if (typeof (envelope as { ciphertext?: unknown }).ciphertext !== 'string') {
						poisonCount += 1;
						continue;
					}
					let decodedRecords: SyncRecordPayload[] | null = null;
					try {
						const payload = decryptSyncPayload(
							account.syncKey,
							(envelope as { ciphertext: string }).ciphertext,
							slot
						);
						decodedRecords = isSyncRecordPayload(payload) ? [payload] : null;
					} catch {
						decodedRecords = null;
					}
					if (!decodedRecords) {
						poisonCount += 1;
						const key = slot ? await knownSlotKey(slot) : undefined;
						if (key && id && (sentSlots.has(slot) || !recordIds[key])) {
							recordIds[key] = id;
							adoptedConflictId = true;
						}
						continue;
					}
					decodedAny = true;
					const ordered = [
						...decodedRecords.filter((record) => record.kind === 'attachment'),
						...decodedRecords.filter((record) => record.kind !== 'attachment')
					];
					for (const record of ordered) {
						applyPayload(record);
						const key = syncRecordKey(record);
						recordIds[key] = id;
						remoteFingerprints[key] = await sha256(record);
						currentKeys.add(key);
					}
				}
				if (!writesAccepted && (outgoing.length > 0 || deleteSlots.length > 0)) {
					if (decodedAny || adoptedConflictId || downloaded.length > 0) {
						stalledWrites = 0;
					} else {
						stalledWrites += 1;
						if (stalledWrites >= 3) {
							throw new Error('Could not commit encrypted writes after repeated conflicts');
						}
					}
				}
				if (pendingNotes.length) {
					merged.notes = mergeNoteLists(
						merged.notes,
						pendingNotes.map((note) => hydrateNoteImages(note, attachments))
					);
				}
				merged.notes = merged.notes.map((note) => hydrateNoteImages(note, attachments));

				if (typeof response.data.cursor === 'number' && !conflictNeedsCatchUp) {
					cursor = response.data.cursor;
				}
				downloadsDrained = !conflictNeedsCatchUp && response.data.hasMore !== true;

				merged.notes = withoutTombstoned(merged.notes, merged.tombstones);
				merged.labels = withoutTombstoned(merged.labels, merged.labelTombstones);
				merged.boards = withoutTombstoned(merged.boards, merged.boardTombstones);
				merged.libraryItems = mergeCanvasLibrary([], merged.libraryItems, merged.libraryTombstones);
				if (
					downloadsDrained &&
					(!startedWithDownloadsDrained || envelopes.length > 0) &&
					applyPulled
				) {
					if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
					merged = await applyPulled(merged, pid, {
						relayHolds: (id, hash) => relayHeldVersions(relay).get(id) === hash,
						relayHas: (id, hash) => {
							if (hash === null) delete relay.versions[id];
							else relay.versions[id] = hash;
						},
						owes: async (owed) => {
							const generation = await markSyncOutbox(pid, owed);
							for (const key of owed) {
								outboxKeys.add(key);
								internallyMarkedOutbox.set(key, generation);
							}
						}
					});
					for (const note of merged.notes) {
						for (const image of note.images ?? []) {
							if (!image.dataUrl?.length) continue;
							const hash = await sha256(image.dataUrl);
							const withHash = { ...image, contentHash: hash };
							attachments.set(attachmentRefKey(image.id, hash), withHash);
							attachments.set(image.id, withHash);
						}
					}
				}
				if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
				const mergedRecords = await buildSyncRecords(
					merged,
					new Set([...sentRecordKeys, ...Object.keys(remoteFingerprints), ...outboxKeys])
				);
				const uploadedFingerprints = writesAccepted
					? Object.fromEntries(outgoing.map((record) => [record.key, record.fingerprint]))
					: {};
				const mergedFingerprints = fingerprintMapFrom(mergedRecords);
				const reconciled = reconcileBaseline({
					previous: baseline,
					uploaded: uploadedFingerprints,
					remote: remoteFingerprints,
					merged: mergedFingerprints,
					currentKeys: currentRecordKeys(merged),
					referencedAttachments: referencedAttachmentIds(merged.notes, merged.tombstones),
					catchUpComplete: downloadsDrained
				});
				baseline = reconciled.baseline;
				for (const key of reconciled.ackKeys) acknowledgedOutbox.add(key);
				if (reconciled.dirtyKeys.length && !read) {
					const generation = await markSyncOutbox(pid, reconciled.dirtyKeys);
					for (const key of reconciled.dirtyKeys) {
						outboxKeys.add(key);
						internallyMarkedOutbox.set(key, generation);
					}
				}

				if (downloadsDrained) {
					const heldNow = relayHeldVersions(relay);
					const listedHere = new Map<string, string[]>();
					for (const record of mergedRecords) {
						if (record.payload.kind !== 'note') continue;
						for (const image of record.payload.value.images ?? []) {
							listedHere.set(image.id, [...(listedHere.get(image.id) ?? []), image.hash]);
						}
					}
					for (const key of outboxKeys) {
						if (!currentKeys.has(key)) {
							acknowledgedOutbox.add(key);
						} else if (
							// An attachment the relay holds in every version listed here has
							// nothing left to send, whether or not its bytes were loaded.
							key.startsWith('attachment:') &&
							(listedHere.get(key.slice(11)) ?? []).every(
								(hash) => heldNow.get(key.slice(11)) === hash
							)
						) {
							acknowledgedOutbox.add(key);
						} else if (
							// Queued, but the relay already holds it as it is (pinned and unpinned
							// before a sync, say): nothing is left to send.
							recordIds[key] &&
							mergedFingerprints[key] !== undefined &&
							mergedFingerprints[key] === baseline[key]
						) {
							acknowledgedOutbox.add(key);
						}
					}
					const internalAcknowledgements = new Map<number, string[]>();
					for (const key of acknowledgedOutbox) {
						const markedAt = internallyMarkedOutbox.get(key);
						if (markedAt == null) continue;
						const keysAtGeneration = internalAcknowledgements.get(markedAt) ?? [];
						keysAtGeneration.push(key);
						internalAcknowledgements.set(markedAt, keysAtGeneration);
					}
					if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
					if (!read) {
						await commitSyncControl(
							pid,
							[
								[keys.cursor, cursor],
								[keys.baseline, baseline],
								[keys.recordIds, recordIds],
								[keys.relayAttachments, relay]
							],
							[
								{ keys: acknowledgedOutbox, through: outboxSnapshotAt },
								...[...internalAcknowledgements].map(([markedAt, keysAtGeneration]) => ({
									keys: keysAtGeneration,
									through: markedAt
								}))
							]
						);
						record().syncedCursor = cursor;
					}
					for (const keysAtGeneration of internalAcknowledgements.values()) {
						for (const key of keysAtGeneration) internallyMarkedOutbox.delete(key);
					}
				}

				const pendingOutboxUpload = [...outboxKeys].some(
					(key) => !acknowledgedOutbox.has(key) && !quotaBlockedKeys.has(key)
				);
				const remainingUploads =
					!read &&
					((!startedWithDownloadsDrained && (firstFullUpload || pendingOutboxUpload)) ||
						(!writesAccepted && (outgoing.length > 0 || deleteSlots.length > 0)) ||
						uploadsLeft > 0);
				const pendingDeletes = downloadsDrained && (await plannedDeletes()).length > 0;
				hasMore = syncRoundHasMore({
					remoteHasMore: response.data.hasMore === true,
					remainingUploads,
					pendingDeletes
				});
			}

			if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
			if (read)
				return {
					success: true,
					snapshot: merged,
					control: {
						[keys.cursor]: cursor,
						[keys.baseline]: baseline,
						[keys.recordIds]: recordIds,
						[keys.relayAttachments]: relay
					}
				};
			if (quotaBlockedKeys.size > 0 && poisonCount === 0)
				return this.fail(
					{
						success: false,
						error: 'Sync incomplete: account storage quota prevented some uploads',
						refused: true
					},
					record()
				);
			const syncedAt = Date.now();
			const state = record();
			state.lastError =
				poisonCount > 0
					? `Skipped ${poisonCount} unreadable sync record${poisonCount === 1 ? '' : 's'}`
					: null;
			state.lastSync = syncedAt;
			this.host.settled(pid, syncedAt);
			return { success: true, snapshot: merged, ...(bootstrap ? { bootstrap } : {}) };
		} catch (err) {
			if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
			return this.fail(
				{
					success: false,
					error:
						err instanceof Error
							? `Encrypted sync failed: ${err.message}`
							: 'Encrypted sync failed',
					...(relayNotReached(err) ? { unreachable: true } : {})
				},
				record()
			);
		} finally {
			record().progress = null;
		}
	}

	/** A failed sync's answer, recorded for its workspace. */
	private fail(result: SyncResult, state: WorkspaceSyncState): SyncResult {
		const error = result.error || 'Sync failed';
		state.unreachableError = result.unreachable ? error : null;
		state.lastError = error;
		// The relay's own "no" stands until something changes. A sign-in that expired,
		// a request it gave up on and a request to slow down are not that.
		const refused =
			result.refused === true ||
			(result.status !== undefined &&
				result.status >= 400 &&
				result.status < 500 &&
				![401, 408, 429].includes(result.status));
		return { success: false, error, ...(refused ? { refused } : {}) };
	}
}
