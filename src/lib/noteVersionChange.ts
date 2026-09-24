import type { SyncNote } from '$lib/syncRecords';

/** A saved version or the live note; attachments are compared by id only. */
type VersionedNote = Omit<SyncNote, 'images'> & { images?: { id: string }[] };

export type NoteVersionChange = {
	/** Body lines, blank ones included, this version added compared with the one before it. */
	added: number;
	/** Body lines, blank ones included, this version removed compared with the one before it. */
	removed: number;
	/** One-line description of the most telling change. */
	summary: string;
};

const CHECKBOX = /^\s*(?:[-*+]\s+)?\[([ xX])\]\s+/;
const MARKER = /^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s*)?(?:\[[ xX]\]\s+)?/;

function lines(body: string): string[] {
	return body === '' ? [] : body.split('\n');
}

function blank(line: string): boolean {
	return line.trim() === '';
}

function plain(line: string): string {
	return line.replace(MARKER, '').trim();
}

function emptyLines(count: number): string {
	return count === 1 ? 'an empty line' : `${count} empty lines`;
}

function firstLine(note: VersionedNote): string {
	const line = lines(note.body).find((text) => !blank(text));
	return (line && plain(line)) || note.title.trim() || 'Empty note';
}

/** The first lines of a version's text, flattened for a short preview. */
export function noteExcerpt(note: VersionedNote, maxLines = 3): string {
	const text = lines(note.body)
		.filter((line) => !blank(line))
		.slice(0, maxLines)
		.map(plain)
		.join(' · ');
	return text || 'No text';
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

/** Whether two notes would look the same in the editor. */
export function sameVisibleNote(a: VersionedNote, b: VersionedNote): boolean {
	return a.title === b.title && a.body === b.body && metadataChange(a, b) === null;
}

/**
 * Keep the newest of each run of saves (newest first) that look the same, such as a
 * force sync that re-uploads unchanged content. Appending older pages never removes rows.
 */
export function distinctNoteVersions<T extends { note: VersionedNote }>(entries: T[]): T[] {
	return entries.filter(
		(entry, index) => index === 0 || !sameVisibleNote(entry.note, entries[index - 1].note)
	);
}

function titleChange(version: VersionedNote, previous: VersionedNote): string | null {
	const title = version.title.trim();
	const before = previous.title.trim();
	if (title === before) return null;
	if (!title) return 'Removed the title';
	return before ? `Renamed “${title}”` : `Titled “${title}”`;
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
	const describe = (summary: string) => ({ ...change, summary });

	const renamed = titleChange(version, previous);
	if (renamed) return describe(renamed);

	const toggled = addedLines.find((line) => {
		const text = plain(line);
		return (
			CHECKBOX.test(line) && removedLines.some((old) => CHECKBOX.test(old) && plain(old) === text)
		);
	});
	if (toggled) {
		const checked = CHECKBOX.exec(toggled)?.[1] !== ' ';
		return describe(`${checked ? 'Checked' : 'Unchecked'} “${plain(toggled)}”`);
	}
	const added = addedLines.find((line) => !blank(line));
	if (added) return describe(plain(added) || 'Edited');
	const removed = removedLines.find((line) => !blank(line));
	if (removed) return describe(`Removed “${plain(removed)}”`);
	// Only blank lines changed, or the same lines moved.
	if (change.added && change.removed) return describe('Changed line spacing');
	if (change.added) return describe(`Added ${emptyLines(change.added)}`);
	if (change.removed) return describe(`Removed ${emptyLines(change.removed)}`);
	if (version.body !== previous.body) return describe('Reordered lines');
	return describe(metadataChange(version, previous) ?? 'No visible changes');
}
