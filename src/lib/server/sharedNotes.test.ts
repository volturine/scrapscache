import { describe, expect, it, afterEach } from 'vitest';
import { SharedNotes } from './sharedNotes';
import { testDb, cleanupTestDbs } from './testDb';

afterEach(() => {
	cleanupTestDbs();
});

describe('SharedNotes store', () => {
	it('creates and retrieves a shared note within lifetime', async () => {
		const db = testDb();
		const store = new SharedNotes(db, () => 'fixed-id-1');
		const now = 1_000_000;

		const created = await store.create(
			{
				ciphertext: 'encrypted-payload-xyz',
				burnAfterReading: false,
				expiresInMs: 3_600_000
			},
			now
		);

		expect(created.id).toBe('fixed-id-1');
		expect(created.expiresAt).toBe(now + 3_600_000);

		const fetched = await store.get('fixed-id-1', now + 100);
		expect(fetched).toEqual({
			id: 'fixed-id-1',
			ciphertext: 'encrypted-payload-xyz',
			burnAfterReading: false,
			expiresAt: now + 3_600_000
		});

		// Can fetch again if burnAfterReading is false
		const fetchedAgain = await store.get('fixed-id-1', now + 200);
		expect(fetchedAgain?.ciphertext).toBe('encrypted-payload-xyz');
	});

	it('deletes burn-after-reading note immediately upon first view', async () => {
		const db = testDb();
		const store = new SharedNotes(db, () => 'burn-id-1');
		const now = 1_000_000;

		await store.create(
			{
				ciphertext: 'secret-burn-payload',
				burnAfterReading: true,
				expiresInMs: 3_600_000
			},
			now
		);

		const firstView = await store.get('burn-id-1', now + 50);
		expect(firstView).not.toBeNull();
		expect(firstView?.ciphertext).toBe('secret-burn-payload');
		expect(firstView?.burnAfterReading).toBe(true);

		// Second view must return null because it was destroyed
		const secondView = await store.get('burn-id-1', now + 60);
		expect(secondView).toBeNull();
	});

	it('returns null and purges when past expiration time', async () => {
		const db = testDb();
		const store = new SharedNotes(db, () => 'expire-id-1');
		const now = 1_000_000;

		await store.create(
			{
				ciphertext: 'expire-payload',
				expiresInMs: 60_000
			},
			now
		);

		// Exactly at or after expiresAt
		const expired = await store.get('expire-id-1', now + 60_001);
		expect(expired).toBeNull();

		// Record should be deleted from DB
		const rowCount = (
			await db.ops.execute({
				sql: 'SELECT COUNT(*) AS count FROM shared_notes WHERE id = ?',
				args: ['expire-id-1']
			})
		).rows[0] as unknown as { count: number };
		expect(rowCount.count).toBe(0);
	});

	it('pruneExpired deletes all outdated shared notes', async () => {
		const db = testDb();
		const ids = ['note-a', 'note-b', 'note-c'];
		const store = new SharedNotes(db, () => ids.shift()!);
		const now = 1_000_000;

		// note-a expires at now + 60_000
		await store.create({ ciphertext: 'a', expiresInMs: 60_000 }, now);
		// note-b expires at now + 60_000
		await store.create({ ciphertext: 'b', expiresInMs: 60_000 }, now);
		// note-c expires at now + 300_000
		await store.create({ ciphertext: 'c', expiresInMs: 300_000 }, now);

		await store.pruneExpired(now + 60_001);

		expect(await store.get('note-a', now + 60_001)).toBeNull();
		expect(await store.get('note-b', now + 60_001)).toBeNull();
		expect(await store.get('note-c', now + 60_001)).not.toBeNull();
	});
});
