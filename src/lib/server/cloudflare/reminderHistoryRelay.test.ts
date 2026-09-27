import { describe, expect, it } from 'vitest';
import { testD1, applyMigrations } from './testBindings';
import { batch, execute } from './d1';
import { exchangeReminderHistory } from '../reminderHistoryRelay';
import type { Db } from '../db';

describe('D1 reminder receipts', () => {
	it('uses the same durable schema and account isolation on Workers', async () => {
		const { db, client } = testD1();
		await applyMigrations(client);
		await client.execute(
			"INSERT INTO accounts(account_id,credential_hash,updated_at,last_seen_at) VALUES ('a','credential',1,1), ('b','credential',1,1)"
		);
		// Exercise the exact D1 adapter surface used by the deployed shared relay.
		const adapter = {
			execute: (statement: Parameters<typeof execute>[1]) => execute(db, statement),
			batch: (statements: Parameters<typeof batch>[1]) => batch(db, statements)
		};
		const database = { relay: adapter, ops: adapter, ready: Promise.resolve() } as unknown as Db;
		const receipt = { note: 'b'.repeat(64), deleted: false, ciphertext: 'c'.repeat(100) };
		const first = await exchangeReminderHistory('a', 0, [receipt], database);
		await exchangeReminderHistory(
			'a',
			first.cursor,
			[{ ...receipt, ciphertext: 'd'.repeat(100) }],
			database
		);
		expect((await exchangeReminderHistory('a', 0, [], database)).notes).toEqual([
			expect.objectContaining({ ciphertext: 'd'.repeat(100) })
		]);
		expect((await exchangeReminderHistory('b', 0, [], database)).notes).toEqual([]);
		await exchangeReminderHistory('a', 0, [{ ...receipt, deleted: true }], database);
		await exchangeReminderHistory('a', 0, [receipt], database);
		expect((await exchangeReminderHistory('a', 0, [], database)).notes).toEqual([
			expect.objectContaining({ deleted: true })
		]);
		client.close();
	});
});
