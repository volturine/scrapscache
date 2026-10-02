import { SCRAPSCACHE_REMINDER_MAX_ACCOUNT_BYTES } from '$app/env/private';
import { getDb, type Db } from '#lib/server/db.js';
import { parseReminderMaxAccountBytes } from '#lib/server/operatorConfig.js';
import {
	REMINDER_BATCH_SIZE,
	type ReminderPacket,
	type ReminderPage
} from '#lib/reminderChannel.js';

/**
 * Receipt storage per account, apart from the note-sync quota:
 * `SCRAPSCACHE_REMINDER_MAX_ACCOUNT_BYTES`, 10 MB by default.
 */
export function reminderMaxAccountBytes(): number {
	return parseReminderMaxAccountBytes(SCRAPSCACHE_REMINDER_MAX_ACCOUNT_BYTES);
}
/** Accounted per row on top of its ciphertext, for the tag and index. */
const ROW_OVERHEAD_BYTES = 256;
export class ReminderHistoryQuotaError extends Error {}
export function validReminderPacket(value: unknown): value is ReminderPacket {
	const row = value as ReminderPacket | null;

	return (
		!!row &&
		typeof row.note === 'string' &&
		/^[a-f0-9]{64}$/.test(row.note) &&
		typeof row.deleted === 'boolean' &&
		typeof row.ciphertext === 'string' &&
		row.ciphertext.length >= 56 &&
		row.ciphertext.length <= 4096 &&
		/^[A-Za-z0-9_-]+$/.test(row.ciphertext)
	);
}

/** Whether the account has room for `bytes` more, not counting the note's own row. */
const FITS = `(SELECT COALESCE(SUM(length(ciphertext) + ${ROW_OVERHEAD_BYTES}), 0)
   FROM reminder_receipts WHERE account_id = ? AND note != ?) + ? <= ?`;

/** The note's row is newer than the uploader has seen; it must merge it first. */
const UNSEEN = `EXISTS (SELECT 1 FROM reminder_receipts WHERE account_id = ? AND note = ? AND seq > ?)`;

/**
 * One row per note. An upload replaces the note's row under a new sequence
 * number, so devices download only a note's latest state. It replaces only a row
 * the uploader has already seen: otherwise that row comes back in this page, and
 * the device merges it and uploads again, so no device's receipts are lost. A
 * deletion always applies and leaves an opaque marker for good, so an offline
 * device cannot bring the note's receipts back.
 */
export async function exchangeReminderHistory(
	accountId: string,
	cursor: number,
	notes: ReminderPacket[],
	db: Db = getDb(),
	maxBytes = reminderMaxAccountBytes()
): Promise<ReminderPage> {
	await db.ready;
	const latest = (
		await db.relay.execute({
			sql: 'SELECT COALESCE(MAX(seq), 0) AS cursor FROM reminder_receipts WHERE account_id = ?',
			args: [accountId]
		})
	).rows[0];
	if (cursor > Number(latest.cursor)) return { cursor: 0, hasMore: false, notes: [], reset: true };
	for (const row of notes) {
		const size = row.ciphertext.length + ROW_OVERHEAD_BYTES;
		const fits = [accountId, row.note, size, maxBytes];
		const unseen = [accountId, row.note, cursor];
		// Atomic on SQLite and D1. The live row is replaced only when the new one
		// fits and was seen, so a full account keeps what it has; a deletion always frees it.
		const [, inserted] = await db.relay.batch(
			[
				{
					sql: `DELETE FROM reminder_receipts WHERE account_id = ? AND note = ? AND deleted = 0
   AND (? = 1 OR (${FITS} AND NOT ${UNSEEN}))`,
					args: [accountId, row.note, Number(row.deleted), ...fits, ...unseen]
				},
				{
					sql: `INSERT INTO reminder_receipts(account_id, note, deleted, ciphertext)
   SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM reminder_receipts WHERE account_id = ? AND note = ?)
   AND ${FITS}`,
					args: [
						accountId,
						row.note,
						Number(row.deleted),
						row.ciphertext,
						accountId,
						row.note,
						...fits
					]
				}
			],
			'write'
		);
		if (inserted.rowsAffected > 0 || row.deleted) continue;
		// Receipts for a deleted note are dropped on purpose, and an unseen row is
		// this page's to deliver; anything else did not fit.
		const kept = await db.relay.execute({
			sql: `SELECT 1 FROM reminder_receipts WHERE account_id = ? AND note = ? AND (deleted = 1 OR seq > ?)`,
			args: [accountId, row.note, cursor]
		});
		if (!kept.rows.length) throw new ReminderHistoryQuotaError('Reminder history storage is full');
	}

	await db.relay.execute({
		sql: 'UPDATE accounts SET last_seen_at = MAX(last_seen_at, ?) WHERE account_id = ?',
		args: [Date.now(), accountId]
	});
	const rows = (
		await db.relay.execute({
			sql: 'SELECT seq, note, deleted, ciphertext FROM reminder_receipts WHERE account_id = ? AND seq > ? ORDER BY seq LIMIT ?',
			args: [accountId, cursor, REMINDER_BATCH_SIZE + 1]
		})
	).rows;
	const page = rows.slice(0, REMINDER_BATCH_SIZE).map((row) => ({
		seq: Number(row.seq),
		note: String(row.note),
		deleted: Boolean(row.deleted),
		ciphertext: String(row.ciphertext)
	}));
	return {
		notes: page,
		cursor: page.at(-1)?.seq ?? cursor,
		hasMore: rows.length > REMINDER_BATCH_SIZE
	};
}
