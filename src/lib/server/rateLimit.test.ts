import { describe, expect, it, afterEach, vi } from 'vitest';
import {
	TokenBucketLimiter,
	REGISTER_GLOBAL_POLICY,
	SYNC_CHURN_POLICY,
	chargeSyncChurn,
	pruneRateBuckets,
	checkAdminApiLimit,
	chargeRegisterGlobalLimit,
	checkRegisterLimit,
	clientAddress,
	enterSyncBody,
	enterSyncRequest
} from './rateLimit';
import { testDb, cleanupTestDbs } from './testDb';
import type { Db } from './db';

let mockDb: Db;

vi.mock('#lib/server/db.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./db')>();
	return {
		...actual,
		getDb: () => {
			if (!mockDb) mockDb = testDb();
			return mockDb;
		}
	};
});

afterEach(() => {
	cleanupTestDbs();
	mockDb = undefined!;
});

describe('token bucket rate limiter', () => {
	it('enforces 5-per-hour registration policy', async () => {
		const db = testDb();
		const limiter = new TokenBucketLimiter(db);
		const policy = { capacity: 5, refillWindowMs: 60 * 60 * 1000 };
		for (let i = 0; i < 5; i++) {
			expect((await limiter.check('reg-user', policy, 0)).allowed).toBe(true);
		}
		expect((await limiter.check('reg-user', policy, 0)).allowed).toBe(false);
		// After 12 minutes (720_000 ms), 1 token is refilled
		expect((await limiter.check('reg-user', policy, 720_000)).allowed).toBe(true);
		expect((await limiter.check('reg-user', policy, 720_000)).allowed).toBe(false);
	});

	it('limits bursts and refills over time', async () => {
		const db = testDb();
		const limiter = new TokenBucketLimiter(db);
		const policy = { capacity: 2, refillWindowMs: 1_000 };
		expect((await limiter.check('client', policy, 0)).allowed).toBe(true);
		expect((await limiter.check('client', policy, 0)).allowed).toBe(true);
		expect(await limiter.check('client', policy, 0)).toEqual({
			allowed: false,
			retryAfterSeconds: 1
		});
		expect((await limiter.check('client', policy, 500)).allowed).toBe(true);
	});

	it('exhausts a single-token bucket and refills it', async () => {
		const db = testDb();
		const limiter = new TokenBucketLimiter(db);
		const policy = { capacity: 1, refillWindowMs: 1_000 };
		expect((await limiter.check('a', policy, 0)).allowed).toBe(true);
		expect((await limiter.check('a', policy, 0)).allowed).toBe(false);
		expect((await limiter.check('a', policy, 1_000)).allowed).toBe(true);
	});

	it('tracks buckets independently and refills after the window', async () => {
		const db = testDb();
		const limiter = new TokenBucketLimiter(db);
		const policy = { capacity: 1, refillWindowMs: 1_000 };
		expect((await limiter.check('a', policy, 0)).allowed).toBe(true);
		expect((await limiter.check('b', policy, 0)).allowed).toBe(true);

		expect((await limiter.check('a', policy, 999)).allowed).toBe(false);
		expect((await limiter.check('b', policy, 999)).allowed).toBe(false);

		expect((await limiter.check('a', policy, 1_001)).allowed).toBe(true);
		expect((await limiter.check('b', policy, 1_001)).allowed).toBe(true);
		expect((await limiter.check('a', policy, 1_001)).allowed).toBe(false);
	});

	it('prunes every stale bucket once the sweep interval has passed', async () => {
		const db = testDb();
		const limiter = new TokenBucketLimiter(db);
		const policy = { capacity: 1, refillWindowMs: 1_000 };
		for (const key of ['a', 'b', 'c', 'd'])
			expect((await limiter.check(key, policy, 0)).allowed).toBe(true);

		expect((await limiter.check('e', policy, 10 * 60_000 + 60_000)).allowed).toBe(true);
		expect((await limiter.check('f', policy, 10 * 60_000 + 60_000)).allowed).toBe(true);
		expect((await limiter.check('g', policy, 10 * 60_000 + 60_000)).allowed).toBe(true);
	});

	it('caps refill at capacity after a long idle', async () => {
		const db = testDb();
		const limiter = new TokenBucketLimiter(db);
		const policy = { capacity: 2, refillWindowMs: 1_000 };
		expect((await limiter.check('client', policy, 0)).allowed).toBe(true);
		expect((await limiter.check('client', policy, 0)).allowed).toBe(true);

		expect((await limiter.check('client', policy, 10 * 60_000)).allowed).toBe(true);
		expect((await limiter.check('client', policy, 10 * 60_000)).allowed).toBe(true);
		expect(await limiter.check('client', policy, 10 * 60_000)).toEqual({
			allowed: false,
			retryAfterSeconds: 1
		});
	});

	it('reports multi-second retry windows proportional to missing tokens', async () => {
		const db = testDb();
		const limiter = new TokenBucketLimiter(db);
		const policy = { capacity: 2, refillWindowMs: 60_000 };
		expect((await limiter.check('client', policy, 0)).allowed).toBe(true);
		expect((await limiter.check('client', policy, 0)).allowed).toBe(true);

		const denied = await limiter.check('client', policy, 15_000);
		expect(denied).toEqual({ allowed: false, retryAfterSeconds: 15 });
	});
});

describe('weighted charges', () => {
	it('takes several tokens at once and refuses a charge larger than what is left', async () => {
		const limiter = new TokenBucketLimiter(testDb());
		const policy = { capacity: 10, refillWindowMs: 10_000 };
		expect((await limiter.check('writer', policy, 0, 7)).allowed).toBe(true);
		// Three are left: a charge of four waits for one more, and takes nothing meanwhile.
		expect(await limiter.check('writer', policy, 0, 4)).toEqual({
			allowed: false,
			retryAfterSeconds: 1
		});
		expect((await limiter.check('writer', policy, 0, 3)).allowed).toBe(true);
		expect((await limiter.check('writer', policy, 0, 1)).allowed).toBe(false);
	});

	it('caps a charge at the capacity so an oversized batch can still go through a full bucket', async () => {
		const limiter = new TokenBucketLimiter(testDb());
		const policy = { capacity: 5, refillWindowMs: 5_000 };
		expect((await limiter.check('writer', policy, 0, 50)).allowed).toBe(true);
		expect((await limiter.check('writer', policy, 0, 1)).allowed).toBe(false);
	});
});

describe('daily sync churn', () => {
	it('lets an account burst a large first upload, then holds it to 2,000 writes a day', async () => {
		expect(SYNC_CHURN_POLICY.capacity / (SYNC_CHURN_POLICY.refillWindowMs / 86_400_000)).toBe(
			2_000
		);
		expect((await chargeSyncChurn('account', SYNC_CHURN_POLICY.capacity, 0)).allowed).toBe(true);
		const refused = await chargeSyncChurn('account', 16, 0);
		// Sixteen writes at 2,000 a day refill in 16/2000 of a day: 691.2 seconds.
		expect(refused).toEqual({ allowed: false, retryAfterSeconds: 692 });
		expect((await chargeSyncChurn('other-account', 16, 0)).allowed).toBe(true);
		expect((await chargeSyncChurn('account', 16, 692_000)).allowed).toBe(true);
	});

	it('keeps a spent churn bucket through the ten-minute sweep, so a pause does not refill it', async () => {
		const db = testDb();
		const limiter = new TokenBucketLimiter(db);
		const churn = (writes: number, now: number) =>
			limiter.check('sync-churn:account', SYNC_CHURN_POLICY, now, writes);
		expect((await churn(SYNC_CHURN_POLICY.capacity, 0)).allowed).toBe(true);
		expect((await limiter.check('short', { capacity: 1, refillWindowMs: 1_000 }, 0)).allowed).toBe(
			true
		);

		await pruneRateBuckets(db, 11 * 60_000);
		const keys = (await db.ops.execute('SELECT bucket_key AS key FROM rate_buckets')).rows.map(
			(row) => row.key
		);
		expect(keys).toEqual(['sync-churn:account']);
		// Eleven minutes have refilled about fifteen writes, not the burst.
		expect((await churn(10, 11 * 60_000)).allowed).toBe(true);
		expect((await churn(1_000, 11 * 60_000)).allowed).toBe(false);

		await pruneRateBuckets(db, SYNC_CHURN_POLICY.refillWindowMs + 11 * 60_000);
		expect((await db.ops.execute('SELECT COUNT(*) AS n FROM rate_buckets')).rows[0].n).toBe(0);
	});
});

describe('refunds', () => {
	it('gives back what a round took, and never more than the bucket holds', async () => {
		const limiter = new TokenBucketLimiter(testDb());
		const policy = { capacity: 10, refillWindowMs: 86_400_000 };
		expect((await limiter.check('sync-churn:a', policy, 0, 8)).allowed).toBe(true);
		expect((await limiter.check('sync-churn:a', policy, 0, 8)).allowed).toBe(false);

		await limiter.refund('sync-churn:a', policy, 8);
		expect((await limiter.check('sync-churn:a', policy, 0, 8)).allowed).toBe(true);

		await limiter.refund('sync-churn:a', policy, 50);
		expect((await limiter.check('sync-churn:a', policy, 0, 10)).allowed).toBe(true);
		expect((await limiter.check('sync-churn:a', policy, 0, 1)).allowed).toBe(false);
	});
});

describe('admin api limiter', () => {
	it('throttles each address to a conservative budget, independently per address', async () => {
		const now = 0;
		for (let i = 0; i < 30; i++) {
			expect((await checkAdminApiLimit(() => '10.0.0.1', now)).allowed).toBe(true);
		}
		const blocked = await checkAdminApiLimit(() => '10.0.0.1', now);
		expect(blocked.allowed).toBe(false);
		if (!blocked.allowed) expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
		expect((await checkAdminApiLimit(() => '10.0.0.2', now)).allowed).toBe(true);
	});

	it('tolerates clients without an address by sharing one fallback bucket', async () => {
		expect((await checkAdminApiLimit(() => 'unknown')).allowed).toBe(true);
		expect((await checkAdminApiLimit(() => 'unknown')).allowed).toBe(true);
	});
});

describe('client address keying', () => {
	it('keys an IPv6 client by its /64 and keeps IPv4 as it is', () => {
		expect(clientAddress(() => '2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::');
		expect(clientAddress(() => '2001:DB8:0001:0002::1')).toBe('2001:db8:1:2::');
		expect(clientAddress(() => '2001:db8::')).toBe('2001:db8:0:0::');
		expect(clientAddress(() => 'fe80::1%eth0')).toBe('fe80:0:0:0::');
		expect(clientAddress(() => '64:ff9b::203.0.113.9')).toBe('64:ff9b:0:0::');
		expect(clientAddress(() => '::ffff:203.0.113.9')).toBe('203.0.113.9');
		expect(clientAddress(() => '203.0.113.9')).toBe('203.0.113.9');
		expect(clientAddress(() => 'unknown')).toBe('unknown');
		expect(
			clientAddress(() => {
				throw new Error('no socket');
			})
		).toBe('unknown');
	});
});

describe('registration limiter', () => {
	it('shares one address bucket across an IPv6 /64', async () => {
		for (let i = 1; i <= 5; i++) {
			expect((await checkRegisterLimit(() => `2001:db8:1:2::${i}`, 0)).allowed).toBe(true);
		}
		expect((await checkRegisterLimit(() => '2001:db8:1:2:ffff::1', 0)).allowed).toBe(false);
		expect((await checkRegisterLimit(() => '2001:db8:1:3::1', 0)).allowed).toBe(true);
	});

	it('refuses every registration once the shared allowance is spent, then recovers', async () => {
		const { capacity, refillWindowMs } = REGISTER_GLOBAL_POLICY;
		for (let i = 0; i < capacity; i++) {
			expect((await chargeRegisterGlobalLimit(0)).allowed).toBe(true);
		}
		const refused = await chargeRegisterGlobalLimit(0);
		expect(refused.allowed).toBe(false);
		if (!refused.allowed) expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
		const later = refillWindowMs / capacity;
		expect((await chargeRegisterGlobalLimit(later)).allowed).toBe(true);
		expect((await chargeRegisterGlobalLimit(later)).allowed).toBe(false);
	});

	it('does not spend the shared allowance on the address check', async () => {
		const { capacity } = REGISTER_GLOBAL_POLICY;
		const address = (i: number) => `198.51.${Math.floor(i / 200)}.${i % 200}`;
		for (let i = 0; i < capacity + 10; i++) {
			expect((await checkRegisterLimit(() => address(i), 0)).allowed).toBe(true);
		}
		expect((await chargeRegisterGlobalLimit(0)).allowed).toBe(true);
	});
});

describe('in-process sync slots', () => {
	it('bounds buffered bodies and relay rounds separately, each released on its own', () => {
		const bodies = [enterSyncBody(2), enterSyncBody(2)];
		expect(bodies.every((release) => release !== null)).toBe(true);
		// Both body slots are held, yet a round that is ready still gets a sync slot.
		expect(enterSyncBody(2)).toBeNull();
		const round = enterSyncRequest(1);
		expect(round).not.toBeNull();
		expect(enterSyncRequest(1)).toBeNull();

		// Freeing a body slot admits the next body, and does not touch the sync slots.
		bodies[0]!();
		bodies[0]!();
		expect(enterSyncBody(2)).not.toBeNull();
		expect(enterSyncBody(2)).toBeNull();
		expect(enterSyncRequest(1)).toBeNull();

		round!();
		expect(enterSyncRequest(1)).not.toBeNull();
	});
});
