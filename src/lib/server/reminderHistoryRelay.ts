import { notifyReminderEvents } from '$lib/server/reminderEvents';
import { getDb, type Db } from '$lib/server/db';
import { REMINDER_BATCH_SIZE, type ReminderPacket, type ReminderPage } from '$lib/reminderChannel';

/** Independent of note quota/cursors. Bounds retained receipt ciphertext per account. */
export const MAX_REMINDER_HISTORY_BYTES = 8 * 1024 * 1024;
export class ReminderHistoryQuotaError extends Error {}
export function validReminderPacket(value: unknown): value is ReminderPacket {
	const row = value as ReminderPacket | null;
	return (
		!!row &&
		typeof row.id === 'string' &&
		/^[a-f0-9]{64}$/.test(row.id) &&
		typeof row.note === 'string' &&
		/^[a-f0-9]{64}$/.test(row.note) &&
		typeof row.deleted === 'boolean' &&
		typeof row.ciphertext === 'string' &&
		row.ciphertext.length >= 56 &&
		row.ciphertext.length <= 4096 &&
		/^[A-Za-z0-9_-]+$/.test(row.ciphertext)
	);
}

/** Immutable receipts make concurrent sends idempotent; no note-sync lock or CAS is needed. */
export async function exchangeReminderHistory(
	accountId: string,
	cursor: number,
	events: ReminderPacket[],
	db: Db = getDb()
): Promise<ReminderPage> {
	await db.ready;
	const latest = (
		await db.relay.execute({
			sql: 'SELECT COALESCE(MAX(seq), 0) AS cursor FROM reminder_history WHERE account_id = ?',
			args: [accountId]
		})
	).rows[0];
	if (cursor > Number(latest.cursor)) return { cursor: 0, hasMore: false, events: [], reset: true };
	try {
		for (const event of events) {
			// Atomic batch on SQLite and D1. A deletion keeps its opaque marker permanently,
			// so an offline device cannot resurrect ciphertext for a deleted note.
			const statements = [];
			statements.push({
				sql: `INSERT INTO reminder_history(account_id, id, note, deleted, ciphertext)
   SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM reminder_history WHERE account_id = ? AND note = ? AND deleted = 1)
   AND (SELECT COALESCE(SUM(length(ciphertext) + 256), 0) FROM reminder_history WHERE account_id = ? AND (? = 0 OR note != ?)) + ? <= ?
   ON CONFLICT(account_id, id) DO NOTHING`,
				args: [
					accountId,
					event.id,
					event.note,
					Number(event.deleted),
					event.ciphertext,
					accountId,
					event.note,
					accountId,
					Number(event.deleted),
					event.note,
					event.ciphertext.length + 256,
					MAX_REMINDER_HISTORY_BYTES
				]
			});
			if (event.deleted)
				statements.push({
					sql: 'DELETE FROM reminder_history WHERE account_id = ? AND note = ? AND deleted = 0 AND EXISTS (SELECT 1 FROM reminder_history WHERE account_id = ? AND note = ? AND deleted = 1)',
					args: [accountId, event.note, accountId, event.note]
				});
			await db.relay.batch(statements, 'write');
			const accepted = await db.relay.execute({
				sql: 'SELECT 1 FROM reminder_history WHERE account_id = ? AND (id = ? OR (note = ? AND deleted = 1)) LIMIT 1',
				args: [accountId, event.id, event.note]
			});
			if (!accepted.rows.length)
				throw new ReminderHistoryQuotaError('Reminder history storage is full');
		}
	} finally {
		// Notify after writes, including partial batches. Retry uploads notify again,
		// so a failed notification never leaves a committed receipt invisible.
		if (events.length) await notifyReminderEvents(accountId);
	}

	await db.relay.execute({
		sql: 'UPDATE accounts SET last_seen_at = MAX(last_seen_at, ?) WHERE account_id = ?',
		args: [Date.now(), accountId]
	});
	const rows = (
		await db.relay.execute({
			sql: 'SELECT seq, id, note, deleted, ciphertext FROM reminder_history WHERE account_id = ? AND seq > ? ORDER BY seq LIMIT ?',
			args: [accountId, cursor, REMINDER_BATCH_SIZE + 1]
		})
	).rows;
	const page = rows.slice(0, REMINDER_BATCH_SIZE).map((row) => ({
		seq: Number(row.seq),
		id: String(row.id),
		note: String(row.note),
		deleted: Boolean(row.deleted),
		ciphertext: String(row.ciphertext)
	}));
	return {
		events: page,
		cursor: page.at(-1)?.seq ?? cursor,
		hasMore: rows.length > REMINDER_BATCH_SIZE
	};
}
