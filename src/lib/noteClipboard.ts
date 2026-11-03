// "Copy note" puts the whole note on the clipboard, photos included. One
// clipboard item carries every representation a paste target may ask for:
// plain text for text fields, HTML with the photos embedded for rich editors,
// and the first photo as a PNG for anything that only takes an image.
import type { Note, NoteImage } from './types';
import { noteAttachments, noteToPlainText } from './checklistBody';
import { dataUrlToBlob } from './imageBlob';
import { pngBlobFromImage } from './imageOptimize';
import { dataUrlByteLength, isImageAttachment, MAX_ATTACHMENT_BYTES } from './noteImages';
import { parsePhotoMarker, renamePhotoMarkers, stripPhotoMarkers } from './photoMarker';
import { uid } from './model/uid';
import { stableStringify } from './model/stableStringify';
import { writeClipboardText } from './utils';
import { sha256 as sha256Bytes } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/** Photos whose full bytes are in memory; thumbs alone are not worth pasting. */
export function clipboardPhotos(images: NoteImage[] = []): NoteImage[] {
	return images.filter((image) => isImageAttachment(image) && image.dataUrl);
}

function photoHtml(photo: NoteImage, index: number): string {
	const size =
		photo.width && photo.height ? ` width="${photo.width}" height="${photo.height}"` : '';
	const name = photo.name ?? '';
	return `<p><img src="${escapeHtml(photo.dataUrl)}" alt="${escapeHtml(name)}" data-scrapscache-photo-id="${escapeHtml(photo.id)}" data-scrapscache-photo-name="${escapeHtml(name)}" data-scrapscache-photo-index="${index}"${size}></p>`;
}

/**
 * The note as HTML a rich editor can paste: the title as a heading, each
 * paragraph of the body with its line breaks, and the photos where their
 * markers stand in the text, the unplaced ones after it. The body keeps its
 * other markers (`[ ]`, `- `) as text, like the plain copy does.
 */
export function noteToClipboardHtml(note: Pick<Note, 'title' | 'body'>, photos: NoteImage[]) {
	const parts: string[] = [];
	if (note.title) parts.push(`<h1>${escapeHtml(note.title)}</h1>`);
	const byId = new Map(photos.map((photo) => [photo.id, photo]));
	const photoIndex = new Map(photos.map((photo, index) => [photo.id, index]));
	const placed = new Set<string>();
	let paragraph: string[] = [];
	const flush = () => {
		if (paragraph.length)
			parts.push(`<p style="white-space:pre-wrap">${paragraph.join('<br>')}</p>`);
		paragraph = [];
	};
	for (const line of note.body.replace(/\r\n?/g, '\n').split('\n')) {
		const marker = parsePhotoMarker(line);
		const photo = marker && byId.get(marker.id);
		if (photo) {
			flush();
			parts.push(photoHtml(photo, photoIndex.get(photo.id) ?? 0));
			placed.add(photo.id);
		} else if (line.trim()) {
			paragraph.push(escapeHtml(line));
		} else {
			flush();
		}
	}
	flush();
	for (const photo of photos)
		if (!placed.has(photo.id)) parts.push(photoHtml(photo, photoIndex.get(photo.id) ?? 0));
	const metadata = escapeHtml(JSON.stringify({ title: note.title, body: note.body }));
	const content = parts.join('\n');
	return `<div data-scrapscache-note="${metadata}">${content ? `\n${content}\n` : ''}</div>`;
}

export type CopiedNotePaste = {
	title: string;
	body: string;
	images: NoteImage[];
};

function imageDataUrlMime(dataUrl: string): string | null {
	if (!dataUrl.startsWith('data:')) return null;
	const comma = dataUrl.indexOf(',');
	if (comma < 0) return null;
	const [mime, ...parameters] = dataUrl.slice(5, comma).split(';');
	if (!mime || !/^image\/[a-z0-9][a-z0-9.+-]*$/i.test(mime) || !isImageAttachment({ mime }))
		return null;
	if (parameters.length !== 1 || parameters[0].toLowerCase() !== 'base64') return null;
	const payload = dataUrl.slice(comma + 1);
	if (!payload || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload))
		return null;
	return mime.toLowerCase();
}

function parsedImageSize(value: string | null): number | undefined {
	if (!value || !/^\d{1,5}$/.test(value)) return undefined;
	const size = Number(value);
	return size > 0 ? size : undefined;
}

function parsedPhotoIndex(value: string | null): number | null {
	if (value === null || !/^\d{1,6}$/.test(value)) return null;
	return Number(value);
}

function copiedPhotoContentHash(dataUrl: string): string {
	return bytesToHex(sha256Bytes(new TextEncoder().encode(stableStringify(dataUrl))));
}

/**
 * Read the Scraps Cache copy representation before file-only paste handling. Only the
 * private wrapper is trusted; embedded images must be validated data URLs so paste
 * never causes a fetch of clipboard-provided remote content.
 */
export function readCopiedNotePaste(clipboardData: DataTransfer | null): CopiedNotePaste | null {
	if (!clipboardData || typeof document === 'undefined') return null;
	let html: string;
	try {
		html = clipboardData.getData('text/html');
	} catch {
		return null;
	}
	if (!html) return null;
	const template = document.createElement('template');
	try {
		// Template contents are inert while parsed, so hostile URLs cannot load before validation.
		template.innerHTML = html;
	} catch {
		return null;
	}
	const markers = template.content.querySelectorAll('[data-scrapscache-note]');
	if (markers.length !== 1) return null;
	const wrapper = markers[0];
	if (!wrapper || wrapper.localName !== 'div') return null;
	let metadata: unknown;
	try {
		metadata = JSON.parse(wrapper.getAttribute('data-scrapscache-note') ?? '');
	} catch {
		return null;
	}
	if (
		!metadata ||
		typeof metadata !== 'object' ||
		typeof (metadata as { title?: unknown }).title !== 'string' ||
		typeof (metadata as { body?: unknown }).body !== 'string'
	)
		return null;
	const { title, body } = metadata as { title: string; body: string };
	const sourceIds = new Map<string, string>();
	const imageOrder = new Map<string, number>();
	const images: NoteImage[] = [];
	for (const element of wrapper.querySelectorAll('img')) {
		const sourceId = element.getAttribute('data-scrapscache-photo-id');
		const name = element.getAttribute('data-scrapscache-photo-name');
		const dataUrl = element.getAttribute('src');
		const order = parsedPhotoIndex(element.getAttribute('data-scrapscache-photo-index'));
		if (!sourceId || sourceId.length > 256 || name === null || !dataUrl || order === null)
			return null;
		const mime = imageDataUrlMime(dataUrl);
		if (!mime) return null;
		const byteSize = dataUrlByteLength(dataUrl);
		if (byteSize > MAX_ATTACHMENT_BYTES) return null;
		const existing = images.find((image) => sourceIds.get(sourceId) === image.id);
		if (existing) {
			if (existing.dataUrl !== dataUrl || existing.name !== name) return null;
			continue;
		}
		const id = uid();
		sourceIds.set(sourceId, id);
		imageOrder.set(id, order);
		const width = parsedImageSize(element.getAttribute('width'));
		const height = parsedImageSize(element.getAttribute('height'));
		images.push({
			id,
			mime,
			dataUrl,
			name: name || 'photo',
			createdAt: 0,
			byteSize,
			contentHash: copiedPhotoContentHash(dataUrl),
			...(width && height ? { width, height } : {})
		});
	}
	images.sort((left, right) => imageOrder.get(left.id)! - imageOrder.get(right.id)!);
	const createdAt = Date.now();
	images.forEach((image, index) => (image.createdAt = createdAt + index));
	const bodyPhotoIds = new Set(
		body
			.split('\n')
			.map((line) => parsePhotoMarker(line)?.id)
			.filter((id): id is string => !!id)
	);
	const missingPhotoIds = [...bodyPhotoIds].filter((id) => !sourceIds.has(id));
	const bodyWithoutMissingPhotos = stripPhotoMarkers(body, missingPhotoIds);
	return { title, body: renamePhotoMarkers(bodyWithoutMissingPhotos, sourceIds), images };
}

export type WriteNoteToClipboardOptions = {
	/** Full photo bytes, loaded from device storage when memory only holds thumbs. */
	loadPhotos?: () => Promise<NoteImage[]>;
	encodePng?: (photo: NoteImage) => Promise<Blob>;
};

async function photoAsPng(photo: NoteImage): Promise<Blob> {
	return pngBlobFromImage(await dataUrlToBlob(photo.dataUrl));
}

/**
 * Copy the note with its photos. True only when something landed on the
 * clipboard; the plain text alone is the last resort.
 *
 * The item is built synchronously from promises: Safari only honours a write
 * that starts inside the click, so loading bytes before `write()` would lose it.
 */
export async function writeNoteToClipboard(
	note: Note,
	{ loadPhotos, encodePng = photoAsPng }: WriteNoteToClipboardOptions = {}
): Promise<boolean> {
	const text = noteToPlainText(note);
	const resident = clipboardPhotos(noteAttachments(note));
	const hasPhotos = noteAttachments(note).some(isImageAttachment);
	if (!hasPhotos || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
		return writeClipboardText(text);
	}
	const photos = loadPhotos
		? loadPhotos().then((loaded) => {
				const ready = clipboardPhotos(loaded);
				return ready.length ? ready : resident;
			})
		: Promise.resolve(resident);
	const html = photos.then(
		(ready) => new Blob([noteToClipboardHtml(note, ready)], { type: 'text/html' })
	);
	const png = photos.then((ready) => {
		if (!ready.length) throw new Error('No photo bytes to copy');
		return encodePng(ready[0]);
	});
	// The item owns the rejection; a write that moves on must not leave it unhandled.
	png.catch(() => {});
	const plain = new Blob([text], { type: 'text/plain' });
	// A browser that rejects one representation (no PNG support, an undecodable
	// photo) still gets the text and the HTML with the photos inside.
	const attempts: Record<string, Blob | Promise<Blob>>[] = [
		{ 'text/plain': plain, 'text/html': html, 'image/png': png },
		{ 'text/plain': plain, 'text/html': html }
	];
	for (const data of attempts) {
		try {
			await navigator.clipboard.write([new ClipboardItem(data)]);
			return true;
		} catch {
			// Try the next, smaller item.
		}
	}
	return writeClipboardText(text);
}
