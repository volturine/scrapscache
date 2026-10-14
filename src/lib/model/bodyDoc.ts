// A note body is a Yjs text document, so edits made on two devices before they
// sync both survive the merge. `body` stays the plain text; `bodyDoc` carries
// the document as a base64 Yjs update.
import * as Y from 'yjs';
import diff from 'fast-diff';
import { sha256 } from '@noble/hashes/sha2.js';

const TEXT = 'body';
const SNAPSHOTS = 'bodySnapshots';

export type BodyState = { body: string; bodyDoc?: string };
export type BodyWrite = { time: number; writer?: string };

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function randomClientId(): number {
	return crypto.getRandomValues(new Uint32Array(1))[0];
}

type BodySnapshot = { key: string; time: number; writer: string; text: Y.Text };

function laterSnapshot(candidate: BodySnapshot, current: BodySnapshot): boolean {
	return (
		candidate.time > current.time ||
		(candidate.time === current.time &&
			(candidate.writer > current.writer ||
				(candidate.writer === current.writer && candidate.key > current.key)))
	);
}

/** A full replacement owns its own text, so copies of that write share one insertion history. */
function latestSnapshot(doc: Y.Doc): BodySnapshot | undefined {
	let latest: BodySnapshot | undefined;
	for (const [key, text] of doc.getMap<Y.Text>(SNAPSHOTS)) {
		if (!(text instanceof Y.Text)) continue;
		let stamp: unknown;
		try {
			stamp = JSON.parse(key);
		} catch {
			continue;
		}
		if (
			!Array.isArray(stamp) ||
			stamp.length !== 3 ||
			typeof stamp[0] !== 'number' ||
			!Number.isFinite(stamp[0]) ||
			typeof stamp[1] !== 'string' ||
			typeof stamp[2] !== 'string' ||
			!/^[0-9a-f]{64}$/.test(stamp[2])
		) {
			continue;
		}
		const [time, writer] = stamp;
		const candidate = { key, time, writer, text };
		if (!latest || laterSnapshot(candidate, latest)) latest = candidate;
	}
	return latest;
}

function bodyText(doc: Y.Doc): Y.Text {
	return latestSnapshot(doc)?.text ?? doc.getText(TEXT);
}

/** Obsolete replacement text cannot return, and Yjs can garbage-collect its contents. */
function pruneSnapshots(doc: Y.Doc): void {
	const latest = latestSnapshot(doc);
	if (!latest) return;
	doc.transact(() => {
		const original = doc.getText(TEXT);
		if (original.length) original.delete(0, original.length);
		const snapshots = doc.getMap<Y.Text>(SNAPSHOTS);
		for (const key of snapshots.keys()) if (key !== latest.key) snapshots.delete(key);
	});
}

function textOf(doc: Y.Doc): string {
	return bodyText(doc).toString();
}

/** Apply the smallest edits that turn `from` into `to`, so concurrent edits elsewhere survive. */
function writeText(doc: Y.Doc, from: string, to: string): void {
	const text = bodyText(doc);
	let index = 0;
	doc.transact(() => {
		for (const [operation, chunk] of diff(from, to)) {
			if (operation === diff.EQUAL) {
				index += chunk.length;
			} else if (operation === diff.DELETE) {
				text.delete(index, chunk.length);
			} else {
				text.insert(index, chunk);
				index += chunk.length;
			}
		}
	});
}

/**
 * A readable document owns its text. Its plain-text projection must not be
 * authored again. Copies of the same plaintext write start from one shared base;
 * different writes get separate bases before their first incremental edit.
 */
function load(state: BodyState, sourceWrite: BodyWrite = { time: 0 }): Y.Doc {
	const doc = new Y.Doc();
	if (state.bodyDoc) {
		try {
			Y.applyUpdate(doc, fromBase64(state.bodyDoc));
			pruneSnapshots(doc);
			return doc;
		} catch {
			// An unreadable document carries nothing the text does not.
			return load({ body: state.body }, sourceWrite);
		}
	}
	Y.applyUpdate(doc, snapshotUpdate(state.body, sourceWrite));
	return doc;
}

function save(doc: Y.Doc): string {
	return toBase64(Y.encodeStateAsUpdate(doc));
}

/** Same-base edits merge; across full replacements, the record's body write decides the winner. */
export function mergeBodies(
	left: Required<BodyState>,
	right: Required<BodyState>,
	preferred?: 'left' | 'right'
): Required<BodyState> {
	const doc = load(left);
	if (left.bodyDoc === right.bodyDoc) return { body: textOf(doc), bodyDoc: save(doc) };
	const other = load(right);
	const leftSnapshot = latestSnapshot(doc);
	const rightSnapshot = latestSnapshot(other);
	if (leftSnapshot?.key !== rightSnapshot?.key) {
		const chooseLeft =
			preferred === 'left' ||
			(preferred === undefined &&
				(!rightSnapshot || (leftSnapshot && laterSnapshot(leftSnapshot, rightSnapshot))));
		const winner = chooseLeft ? doc : other;
		return { body: textOf(winner), bodyDoc: save(winner) };
	}
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
	pruneSnapshots(doc);
	return { body: textOf(doc), bodyDoc: save(doc) };
}

/** The same full write has identical Yjs operations, independent of the history receiving it. */
function snapshotUpdate(body: string, write: BodyWrite): Uint8Array {
	const writer = write.writer ?? '';
	const digest = sha256(new TextEncoder().encode(JSON.stringify([write.time, writer, body])));
	const key = JSON.stringify([
		write.time,
		writer,
		Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
	]);
	const snapshot = new Y.Doc();
	// Yjs encodes safe-integer client ids. A 53-bit hash avoids reusing an insertion
	// clock when distinct replacement writes happen to share a 32-bit hash.
	let clientId = digest[0] & 0x1f;
	for (let index = 1; index < 7; index++) clientId = clientId * 256 + digest[index];
	snapshot.clientID = clientId;
	const text = new Y.Text();
	snapshot.getMap<Y.Text>(SNAPSHOTS).set(key, text);
	if (body) text.insert(0, body);
	return Y.encodeStateAsUpdate(snapshot);
}

export function replaceBodySnapshot(
	state: Required<BodyState>,
	body: string,
	write: BodyWrite
): Required<BodyState> {
	const doc = load(state);
	Y.applyUpdate(doc, snapshotUpdate(body, write));
	pruneSnapshots(doc);
	return { body: textOf(doc), bodyDoc: save(doc) };
}

/**
 * Writes body edits as one Yjs client. A client must never write two different
 * items at the same clock, so the author keeps its id only while a note still
 * holds everything it wrote there, and otherwise takes a fresh one.
 */
export class BodyAuthor {
	private clientId = randomClientId();
	private written = new Map<string, number>();

	edit(
		noteId: string,
		state: BodyState,
		next: string,
		sourceWrite?: BodyWrite
	): Required<BodyState> {
		const doc = load(state, sourceWrite);
		if (Y.getState(doc.store, this.clientId) !== (this.written.get(noteId) ?? 0)) {
			this.clientId = randomClientId();
			this.written.clear();
		}
		doc.clientID = this.clientId;
		writeText(doc, textOf(doc), next);
		this.written.set(noteId, Y.getState(doc.store, this.clientId));
		return { body: next, bodyDoc: save(doc) };
	}
}

/** A stored document that decodes, for validating untrusted input such as backups. */
export function isReadableBodyDoc(value: unknown, body?: string): value is string {
	if (typeof value !== 'string' || !value) return false;
	try {
		const doc = new Y.Doc();
		Y.applyUpdate(doc, fromBase64(value));
		pruneSnapshots(doc);
		return body === undefined || textOf(doc) === body;
	} catch {
		return false;
	}
}
