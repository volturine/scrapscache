// A note body is a Yjs text document, so edits made on two devices before they
// sync both survive the merge. `body` stays the plain text; `bodyDoc` carries
// the document as a base64 Yjs update.
import * as Y from 'yjs';
import diff from 'fast-diff';

const TEXT = 'body';

export type BodyState = { body: string; bodyDoc?: string };

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

/** FNV-1a, so the same content derives the same client id on every device. */
function contentClientId(...parts: string[]): number {
	let hash = 0x811c9dc5;
	for (const part of parts) {
		for (let index = 0; index < part.length; index++) {
			hash ^= part.charCodeAt(index);
			hash = Math.imul(hash, 0x01000193);
		}
		hash ^= 0xff;
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function textOf(doc: Y.Doc): string {
	return doc.getText(TEXT).toString();
}

/** Apply the smallest edits that turn `from` into `to`, so concurrent edits elsewhere survive. */
function writeText(doc: Y.Doc, from: string, to: string): void {
	const text = doc.getText(TEXT);
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
 * The body as a document. A body the document does not hold (a note from before
 * documents, or one rewritten by a client that kept a stale document) is applied
 * as an edit by a client id derived from that content, so every device derives
 * the identical edit and the results merge instead of duplicating.
 */
function load(state: BodyState): Y.Doc {
	const doc = new Y.Doc();
	if (state.bodyDoc) {
		try {
			Y.applyUpdate(doc, fromBase64(state.bodyDoc));
		} catch {
			// An unreadable document carries nothing the text does not.
			return load({ body: state.body });
		}
	}
	const current = textOf(doc);
	if (current !== state.body) {
		doc.clientID = contentClientId(state.bodyDoc ?? '', state.body);
		writeText(doc, current, state.body);
	}
	return doc;
}

function save(doc: Y.Doc): string {
	return toBase64(Y.encodeStateAsUpdate(doc));
}

/** Both edits survive; the encoding is canonical, so every device stores identical bytes. */
export function mergeBodies(left: BodyState, right: BodyState): Required<BodyState> {
	if (left.bodyDoc === right.bodyDoc && left.body === right.body && left.bodyDoc) {
		return { body: left.body, bodyDoc: left.bodyDoc };
	}
	const doc = load(left);
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(load(right)));
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

	edit(noteId: string, state: BodyState, next: string): Required<BodyState> {
		const doc = load(state);
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
export function isReadableBodyDoc(value: unknown): value is string {
	if (typeof value !== 'string' || !value) return false;
	try {
		Y.applyUpdate(new Y.Doc(), fromBase64(value));
		return true;
	} catch {
		return false;
	}
}
