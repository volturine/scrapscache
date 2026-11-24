// Settling the attachments a workspace's notes list against what this device and
// the relay hold. A sync does it for the workspace it runs for, open or not.
import type { Note, NoteImage } from '#lib/types.js';
import { getStoredAttachmentVersions, hydrateNoteAttachments } from '#lib/db/idb.js';
import { applyNoteEdit } from '#lib/model/index.js';
import { editContext } from '#lib/editContext.js';
import { loadCurrentAttachment } from '#lib/historyClient.js';
import { stripPhotoMarkers } from '#lib/photoMarker.js';
import { attachmentToImage, recordKey } from '#lib/syncRecords.js';
import { sha256 } from '#lib/syncHash.js';
import { cloneNote } from '#lib/utils.js';
import type { SyncAccount } from '#lib/relayClient.js';
import type { PulledRelayState } from '#lib/relaySync.js';

/**
 * What settling decided for attachment versions a note listed, keyed by note id,
 * attachment id and version: the attachment as the note lists it from now on, or
 * null when the note stops listing it.
 */
export type AttachmentDecisions = Map<string, NoteImage | null>;

export function attachmentDecisionKey(noteId: string, image: NoteImage): string {
	return JSON.stringify([noteId, image.id, image.contentHash ?? '']);
}

/** A note with what settling decided for its attachments; the same note when nothing was. */
export function withAttachmentDecisions(note: Note, decisions: AttachmentDecisions): Note {
	if (decisions.size === 0 || !note.images?.length) return note;
	const dropped: string[] = [];
	let changed = false;
	const images = note.images.flatMap((image) => {
		const key = attachmentDecisionKey(note.id, image);
		if (!decisions.has(key)) return [image];
		changed = true;
		const decided = decisions.get(key);
		if (decided) return [decided];
		dropped.push(image.id);
		return [];
	});
	if (!changed) return note;
	const settled = { ...note, images };
	// A marker for an attachment that was never there would read as a missing photo.
	const body = stripPhotoMarkers(note.body ?? '', dropped);
	return body === (note.body ?? '') ? settled : applyNoteEdit(settled, { body }, editContext);
}

/**
 * After a download has drained, every attachment a note lists is settled from two
 * recorded facts: the version of it this device holds, and the version the relay
 * holds. Nothing is assumed about an attachment that is absent.
 *
 * - Held here and on the relay: nothing to do.
 * - Held here only: this device owes the upload. Its bytes are loaded so they
 *   travel in the request that makes the note list it.
 * - Not held here: the relay is asked for the attachment by name. Its bytes are
 *   stored if it holds the version listed. If it holds another version, the one
 *   listed was never uploaded and the note lists the relay's instead. If it
 *   holds none, the note lists the version this device does hold, which it then
 *   owes; holding none either, the attachment was never there and the note
 *   stops listing it.
 *
 * A request that fails stops the sync: the next one asks again. `unreadable` hears
 * of each note whose stored bytes could not be read.
 */
export async function settleAttachments(input: {
	notes: Note[];
	pid: string;
	account: SyncAccount | null;
	relay: PulledRelayState;
	signal?: AbortSignal;
	unreadable: (noteId: string) => void;
}): Promise<{ notes: Note[]; decisions: AttachmentDecisions; persist: Set<string> }> {
	const { notes, pid, account, relay, signal, unreadable } = input;
	const decisions: AttachmentDecisions = new Map();
	const persist = new Set<string>();
	if (!account) return { notes, decisions, persist };
	// A write of bytes that keeps failing holds this wait up for as long as it is
	// retried. A sync that gives up its round gives the wait up with it, so the sync
	// lock is never held behind another window's trouble.
	const stored = await getStoredAttachmentVersions(pid, signal);
	const owed: string[] = [];
	/** An attachment with the bytes stored for it, to travel with its note. */
	const withStoredBytes = async (note: Note, image: NoteImage): Promise<NoteImage> => {
		const dataUrl = await hydrateNoteAttachments(pid, {
			...cloneNote(note),
			images: [image]
		}).then(
			(read) => read.images?.[0]?.dataUrl ?? '',
			() => ''
		);
		if (dataUrl) return { ...image, dataUrl };
		unreadable(note.id);
		return image;
	};
	for (const note of notes) {
		for (const listed of note.images ?? []) {
			const key = attachmentDecisionKey(note.id, listed);
			const held = stored.get(`${note.id}::${listed.id}`);
			const hash = listed.contentHash ?? (listed.dataUrl ? await sha256(listed.dataUrl) : held);
			if (!hash) {
				decisions.set(key, null);
				continue;
			}
			if (listed.dataUrl || held === hash) {
				let image = listed.contentHash ? listed : { ...listed, contentHash: hash };
				if (image.dataUrl && held !== hash) {
					// These bytes are not stored yet; a preview of the bytes before goes.
					if (held !== undefined) image = { ...image, thumbUrl: undefined };
					persist.add(note.id);
				}
				if (!relay.relayHolds(image.id, hash)) {
					owed.push(recordKey('note', note.id), recordKey('attachment', image.id));
					if (!image.dataUrl) image = await withStoredBytes(note, image);
				}
				if (image !== listed) decisions.set(key, image);
				continue;
			}
			const onRelay = await loadCurrentAttachment(account, listed.id, signal);
			relay.relayHas(listed.id, onRelay?.hash ?? null);
			persist.add(note.id);
			if (onRelay?.hash === hash) {
				decisions.set(key, {
					...listed,
					contentHash: hash,
					dataUrl: onRelay.dataUrl,
					thumbUrl: undefined
				});
				continue;
			}
			// The note changes, so the relay's copy of it has to follow.
			owed.push(recordKey('note', note.id));
			const { editedAt: _edit, thumbUrl: _preview, ...kept } = listed;
			if (onRelay) decisions.set(key, { ...kept, ...attachmentToImage(onRelay) });
			else if (held === undefined) decisions.set(key, null);
			else {
				owed.push(recordKey('attachment', listed.id));
				decisions.set(key, await withStoredBytes(note, { ...kept, contentHash: held }));
			}
		}
	}
	if (owed.length) await relay.owes([...new Set(owed)]);
	return {
		notes: notes.map((note) => withAttachmentDecisions(note, decisions)),
		decisions,
		persist
	};
}
