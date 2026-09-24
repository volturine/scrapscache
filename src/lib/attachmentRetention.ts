import { isTombstoned } from '$lib/model';
import type { Note } from '$lib/types';

const ATTACHMENT = 'attachment:';

/**
 * Drop attachment deletions that a live note's retained history still needs, so an image
 * removed from a note can be restored with an earlier version until that version rolls out
 * of the history window. A deleted note keeps nothing: its attachments go at once.
 *
 * `versionAttachmentIds` returns every attachment id the note's retained versions list, or
 * null when that cannot be read; then everything the note removed is kept, because a delete
 * cannot be undone and the next sync can look again.
 */
export async function withoutAttachmentsHistoryNeeds(
	keys: string[],
	notes: Note[],
	noteTombstones: Record<string, number>,
	versionAttachmentIds: (note: Note) => Promise<Set<string> | null>
): Promise<string[]> {
	const removing = new Set(
		keys.filter((key) => key.startsWith(ATTACHMENT)).map((key) => key.slice(ATTACHMENT.length))
	);
	if (removing.size === 0) return keys;
	const needed = new Set<string>();
	for (const note of notes) {
		if (isTombstoned(note.id, noteTombstones)) continue;
		const removed = Object.keys(note.imageTombstones ?? {}).filter((id) => removing.has(id));
		if (removed.length === 0) continue;
		const inHistory = await versionAttachmentIds(note);
		for (const id of removed) if (!inHistory || inHistory.has(id)) needed.add(id);
	}
	return keys.filter(
		(key) => !key.startsWith(ATTACHMENT) || !needed.has(key.slice(ATTACHMENT.length))
	);
}
