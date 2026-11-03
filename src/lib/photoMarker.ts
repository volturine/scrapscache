// A photo's place in the body is one line of text, `![name](photo:<id>)`, so the
// body stays plain text everywhere: sync, backups, search, copies and older
// builds all see an ordinary line, and the editor and cards draw it as a chip.
import type { NoteImage } from './types';

const MARKER_RE = /^!\[([^\]\n]*)\]\(photo:([^\s()]+)\)$/;

export type PhotoMarker = { name: string; id: string };

/** The caret a photo was pasted or dropped at; null places it at the end of the body. */
export type PhotoPlacement = { line: number; offset: number };

/** The marker line for a photo. Characters the syntax uses are kept out of the name. */
export function photoMarker(photo: Pick<NoteImage, 'id' | 'name'>): string {
	const name = (photo.name ?? '').replace(/[\]\n\r]/g, ' ').trim() || 'photo';
	return `![${name}](photo:${photo.id})`;
}

/** The photo a line stands for, when the whole line is a marker. */
export function parsePhotoMarker(line: string): PhotoMarker | null {
	const match = MARKER_RE.exec(line);
	return match ? { name: match[1], id: match[2] } : null;
}

export function isPhotoMarkerLine(line: string): boolean {
	return MARKER_RE.test(line);
}

/** Whether the body has a marker line for this photo. */
export function bodyHasPhotoMarker(body: string, id: string): boolean {
	return body.split('\n').some((line) => parsePhotoMarker(line)?.id === id);
}

/** The body without the marker lines of these photos: a photo that goes takes its place with it. */
export function stripPhotoMarkers(body: string, ids: Iterable<string>): string {
	const gone = new Set(ids);
	if (gone.size === 0) return body;
	return body
		.split('\n')
		.filter((line) => {
			const marker = parsePhotoMarker(line);
			return !marker || !gone.has(marker.id);
		})
		.join('\n');
}

/** Marker lines pointed at new photo ids, as a restore that gives photos new ids needs. */
export function renamePhotoMarkers(body: string, ids: ReadonlyMap<string, string>): string {
	if (ids.size === 0) return body;
	return body
		.split('\n')
		.map((line) => {
			const marker = parsePhotoMarker(line);
			const next = marker && ids.get(marker.id);
			return next ? photoMarker({ id: next, name: marker.name }) : line;
		})
		.join('\n');
}

/** A body with nothing but photo markers and blank lines reads as empty text. */
export function bodyIsOnlyPhotoMarkers(body: string): boolean {
	return body.split('\n').every((line) => line.trim() === '' || isPhotoMarkerLine(line));
}
