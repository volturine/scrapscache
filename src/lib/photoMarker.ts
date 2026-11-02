// A photo's place in the body is one line of text, `![name](photo:<id>)`, so the
// body stays plain text everywhere: sync, backups, search, copies and older
// builds all see an ordinary line, and the editor and cards draw it as a chip.
import type { NoteImage } from './types';

const MARKER_RE = /^!\[([^\]\n]*)\]\(photo:([^\s()]+)\)$/;

export type PhotoMarker = { name: string; id: string };

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

/** A body with nothing but photo markers and blank lines reads as empty text. */
export function bodyIsOnlyPhotoMarkers(body: string): boolean {
	return body.split('\n').every((line) => line.trim() === '' || isPhotoMarkerLine(line));
}
