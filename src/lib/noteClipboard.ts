// "Copy note" puts the whole note on the clipboard, photos included. One
// clipboard item carries every representation a paste target may ask for:
// plain text for text fields, HTML with the photos embedded for rich editors,
// and the first photo as a PNG for anything that only takes an image.
import type { Note, NoteImage } from './types';
import { noteAttachments, noteToPlainText } from './checklistBody';
import { dataUrlToBlob } from './imageBlob';
import { pngBlobFromImage } from './imageOptimize';
import { isImageAttachment } from './noteImages';
import { parsePhotoMarker } from './photoMarker';
import { writeClipboardText } from './utils';

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

function photoHtml(photo: NoteImage): string {
	const size =
		photo.width && photo.height ? ` width="${photo.width}" height="${photo.height}"` : '';
	return `<p><img src="${photo.dataUrl}" alt="${escapeHtml(photo.name ?? '')}"${size}></p>`;
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
			parts.push(photoHtml(photo));
			placed.add(photo.id);
		} else if (line.trim()) {
			paragraph.push(escapeHtml(line));
		} else {
			flush();
		}
	}
	flush();
	for (const photo of photos) if (!placed.has(photo.id)) parts.push(photoHtml(photo));
	return parts.join('\n');
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
