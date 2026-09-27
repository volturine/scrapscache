import { afterEach, describe, expect, it } from 'vitest';
import { testDb, cleanupTestDbs } from './testDb';
import { SyncStore } from './syncStore';
import {
	exchangeReminderHistory,
	reminderMaxAccountBytes,
	ReminderHistoryQuotaError
} from './reminderHistoryRelay';
import { DEFAULT_REMINDER_MAX_ACCOUNT_BYTES } from './operatorConfig';
import { REMINDER_BATCH_SIZE, type ReminderPacket } from '$lib/reminderChannel';

afterEach(cleanupTestDbs);
const packet = (note: number, deleted = false, fill = 'c'): ReminderPacket => ({
	note: note.toString(16).padStart(64, '0'),
	deleted,
	ciphertext: fill.repeat(100)
});
async function setup() {
	const db = testDb();
	const store = new SyncStore(db);
	await store.createAccount('a', 'credential');
	await store.createAccount('b', 'credential');
	return db;
}
const seen = async (db: ReturnType<typeof testDb>) =>
	Number((await db.relay.execute('SELECT MAX(seq) AS seq FROM reminder_receipts')).rows[0].seq);
const rows = async (db: ReturnType<typeof testDb>) =>
	(
		await db.relay.execute(
			'SELECT seq, note, deleted, ciphertext FROM reminder_receipts ORDER BY seq'
		)
	).rows;

describe('encrypted reminder relay', () => {
	it('keeps one row per note, replaced under a new sequence number', async () => {
		const db = await setup();
		await exchangeReminderHistory('a', 0, [packet(1)], db);
		const first = await exchangeReminderHistory('a', 0, [], db);
		await Promise.all([
			exchangeReminderHistory('a', first.cursor, [packet(1, false, 'd')], db),
			exchangeReminderHistory('a', first.cursor, [packet(1, false, 'd')], db)
		]);
		const stored = await rows(db);
		expect(stored).toHaveLength(1);
		expect(stored[0].ciphertext).toBe('d'.repeat(100));
		// A device past the old row still receives the replacement.
		const next = await exchangeReminderHistory('a', first.cursor, [], db);
		expect(next.notes.map((row) => row.ciphertext)).toEqual(['d'.repeat(100)]);
	});
	it('isolates accounts, paginates, and leaves note revisions unchanged', async () => {
		const db = await setup();
		for (let note = 1; note <= 30; note++)
			await exchangeReminderHistory('a', 0, [packet(note)], db);

		let page = await exchangeReminderHistory('a', 0, [], db);
		expect(page.notes).toHaveLength(REMINDER_BATCH_SIZE);
		expect(page.hasMore).toBe(true);
		const received = [...page.notes];
		while (page.hasMore) {
			page = await exchangeReminderHistory('a', page.cursor, [], db);
			received.push(...page.notes);
		}
		expect(received).toHaveLength(30);

		expect((await exchangeReminderHistory('b', 0, [], db)).notes).toEqual([]);
		expect(
			(await db.relay.execute('SELECT next_seq FROM accounts')).rows.map((row) => row.next_seq)
		).toEqual([0, 0]);
		await db.relay.execute("DELETE FROM accounts WHERE account_id = 'a'");
		expect(
			(await db.relay.execute('SELECT count(*) AS total FROM reminder_receipts')).rows[0].total
		).toBe(0);
	});
	it('replaces only a row the uploader has already seen, and returns the one it has not', async () => {
		const db = await setup();
		await exchangeReminderHistory('a', 0, [packet(1)], db);
		const behind = await exchangeReminderHistory('a', 0, [packet(1, false, 'd')], db);
		expect((await rows(db)).map((row) => row.ciphertext)).toEqual(['c'.repeat(100)]);
		expect(behind.notes.map((row) => row.ciphertext)).toEqual(['c'.repeat(100)]);
		await exchangeReminderHistory('a', behind.cursor, [packet(1, false, 'd')], db);
		expect((await rows(db)).map((row) => row.ciphertext)).toEqual(['d'.repeat(100)]);
	});
	it('keeps a deletion for good and drops later receipts for that note', async () => {
		const db = await setup();
		await exchangeReminderHistory('a', 0, [packet(1)], db);
		await exchangeReminderHistory('a', 0, [packet(1, true)], db);
		await exchangeReminderHistory('a', 0, [packet(1)], db);
		expect(await rows(db)).toEqual([expect.objectContaining({ deleted: 1 })]);
	});
	it('refuses what does not fit without losing the stored row, and lets deletion reclaim space', async () => {
		const db = await setup();
		// An operator-set limit; the stored row fills it exactly.
		const quota = 4096;
		const large = 'x'.repeat(quota - 256);
		await db.relay.execute({
			sql: 'INSERT INTO reminder_receipts(account_id, note, deleted, ciphertext) VALUES (?, ?, 0, ?)',
			args: ['a', packet(1).note, large]
		});
		await expect(exchangeReminderHistory('a', 0, [packet(2)], db, quota)).rejects.toBeInstanceOf(
			ReminderHistoryQuotaError
		);
		// Replacing a note's own row counts only the new size.
		await exchangeReminderHistory('a', await seen(db), [packet(1, false, 'e')], db, quota);
		expect((await rows(db))[0].ciphertext).toBe('e'.repeat(100));

		await db.relay.execute({
			sql: 'UPDATE reminder_receipts SET ciphertext = ? WHERE note = ?',
			args: [large, packet(1).note]
		});
		await db.relay.execute({
			sql: 'INSERT INTO reminder_receipts(account_id, note, deleted, ciphertext) VALUES (?, ?, 0, ?)',
			args: ['a', packet(3).note, 'y'.repeat(200)]
		});
		await expect(
			exchangeReminderHistory('a', await seen(db), [packet(3, false, 'z'.repeat(3))], db, quota)
		).rejects.toBeInstanceOf(ReminderHistoryQuotaError);
		expect((await rows(db)).map((row) => row.ciphertext)).toContain('y'.repeat(200));

		await exchangeReminderHistory('a', 0, [packet(1, true)], db, quota);
		await exchangeReminderHistory('a', 0, [packet(2)], db, quota);
		const stored = await rows(db);
		expect(stored.map((row) => row.deleted)).toEqual([0, 1, 0]);
	});
	it('defaults the receipt quota to 10 MB', () => {
		expect(DEFAULT_REMINDER_MAX_ACCOUNT_BYTES).toBe(10_000_000);
		expect(reminderMaxAccountBytes()).toBe(DEFAULT_REMINDER_MAX_ACCOUNT_BYTES);
	});
	it('asks a device ahead of the relay to rebuild', async () => {
		const db = await setup();
		await exchangeReminderHistory('a', 0, [packet(1)], db);
		expect(await exchangeReminderHistory('a', 99_999, [], db)).toEqual({
			cursor: 0,
			hasMore: false,
			notes: [],
			reset: true
		});
	});
});
