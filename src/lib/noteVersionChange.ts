import type { SyncNote } from '$lib/syncRecords';

/** A saved version or the live note; attachments are compared by id only. */
type VersionedNote = Omit<SyncNote, 'images'> & { images?: { id: string }[] };

export type NoteVersionChange = {
	/** Non-blank body lines this version added compared with the one before it. */
	added: number;
	/** Non-blank body lines this version removed compared with the one before it. */
	removed: number;
	/** One-line description of the most telling change. */
	summary: string;
};

const CHECKBOX = /^\s*(?:[-*+]\s+)?\[([ xX])\]\s+/;
const MARKER = /^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s*)?(?:\[[ xX]\]\s+)?/;

function lines(body: string): string[] {
	return body.split('\n').filter((line) => line.trim() !== '');
}

function plain(line: string): string {
	return line.replace(MARKER, '').trim();
}

function firstLine(note: VersionedNote): string {
	const line = lines(note.body)[0];
	return (line && plain(line)) || note.title.trim() || 'Empty note';
}

function metadataChange(version: VersionedNote, previous: VersionedNote): string | null {
	if (version.trashed !== previous.trashed)
		return version.trashed ? 'Moved to trash' : 'Restored from trash';
	if (version.archived !== previous.archived) return version.archived ? 'Archived' : 'Unarchived';
	if (version.pinned !== previous.pinned) return version.pinned ? 'Pinned' : 'Unpinned';
	if (version.color !== previous.color) return 'Changed colour';
	const attachments = (note: VersionedNote) => (note.images ?? []).map((image) => image.id).join();
	if (attachments(version) !== attachments(previous)) return 'Changed attachments';
	if (version.labels.join() !== previous.labels.join()) return 'Changed labels';
	if (version.reminder !== previous.reminder) return 'Changed reminder';
	return null;
}

function sameVisibleNote(a: VersionedNote, b: VersionedNote): boolean {
	return a.title === b.title && a.body === b.body && metadataChange(a, b) === null;
}

/**
 * Drop saves (newest first) that look the same as the save or live note just after them,
 * so each row marks a visible change. Appending older pages never removes existing rows.
 */
export function distinctNoteVersions<T extends { note: VersionedNote }>(
	entries: T[],
	current: VersionedNote
): T[] {
	return entries.filter(
		(entry, index) => !sameVisibleNote(entry.note, index ? entries[index - 1].note : current)
	);
}

/** Describe what one saved version changed relative to the version saved before it. */
export function describeNoteVersionChange(
	version: VersionedNote,
	previous: VersionedNote | undefined
): NoteVersionChange {
	if (!previous) return { added: 0, removed: 0, summary: firstLine(version) };

	const remaining = new Map<string, number>();
	for (const line of lines(previous.body)) remaining.set(line, (remaining.get(line) ?? 0) + 1);
	const addedLines: string[] = [];
	for (const line of lines(version.body)) {
		const count = remaining.get(line) ?? 0;
		if (count > 0) remaining.set(line, count - 1);
		else addedLines.push(line);
	}
	const removedLines = [...remaining].flatMap(([line, count]) => Array(count).fill(line));
	const change = { added: addedLines.length, removed: removedLines.length };

	if (version.title.trim() !== previous.title.trim())
		return { ...change, summary: `Renamed “${version.title.trim() || 'Untitled'}”` };

	const toggled = addedLines.find((line) => {
		const text = plain(line);
		return (
			CHECKBOX.test(line) && removedLines.some((old) => CHECKBOX.test(old) && plain(old) === text)
		);
	});
	if (toggled) {
		const checked = CHECKBOX.exec(toggled)?.[1] !== ' ';
		return { ...change, summary: `${checked ? 'Checked' : 'Unchecked'} “${plain(toggled)}”` };
	}
	if (addedLines.length) return { ...change, summary: plain(addedLines[0]) || 'Edited' };
	if (removedLines.length) return { ...change, summary: `Removed “${plain(removedLines[0])}”` };
	return { ...change, summary: metadataChange(version, previous) ?? 'No visible changes' };
}
