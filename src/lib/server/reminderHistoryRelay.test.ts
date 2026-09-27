import { afterEach, describe, expect, it } from 'vitest';
import { testDb, cleanupTestDbs } from './testDb';
import { SyncStore } from './syncStore';
import {
	exchangeReminderHistory,
	MAX_REMINDER_HISTORY_BYTES,
	ReminderHistoryQuotaError
} from './reminderHistoryRelay';
import { REMINDER_BATCH_SIZE, type ReminderPacket } from '$lib/reminderChannel';

afterEach(cleanupTestDbs);
const packet = (index: number, note = 1, deleted = false): ReminderPacket => ({
	id: index.toString(16).padStart(64, '0'),
	note: note.toString(16).padStart(64, '0'),
	deleted,
	ciphertext: 'c'.repeat(100)
});
async function setup() {
	const db = testDb();
	const store = new SyncStore(db);
	await store.createAccount('a', 'credential');
	await store.createAccount('b', 'credential');
	return db;
}

describe('encrypted reminder relay', () => {
	it('isolates accounts, deduplicates retries, paginates, and leaves note revisions unchanged', async () => {
		const db = await setup();
		await Promise.all([
			exchangeReminderHistory('a', 0, [packet(1)], db),
			exchangeReminderHistory('a', 0, [packet(1)], db)
		]);
		for (let i = 2; i < 55; i++) await exchangeReminderHistory('a', 0, [packet(i)], db);

		let page = await exchangeReminderHistory('a', 0, [], db);
		expect(page.events).toHaveLength(REMINDER_BATCH_SIZE);
		expect(page.hasMore).toBe(true);
		const received = [...page.events];
		while (page.hasMore) {
			page = await exchangeReminderHistory('a', page.cursor, [], db);
			received.push(...page.events);
		}
		expect(received).toHaveLength(54);

		expect((await exchangeReminderHistory('b', 0, [], db)).events).toEqual([]);
		expect(
			(await db.relay.execute('SELECT next_seq FROM accounts')).rows.map((row) => row.next_seq)
		).toEqual([0, 0]);
		await db.relay.execute("DELETE FROM accounts WHERE account_id = 'a'");
		expect(
			(await db.relay.execute('SELECT count(*) AS total FROM reminder_history')).rows[0].total
		).toBe(0);
	});
	it('enforces storage bounds atomically, while allowing deletion to reclaim space', async () => {
		const db = await setup();
		await db.relay.execute({
			sql: 'INSERT INTO reminder_history(account_id,id,note,deleted,ciphertext) VALUES (?, ?, ?, 0, ?)',
			args: ['a', 'existing', packet(1).note, 'x'.repeat(MAX_REMINDER_HISTORY_BYTES - 256)]
		});
		await expect(exchangeReminderHistory('a', 0, [packet(2)], db)).rejects.toBeInstanceOf(
			ReminderHistoryQuotaError
		);
		await exchangeReminderHistory('a', 0, [packet(3, 1, true)], db);
		await exchangeReminderHistory('a', 0, [packet(2)], db);
		const rows = (await db.relay.execute('SELECT id, deleted FROM reminder_history')).rows;
		expect(rows).toHaveLength(1);
		expect(rows[0].deleted).toBe(1);
	});
});
