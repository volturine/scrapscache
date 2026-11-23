// One sync of a workspace under way: what it has learned of the relay so far, and
// the steps of a round. A round plans what to send, sends it, takes in what came
// back, has that saved, settles what the relay now holds against what this device
// holds, and commits. `run` is the loop over rounds; each step below is one of
// those, and reads top to bottom in the order a round takes them.

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
import { mergeKanbanBoards } from '#lib/kanban.js';
import { mergeLabelLists, mergeNoteLists, withoutTombstoned } from '#lib/model/index.js';
import { SYNC_DELTA_PATH } from '#lib/model/protocol.js';
import {
	relayNotReached,
	type RelayAnswer,
	type RelayClient,
	type SyncAccount
} from '#lib/relayClient.js';
import type {
	ApplyPulled,
	SyncHost,
	SyncIssue,
	SyncResult,
	SyncUsage,
	WorkspaceSyncState
} from '#lib/relaySync.js';
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
import { decryptSyncPayload, encryptSyncPayload, randomOpaqueId } from '#lib/syncPairing.js';
import {
	PROFILE_META_KEY,
	attachmentToImage,
	attachmentRefKey,
	buildSyncRecords,
	hydrateNoteImages,
	isSyncRecordPayload,
	recordId,
	recordKey,
	syncRecordKey,
	type SyncRecord,
	type SyncRecordPayload,
	type SyncSnapshot
} from '#lib/syncRecords.js';
import { wait } from '#lib/syncRetry.js';
import { newestTombstones, sanitizeTombstones, type Tombstones } from '#lib/syncTombstones.js';

const ATTACHMENT_UPLOAD_BUDGET = 2;
/**
 * A large page is bounded by the relay's own byte cap, so notes pull tens at once
 * while photos keep their own rounds small.
 */
const DOWNLOAD_LIMIT = 50;
const MAX_RESET_RETRIES = 3;
const MAX_THROTTLED_WAITS = 5;

const cancelled = (): SyncResult => ({ success: false, error: 'Sync was cancelled' });

/** `held` with a delete the relay sent, when that is the later one. What came off the wire is checked. */
const laterDelete = (held: Tombstones, id: string, deletedAt: unknown): Tombstones =>
	newestTombstones(held, sanitizeTombstones({ [id]: deletedAt }));

/** What a sync needs of the engine that runs it. */
export type SyncRunDeps = {
	relay: Pick<RelayClient, 'sendSyncRequest'>;
	host: SyncHost;
	/** Notes open in the editor, by record key, with the envelope id each session last uploaded. */
	editSessions: Map<string, { uploadedId: string | null }>;
	/** Attachment ids the note's retained history lists; null when it cannot be read. */
	versionAttachmentIds(
		account: SyncAccount,
		note: Note,
		signal?: AbortSignal
	): Promise<Set<string> | null>;
};

/** What a round decided to send, and how it named it to the relay. */
type Round = {
	/** Every download had been taken in before this round began. */
	startedDrained: boolean;
	outgoing: SyncRecord[];
	/** Uploads that did not fit this round. */
	uploadsLeft: number;
	sentRecordKeys: Set<string>;
	sentIds: Set<string>;
	sentRecordIds: Map<string, string>;
	sentSlots: Map<string, string>;
	/** The keys of the records this device holds, with what the round learns the relay holds. */
	currentKeys: Set<string>;
	/** The record key behind a slot token, for an envelope that could not be read. */
	knownSlotKey(slot: string): Promise<string | undefined>;
	deletableKeys: string[];
	deleteSlots: Array<{ id: string; slot: string }>;
	payload: string;
};

/** How the relay took what a round sent. */
type Accepted = {
	writesAccepted: boolean;
	conflicts: unknown[];
	/** A conflict's cursor may include unrelated writes: those are caught up before sending again. */
	conflictNeedsCatchUp: boolean;
};

/** What a round took in from the relay. */
type Taken = { remoteFingerprints: Record<string, string>; envelopes: number };

/** What this device and the relay hold after a round, record by record. */
type Settled = { mergedRecords: SyncRecord[]; mergedFingerprints: Record<string, string> };

export class SyncRun {
	private readonly keys: ReturnType<typeof syncControlKeys>;
	/** The fingerprint of each record as the relay holds it. */
	private baseline: Record<string, string> = {};
	/** What the relay holds of attachments, learned from what this device downloads and uploads. */
	private onRelay: RelayAttachments = emptyRelayAttachments();
	/** The envelope id of each record on the relay. */
	private recordIds: Record<string, string> = {};
	private cursor = 0;
	private outboxKeys = new Set<string>();
	private outboxSnapshotAt = 0;
	/** The relay has nothing of this device yet: everything is sent. */
	private firstFullUpload = false;
	/** The workspace as the sync has it so far. */
	private merged: SyncSnapshot;
	private readonly attachments = new Map<string, NoteImage>();
	private downloadsDrained = false;
	private bootstrap = false;
	private resetRetries = 0;
	private throttledWaits = 0;
	private readonly quotaBlockedKeys = new Set<string>();
	private quotaSingleUpload = false;
	private readonly acknowledgedOutbox = new Set<string>();
	private readonly uploadedThisSync = new Map<string, string>();
	private readonly internallyMarkedOutbox = new Map<string, number>();
	private poisonCount = 0;
	private stalledWrites = 0;
	/**
	 * One history lookup per note version for the whole sync: the plan before a round
	 * and the check after it ask the same question, and a lookup that failed is not
	 * worth repeating until the next sync.
	 */
	private readonly historyLookups = new Map<string, Promise<Set<string> | null>>();

	constructor(
		private readonly deps: SyncRunDeps,
		private readonly account: SyncAccount,
		private readonly pid: string,
		private readonly local: SyncSnapshot,
		/** Only read the relay's copy: nothing is sent, saved or committed. */
		private readonly read: boolean,
		private readonly applyPulled?: ApplyPulled,
		private readonly signal?: AbortSignal
	) {
		this.keys = syncControlKeys(account.accountId);
		this.merged = {
			...local,
			tombstones: { ...local.tombstones },
			labelTombstones: { ...local.labelTombstones },
			boardTombstones: { ...local.boardTombstones },
			libraryTombstones: { ...local.libraryTombstones }
		};
	}

	/**
	 * Aborting `signal` ends the sync at its next step without waiting on the relay.
	 * What it had not committed stays queued, and the next sync sends or reads it
	 * again. So does taking the workspace, or its key, off this device.
	 */
	private cancelled = (): boolean =>
		this.signal?.aborted === true || !this.deps.host.holds(this.pid, this.account.syncKey);

	/** What this sync learns is recorded for its workspace, while it is on this key. */
	private state(): WorkspaceSyncState {
		return this.deps.host.state(this.pid, this.account.syncKey);
	}

	async run(): Promise<SyncResult> {
		try {
			await this.load();
			let hasMore = true;
			while (hasMore) {
				if (this.cancelled()) return cancelled();
				const round = await this.plan();
				const response = await this.deps.relay.sendSyncRequest(
					SYNC_DELTA_PATH,
					round.payload,
					new Blob([round.payload]).size,
					(progress) => (this.state().progress = progress),
					this.account,
					this.signal,
					this.cancelled
				);
				if (this.cancelled()) return cancelled();
				if (!response.success && response.status === 507 && round.outgoing.length > 0) {
					await this.sendLess(round);
					continue;
				}
				// A large sync can outrun the relay's per-minute budget. Nothing was written,
				// so it waits as long as the relay asks and sends the round again.
				if (
					!response.success &&
					response.retryAfterSeconds !== undefined &&
					this.throttledWaits < MAX_THROTTLED_WAITS
				) {
					this.throttledWaits += 1;
					await wait(Math.min(response.retryAfterSeconds, 30) * 1000, this.signal);
					continue;
				}
				if (!response.success || !response.data) return this.fail(response);
				this.throttledWaits = 0;
				const data = response.data;
				const accepted = this.accept(round, data);
				if (data.reset === true) {
					await this.startOver();
					continue;
				}
				const taken = await this.takeIn(round, accepted, data);
				if (!(await this.save(round, taken))) return cancelled();
				if (this.cancelled()) return cancelled();
				const settled = await this.settle(round, accepted, taken);
				if (this.downloadsDrained && !(await this.commit(round, settled))) return cancelled();
				hasMore = await this.more(round, accepted, data);
			}
			if (this.cancelled()) return cancelled();
			return this.finish();
		} catch (err) {
			if (this.cancelled()) return cancelled();
			return this.fail({
				success: false,
				error:
					err instanceof Error ? `Encrypted sync failed: ${err.message}` : 'Encrypted sync failed',
				...(relayNotReached(err) ? { unreachable: true } : {})
			});
		} finally {
			this.state().progress = null;
		}
	}

	/** What this device recorded of the relay at its last sync, and what it has queued. */
	private async load(): Promise<void> {
		const { keys, pid, read } = this;
		// A read starts from nothing: what this device has synced before is not its business.
		const stored = <T>(key: string): Promise<T | undefined> =>
			read ? Promise.resolve(undefined) : getSyncState<T>(pid, key).catch(() => undefined);
		const durable = await stored<unknown>(keys.baseline);
		if (durable && typeof durable === 'object' && !Array.isArray(durable))
			this.baseline = Object.fromEntries(
				Object.entries(durable).filter(
					([key, value]) => typeof key === 'string' && typeof value === 'string'
				)
			);
		// What the relay holds of attachments is learned from what this device downloads
		// and uploads. A device without that record starts over and downloads everything.
		const knownRelay = await stored<RelayAttachments>(keys.relayAttachments);
		if (!knownRelay?.versions || !knownRelay.listed) this.baseline = {};
		this.firstFullUpload = Object.keys(this.baseline).length === 0;
		this.onRelay = this.firstFullUpload || !knownRelay ? emptyRelayAttachments() : knownRelay;
		let recordIds = (await stored<Record<string, string>>(keys.recordIds)) ?? {};
		if (!recordIds || typeof recordIds !== 'object' || Array.isArray(recordIds)) recordIds = {};
		this.recordIds = recordIds;
		// A first upload sends everything over several rounds, and a rewrite of the workspace or a
		// closed tab may cut it short. Queued before it starts, what was not sent
		// yet is sent by the sync after; otherwise only later edits would be.
		if (this.firstFullUpload && !read) await markSyncOutbox(pid, currentRecordKeys(this.local));
		this.outboxSnapshotAt = await getOutboxGeneration(pid);
		this.outboxKeys = new Set(read ? [] : await getSyncOutboxKeys(pid).catch(() => []));
		this.cursor = Number((await stored<number>(keys.cursor)) || 0);
		if (this.firstFullUpload && this.cursor > 0) this.cursor = 0;
		await this.holdBytesOf(this.local.notes);
	}

	/** Keep the bytes these notes carry at hand, by attachment and by version. */
	private async holdBytesOf(notes: Note[]): Promise<void> {
		for (const note of notes) {
			for (const image of note.images ?? []) {
				if (!image.dataUrl?.length) continue;
				const hash = await sha256(image.dataUrl);
				const withHash = { ...image, contentHash: hash };
				this.attachments.set(attachmentRefKey(image.id, hash), withHash);
				this.attachments.set(image.id, withHash);
			}
		}
	}

	private historyAttachmentIds = (note: Note): Promise<Set<string> | null> => {
		const key = `${note.id}\u0000${note.updatedAt}`;
		let lookup = this.historyLookups.get(key);
		if (!lookup) {
			lookup = this.deps.versionAttachmentIds(this.account, note, this.signal);
			this.historyLookups.set(key, lookup);
		}
		return lookup;
	};

	/**
	 * The records on the relay this device may delete. Deletes a history version still
	 * needs wait for a later sync, so they are neither sent nor counted as work that
	 * keeps this one going.
	 */
	private async plannedDeletes(): Promise<string[]> {
		return (
			await withoutAttachmentsHistoryNeeds(
				planDeletableKeys({
					recordIds: this.recordIds,
					snapshot: this.merged,
					pullOnly: this.read,
					catchUpComplete: this.downloadsDrained
				}),
				this.merged.notes,
				this.merged.tombstones,
				this.historyAttachmentIds
			)
		).filter((key) => key !== PROFILE_META_KEY);
	}

	/** Keep the record of the relay's attachments in step with a record it holds. */
	private sawOnRelay(payload: SyncRecordPayload): void {
		const { onRelay } = this;
		if (payload.kind === 'attachment') onRelay.versions[payload.value.id] = payload.value.hash;
		else if (payload.kind === 'note-tombstone') delete onRelay.listed[payload.id];
		else if (payload.kind === 'note') {
			// A deleted note's record protects nothing: its attachments may be cleaned up.
			if (Number(this.merged.tombstones[payload.value.id]) > 0)
				delete onRelay.listed[payload.value.id];
			else onRelay.listed[payload.value.id] = (payload.value.images ?? []).map((image) => image.id);
		}
	}

	/** The workspace's name as the record it travels as. */
	private namePayload() {
		return { kind: 'profile-meta' as const, value: { name: this.deps.host.name(this.pid) } };
	}

	/** A slot token: keyed and not reversible, so the relay can replace old ciphertext but cannot
	 * tell whether it is a note, an attachment or a board, or which one. */
	private slotOf(key: string): Promise<string> {
		return sha256(`${this.account.syncKey}\u0000${key}`);
	}

	/** Step 1: what this round sends and deletes, sealed for the relay. */
	private async plan(): Promise<Round> {
		const startedDrained = this.downloadsDrained;
		const uploadKeys =
			this.read || !this.downloadsDrained
				? new Set<string>()
				: this.firstFullUpload
					? undefined
					: this.outboxKeys;
		const currentRecords = await buildSyncRecords(this.merged, uploadKeys);
		const metaUploadDue =
			!this.read &&
			this.downloadsDrained &&
			this.outboxKeys.has(PROFILE_META_KEY) &&
			!this.quotaBlockedKeys.has(PROFILE_META_KEY) &&
			(uploadKeys === undefined || uploadKeys.has(PROFILE_META_KEY));
		if (metaUploadDue) {
			const metaPayload = this.namePayload();
			currentRecords.push({
				key: PROFILE_META_KEY,
				fingerprint: await sha256(metaPayload),
				payload: metaPayload
			});
		}
		const { outgoing, uploadsLeft } = await this.chooseUploads(
			this.read || !this.downloadsDrained ? [] : currentRecords
		);
		const sentRecordKeys = new Set(outgoing.map((record) => record.key));
		const sentIds = new Set<string>();
		const sentRecordIds = new Map<string, string>();
		const sentSlots = new Map<string, string>();
		const outbound = await Promise.all(
			outgoing.map(async (record: SyncRecord) => {
				const id = randomOpaqueId();
				sentIds.add(id);
				sentRecordIds.set(record.key, id);
				const slot = await this.slotOf(record.key);
				sentSlots.set(slot, record.key);
				const expectedId = this.recordIds[record.key] ?? null;
				// Only a version this editing session uploaded is continued; one another
				// device or an earlier session wrote stays in the history.
				// So is a note this sync sent a moment ago with fewer attachments listed:
				// the two are one version, arriving in steps.
				const uploadedId =
					this.deps.editSessions.get(record.key)?.uploadedId ??
					this.uploadedThisSync.get(record.key);
				return {
					id,
					slot,
					expectedId,
					...(uploadedId && uploadedId === expectedId ? { continues: true } : {}),
					ciphertext: encryptSyncPayload(this.account.syncKey, record.payload, slot)
				};
			})
		);
		const currentKeys = currentRecordKeys(this.merged);
		if (this.recordIds[PROFILE_META_KEY] || sentRecordIds.has(PROFILE_META_KEY) || metaUploadDue)
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
				[...new Set([...Object.keys(this.recordIds), ...currentKeys])].map(
					async (key) => [await this.slotOf(key), key] as const
				)
			).then((entries) => new Map(entries));
			return (await knownSlotMap).get(slot);
		};
		const deletableKeys = (await this.plannedDeletes()).slice(
			0,
			MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST - outbound.length
		);
		const deleteSlots = await Promise.all(
			deletableKeys.map(async (key) => ({
				id: this.recordIds[key],
				slot: await this.slotOf(key)
			}))
		);
		const payload = JSON.stringify({
			cursor: this.cursor,
			limit: DOWNLOAD_LIMIT,
			envelopes: outbound,
			deleteSlots
		});
		return {
			startedDrained,
			outgoing,
			uploadsLeft,
			sentRecordKeys,
			sentIds,
			sentRecordIds,
			sentSlots,
			currentKeys,
			knownSlotKey,
			deletableKeys,
			deleteSlots,
			payload
		};
	}

	/**
	 * Which of the records due go in this round. The relay never lists an attachment
	 * version it does not hold: a request commits whole, so bytes travel in the same
	 * one as the notes that list them, and every note is sent listing only what the
	 * relay holds once it commits.
	 */
	private async chooseUploads(
		uploading: SyncRecord[]
	): Promise<{ outgoing: SyncRecord[]; uploadsLeft: number }> {
		const { quotaBlockedKeys, quotaSingleUpload } = this;
		const relayHeld = relayHeldVersions(this.onRelay);
		const noteRecords = uploading.filter((record) => record.payload.kind === 'note');
		const listsAttachment = (record: SyncRecord, id: string, hash: string): boolean =>
			record.payload.kind === 'note' &&
			(record.payload.value.images ?? []).some((image) => image.id === id && image.hash === hash);
		const sendingAttachments: SyncRecord[] = [];
		const carriers: SyncRecord[] = [];
		for (const record of uploading) {
			if (sendingAttachments.length >= (quotaSingleUpload ? 1 : ATTACHMENT_UPLOAD_BUDGET)) break;
			if (record.payload.kind !== 'attachment' || quotaBlockedKeys.has(record.key)) continue;
			const { id, hash } = record.payload.value;
			if (relayHeld.get(id) === hash) continue;
			// Every note the relay has listing this attachment is rewritten with it, and
			// at least one note lists the new version: none may be left naming bytes
			// the relay has replaced.
			const listing = noteRecords.filter((note) => listsAttachment(note, id, hash));
			const listedOnRelay = Object.entries(this.onRelay.listed)
				.filter(([, ids]) => ids.includes(id))
				.map(([noteId]) => recordKey('note', noteId));
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
					.map(async (record) => ({ held: record, sent: await forRelay(record) }))
			)
		).filter(
			// A note the relay already holds as it would be sent needs no sending.
			({ sent }) => !quotaBlockedKeys.has(sent.key) && this.baseline[sent.key] !== sent.fingerprint
		);
		// The notes an attachment travels with go first, so the request holds them.
		const first = changed.filter(({ held }) => carriers.includes(held));
		const rest = changed.filter(({ held }) => !carriers.includes(held));
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
		return {
			outgoing,
			uploadsLeft: outgoing.length > 0 ? dueAttachments + changed.length - outgoing.length : 0
		};
	}

	/** The account is full for what the round sent: the next one sends less, or leaves a record out. */
	private async sendLess(round: Round): Promise<void> {
		if (!this.quotaSingleUpload && round.outgoing.length > 1) {
			this.quotaSingleUpload = true;
			return;
		}
		const blockedKey = round.outgoing[0].key;
		this.quotaBlockedKeys.add(blockedKey);
		await markSyncOutbox(this.pid, [blockedKey]);
		this.outboxKeys.add(blockedKey);
		this.quotaSingleUpload = false;
	}

	/** Step 2: how the relay took what was sent, and what it now holds because of it. */
	private accept(round: Round, data: Record<string, unknown>): Accepted {
		const remoteUsage = data.usage;
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
				this.state().usage = candidate as SyncUsage;
			}
		}
		const writesAccepted = data.writesAccepted === true;
		const conflicts: unknown[] = Array.isArray(data.conflicts) ? data.conflicts : [];
		if (writesAccepted) {
			if (round.outgoing.length > 0 || round.deleteSlots.length > 0) this.stalledWrites = 0;
			for (const key of round.deletableKeys) {
				delete this.recordIds[key];
				const attachmentId = recordId(key, 'attachment');
				if (attachmentId !== null) delete this.onRelay.versions[attachmentId];
				const noteId = recordId(key, 'note');
				if (noteId !== null) delete this.onRelay.listed[noteId];
			}
			for (const record of round.outgoing) this.sawOnRelay(record.payload);
			for (const [key, id] of round.sentRecordIds) {
				this.recordIds[key] = id;
				this.uploadedThisSync.set(key, id);
				const session = this.deps.editSessions.get(key);
				if (session) session.uploadedId = id;
			}
			for (const key of round.deletableKeys) this.acknowledgedOutbox.add(key);
		}
		return {
			writesAccepted,
			conflicts,
			conflictNeedsCatchUp: !writesAccepted && conflicts.length > 0
		};
	}

	/**
	 * The relay was deliberately reset while this device retained a baseline. It holds
	 * nothing of this device any more, so everything this device has is owed again.
	 * Queued here, in the database: whether this sync or the next sends it, and
	 * whatever is downloaded or uploaded first, none of it is taken for sent. What was
	 * acknowledged before the reset counts for nothing.
	 */
	private async startOver(): Promise<void> {
		this.resetRetries += 1;
		if (this.resetRetries > MAX_RESET_RETRIES)
			throw new Error('Relay repeatedly requested a state reset');
		this.bootstrap = true;
		this.baseline = {};
		this.recordIds = {};
		this.onRelay = emptyRelayAttachments();
		this.cursor = 0;
		this.acknowledgedOutbox.clear();
		if (this.read) return;
		await this.owe([...currentRecordKeys(this.merged), PROFILE_META_KEY]);
	}

	/**
	 * Queue records this device now has to send, in the database. A round having
	 * settled one of them earlier in this sync counts no more, or the mark just
	 * written would be cleared with it.
	 */
	private async owe(keys: string[]): Promise<void> {
		const generation = await markSyncOutbox(this.pid, keys);
		for (const key of keys) {
			this.outboxKeys.add(key);
			this.internallyMarkedOutbox.set(key, generation);
			this.acknowledgedOutbox.delete(key);
		}
	}

	/** Take one record the relay holds into the workspace as the sync has it. */
	private applyPayload(record: SyncRecordPayload, pendingNotes: Note[]): void {
		const { merged, attachments } = this;
		this.sawOnRelay(record);
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
				merged.boards = mergeKanbanBoards(merged.boards, [record.value], merged.boardTombstones);
				break;
			case 'library-item':
				merged.libraryItems = mergeCanvasLibrary(
					merged.libraryItems,
					[record.value],
					merged.libraryTombstones
				);
				break;
			case 'note-tombstone':
				merged.tombstones = laterDelete(merged.tombstones, record.id, record.deletedAt);
				break;
			case 'label-tombstone':
				merged.labelTombstones = laterDelete(merged.labelTombstones, record.id, record.deletedAt);
				break;
			case 'board-tombstone':
				merged.boardTombstones = laterDelete(merged.boardTombstones, record.id, record.deletedAt);
				break;
			case 'library-item-tombstone':
				merged.libraryTombstones = laterDelete(
					merged.libraryTombstones,
					record.id,
					record.deletedAt
				);
				break;
			case 'profile-meta':
				// A read changes nothing on this device, the workspace's name included.
				if (
					!this.read &&
					typeof (record as { value?: { name?: unknown } }).value?.name === 'string'
				)
					this.deps.host.named(this.pid, (record as { value: { name: string } }).value.name);
				break;
		}
	}

	/** Step 3: decrypt what the relay sent and take it into the workspace as the sync has it. */
	private async takeIn(
		round: Round,
		accepted: Accepted,
		data: Record<string, unknown>
	): Promise<Taken> {
		const { merged } = this;
		const pendingNotes: Note[] = [];
		const remoteFingerprints: Record<string, string> = {};
		let decodedAny = false;
		let adoptedConflictId = false;
		const downloaded: unknown[] = Array.isArray(data.envelopes) ? data.envelopes : [];
		const envelopes = [...downloaded, ...accepted.conflicts];
		for (const envelope of envelopes) {
			if (!envelope || typeof envelope !== 'object') {
				this.poisonCount += 1;
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
			if (id && round.sentIds.has(id)) continue;
			if (typeof (envelope as { ciphertext?: unknown }).ciphertext !== 'string') {
				this.poisonCount += 1;
				continue;
			}
			let decodedRecords: SyncRecordPayload[] | null = null;
			try {
				const payload = decryptSyncPayload(
					this.account.syncKey,
					(envelope as { ciphertext: string }).ciphertext,
					slot
				);
				decodedRecords = isSyncRecordPayload(payload) ? [payload] : null;
			} catch {
				decodedRecords = null;
			}
			if (!decodedRecords) {
				this.poisonCount += 1;
				const key = slot ? await round.knownSlotKey(slot) : undefined;
				if (key && id && (round.sentSlots.has(slot) || !this.recordIds[key])) {
					this.recordIds[key] = id;
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
				this.applyPayload(record, pendingNotes);
				const key = syncRecordKey(record);
				this.recordIds[key] = id;
				remoteFingerprints[key] = await sha256(record);
				round.currentKeys.add(key);
			}
		}
		if (!accepted.writesAccepted && (round.outgoing.length > 0 || round.deleteSlots.length > 0)) {
			if (decodedAny || adoptedConflictId || downloaded.length > 0) {
				this.stalledWrites = 0;
			} else {
				this.stalledWrites += 1;
				if (this.stalledWrites >= 3) {
					throw new Error('Could not commit encrypted writes after repeated conflicts');
				}
			}
		}
		if (pendingNotes.length) {
			merged.notes = mergeNoteLists(
				merged.notes,
				pendingNotes.map((note) => hydrateNoteImages(note, this.attachments))
			);
		}
		merged.notes = merged.notes.map((note) => hydrateNoteImages(note, this.attachments));

		if (typeof data.cursor === 'number' && !accepted.conflictNeedsCatchUp)
			this.cursor = data.cursor;
		this.downloadsDrained = !accepted.conflictNeedsCatchUp && data.hasMore !== true;

		merged.notes = withoutTombstoned(merged.notes, merged.tombstones);
		merged.labels = withoutTombstoned(merged.labels, merged.labelTombstones);
		// A board put back after its delete is newer than the delete, and stays.
		merged.boards = mergeKanbanBoards([], merged.boards, merged.boardTombstones);
		merged.libraryItems = mergeCanvasLibrary([], merged.libraryItems, merged.libraryTombstones);
		return { remoteFingerprints, envelopes: envelopes.length };
	}

	/**
	 * Step 4: hand what was pulled to whoever saves it, once every download is in.
	 * False when the sync was given up before anything was saved.
	 */
	private async save(round: Round, taken: Taken): Promise<boolean> {
		if (
			!this.downloadsDrained ||
			!(!round.startedDrained || taken.envelopes > 0) ||
			!this.applyPulled
		)
			return true;
		if (this.cancelled()) return false;
		this.merged = await this.applyPulled(this.merged, this.pid, {
			relayHolds: (id, hash) => relayHeldVersions(this.onRelay).get(id) === hash,
			relayHas: (id, hash) => {
				if (hash === null) delete this.onRelay.versions[id];
				else this.onRelay.versions[id] = hash;
			},
			owes: (owed) => this.owe(owed)
		});
		await this.holdBytesOf(this.merged.notes);
		return true;
	}

	/**
	 * Step 5: what the relay holds of each record now, against what this device holds.
	 * A record this device holds differently is owed again.
	 */
	private async settle(round: Round, accepted: Accepted, taken: Taken): Promise<Settled> {
		const mergedRecords = await buildSyncRecords(
			this.merged,
			new Set([
				...round.sentRecordKeys,
				...Object.keys(taken.remoteFingerprints),
				...this.outboxKeys
			])
		);
		const uploadedFingerprints = accepted.writesAccepted
			? Object.fromEntries(round.outgoing.map((record) => [record.key, record.fingerprint]))
			: {};
		const mergedFingerprints = fingerprintMapFrom(mergedRecords);
		// The workspace's name is a record too, though not one of the snapshot's:
		// left out here, what the relay holds of it was forgotten every round, and
		// the name was sent again by every sync that had it queued.
		const reconciledKeys = currentRecordKeys(this.merged);
		if (round.currentKeys.has(PROFILE_META_KEY)) {
			reconciledKeys.add(PROFILE_META_KEY);
			mergedFingerprints[PROFILE_META_KEY] = await sha256(this.namePayload());
		}
		const reconciled = reconcileBaseline({
			previous: this.baseline,
			uploaded: uploadedFingerprints,
			remote: taken.remoteFingerprints,
			merged: mergedFingerprints,
			currentKeys: reconciledKeys,
			referencedAttachments: referencedAttachmentIds(this.merged.notes, this.merged.tombstones),
			catchUpComplete: this.downloadsDrained
		});
		this.baseline = reconciled.baseline;
		for (const key of reconciled.ackKeys) this.acknowledgedOutbox.add(key);
		if (reconciled.dirtyKeys.length && !this.read) await this.owe(reconciled.dirtyKeys);
		return { mergedRecords, mergedFingerprints };
	}

	/**
	 * Step 6, once every download is in: record what the relay holds, and take out of
	 * the upload queue what it has. False when the sync was given up before that.
	 */
	private async commit(round: Round, settled: Settled): Promise<boolean> {
		const { acknowledgedOutbox, internallyMarkedOutbox, keys } = this;
		const heldNow = relayHeldVersions(this.onRelay);
		const listedHere = new Map<string, string[]>();
		for (const record of settled.mergedRecords) {
			if (record.payload.kind !== 'note') continue;
			for (const image of record.payload.value.images ?? []) {
				listedHere.set(image.id, [...(listedHere.get(image.id) ?? []), image.hash]);
			}
		}
		for (const key of this.outboxKeys) {
			const attachmentId = recordId(key, 'attachment');
			if (!round.currentKeys.has(key)) {
				acknowledgedOutbox.add(key);
			} else if (
				// An attachment the relay holds in every version listed here has
				// nothing left to send, whether or not its bytes were loaded.
				attachmentId !== null &&
				(listedHere.get(attachmentId) ?? []).every((hash) => heldNow.get(attachmentId) === hash)
			) {
				acknowledgedOutbox.add(key);
			} else if (
				// Queued, but the relay already holds it as it is (pinned and unpinned
				// before a sync, say): nothing is left to send.
				this.recordIds[key] &&
				settled.mergedFingerprints[key] !== undefined &&
				settled.mergedFingerprints[key] === this.baseline[key]
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
		if (this.cancelled()) return false;
		if (!this.read) {
			await commitSyncControl(
				this.pid,
				[
					[keys.cursor, this.cursor],
					[keys.baseline, this.baseline],
					[keys.recordIds, this.recordIds],
					[keys.relayAttachments, this.onRelay]
				],
				[
					{ keys: acknowledgedOutbox, through: this.outboxSnapshotAt },
					...[...internalAcknowledgements].map(([markedAt, keysAtGeneration]) => ({
						keys: keysAtGeneration,
						through: markedAt
					}))
				]
			);
			this.state().syncedCursor = this.cursor;
		}
		for (const keysAtGeneration of internalAcknowledgements.values()) {
			for (const key of keysAtGeneration) internallyMarkedOutbox.delete(key);
		}
		return true;
	}

	/** Step 7: whether another round is due. */
	private async more(
		round: Round,
		accepted: Accepted,
		data: Record<string, unknown>
	): Promise<boolean> {
		const pendingOutboxUpload = [...this.outboxKeys].some(
			(key) => !this.acknowledgedOutbox.has(key) && !this.quotaBlockedKeys.has(key)
		);
		const remainingUploads =
			!this.read &&
			((!round.startedDrained && (this.firstFullUpload || pendingOutboxUpload)) ||
				(!accepted.writesAccepted && (round.outgoing.length > 0 || round.deleteSlots.length > 0)) ||
				round.uploadsLeft > 0);
		const pendingDeletes = this.downloadsDrained && (await this.plannedDeletes()).length > 0;
		return syncRoundHasMore({
			remoteHasMore: data.hasMore === true,
			remainingUploads,
			pendingDeletes
		});
	}

	/** Every round is done: what the sync answers, and what it records of how it went. */
	private finish(): SyncResult {
		const { keys, poisonCount } = this;
		if (this.read)
			return {
				success: true,
				snapshot: this.merged,
				control: {
					[keys.cursor]: this.cursor,
					[keys.baseline]: this.baseline,
					[keys.recordIds]: this.recordIds,
					[keys.relayAttachments]: this.onRelay
				}
			};
		if (this.quotaBlockedKeys.size > 0 && poisonCount === 0)
			return this.fail(
				{
					success: false,
					error: 'Sync incomplete: account storage quota prevented some uploads',
					refused: true
				},
				'warning'
			);
		const syncedAt = Date.now();
		const state = this.state();
		state.issue =
			poisonCount > 0
				? {
						kind: 'warning',
						message: `Skipped ${poisonCount} unreadable sync record${poisonCount === 1 ? '' : 's'}`
					}
				: null;
		state.lastSync = syncedAt;
		this.deps.host.settled(this.pid, syncedAt);
		return {
			success: true,
			snapshot: this.merged,
			...(this.bootstrap ? { bootstrap: true } : {})
		};
	}

	/** A failed sync's answer, recorded for its workspace. */
	private fail(
		result: RelayAnswer & { refused?: boolean },
		/** For a sync that went through and left something out. */
		kind?: SyncIssue['kind']
	): SyncResult {
		const error = result.error || 'Sync failed';
		this.state().issue = {
			kind:
				kind ?? (result.unreachable ? 'unreachable' : result.signInRefused ? 'sign-in' : 'stopped'),
			message: error
		};
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
