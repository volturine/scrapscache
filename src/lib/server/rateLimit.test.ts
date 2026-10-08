import { describe, expect, it, afterEach, vi } from 'vitest';
import {
	TokenBucketLimiter,
	REGISTER_GLOBAL_POLICY,
	checkAdminApiLimit,
	checkRegisterLimit,
	clientAddress
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

	it('refuses every address once the shared allowance is spent, then recovers', async () => {
		const { capacity, refillWindowMs } = REGISTER_GLOBAL_POLICY;
		const address = (i: number) => `198.51.${Math.floor(i / 200)}.${i % 200}`;
		for (let i = 0; i < capacity; i++) {
			expect((await checkRegisterLimit(() => address(i), 0)).allowed).toBe(true);
		}
		const refused = await checkRegisterLimit(() => address(capacity), 0);
		expect(refused.allowed).toBe(false);
		if (!refused.allowed) expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
		const later = refillWindowMs / capacity;
		expect((await checkRegisterLimit(() => address(capacity + 1), later)).allowed).toBe(true);
		expect((await checkRegisterLimit(() => address(capacity + 2), later)).allowed).toBe(false);
	});
});
