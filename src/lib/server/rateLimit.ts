import { recordRateLimit } from '#lib/server/metrics.js';
import { getDb, type Db } from '#lib/server/db.js';

export type RateLimitPolicy = {
	capacity: number;
	refillWindowMs: number;
};

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export const RATE_BUCKET_STALE_MS = 10 * 60_000;

const CHECK_SQL = `
	INSERT INTO rate_buckets (bucket_key, tokens, updated_at, last_seen_at, last_allowed)
	VALUES (?1, ?2 - 1, ?3, ?3, 1)
	ON CONFLICT(bucket_key) DO UPDATE SET
		tokens = CASE
			WHEN min(?2, rate_buckets.tokens + (?3 - rate_buckets.updated_at) * ?4) >= 1
			THEN min(?2, rate_buckets.tokens + (?3 - rate_buckets.updated_at) * ?4) - 1
			ELSE min(?2, rate_buckets.tokens + (?3 - rate_buckets.updated_at) * ?4)
		END,
		last_allowed = CASE
			WHEN min(?2, rate_buckets.tokens + (?3 - rate_buckets.updated_at) * ?4) >= 1 THEN 1
			ELSE 0
		END,
		updated_at = ?3,
		last_seen_at = ?3
	RETURNING tokens AS tokens, last_allowed AS allowed
`;

/** Durable token bucket: one atomic upsert per check so every server isolate
 * shares the same allowance for a key. */
export class TokenBucketLimiter {
	constructor(private readonly db: Db) {}

	async check(key: string, policy: RateLimitPolicy, now = Date.now()): Promise<RateLimitResult> {
		const refillPerMs = policy.capacity / policy.refillWindowMs;
		try {
			await this.db.ready;
			const result = await this.db.ops.execute({
				sql: CHECK_SQL,
				args: [key, policy.capacity, now, refillPerMs]
			});
			const bucket = result.rows[0] as unknown as { tokens: number; allowed: number };
			if (bucket.allowed === 1) return { allowed: true };
			const retryAfterSeconds = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
			return { allowed: false, retryAfterSeconds };
		} catch {
			return { allowed: false, retryAfterSeconds: 1 };
		}
	}
}

let publicLimiter: TokenBucketLimiter | undefined;

export function getPublicApiLimiter(): TokenBucketLimiter {
	publicLimiter ??= new TokenBucketLimiter(getDb());
	return publicLimiter;
}

export async function checkAdminApiLimit(
	getClientAddress: () => string,
	now = Date.now()
): Promise<RateLimitResult> {
	const limiter = new TokenBucketLimiter(getDb());
	return limiter.check(
		`admin:${clientAddress(getClientAddress)}`,
		{
			capacity: 30,
			refillWindowMs: 60_000
		},
		now
	);
}

export async function pruneRateBuckets(db: Db, now = Date.now()): Promise<void> {
	await db.ready;
	await db.ops.execute({
		sql: 'DELETE FROM rate_buckets WHERE last_seen_at <= ?',
		args: [now - RATE_BUCKET_STALE_MS]
	});
}

/**
 * Callers whose latest request was refused and who have been seen recently
 * enough that their bucket still exists. A current picture rather than a count
 * over time: recording each refusal would cost a write per refused request,
 * which is exactly what a flood should not get.
 */
export async function countThrottledCallers(db: Db, now = Date.now()): Promise<number> {
	await db.ready;
	const row = (
		await db.ops.execute({
			sql: 'SELECT COUNT(*) AS callers FROM rate_buckets WHERE last_allowed = 0 AND last_seen_at > ?',
			args: [now - RATE_BUCKET_STALE_MS]
		})
	).rows[0] as { callers?: number } | undefined;
	return Number(row?.callers ?? 0);
}

/**
 * The address a client is limited as. An IPv6 client is keyed by its /64, the
 * least an ISP hands a subscriber, as every address in it would otherwise be a
 * bucket of its own. IPv4 addresses, including those a dual-stack socket reports
 * as IPv4-mapped IPv6, stay as they are.
 */
export function clientAddress(getClientAddress: () => string): string {
	let address: string;
	try {
		address = getClientAddress();
	} catch {
		return 'unknown';
	}
	return ipv6Network(address) ?? address;
}

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const HEXTET = /^[0-9a-f]{1,4}$/i;

/** The /64 of an IPv6 address as its network address, the IPv4 inside a mapped
 * address, or null when `address` is not IPv6. */
function ipv6Network(address: string): string | null {
	if (!address.includes(':')) return null;
	const mapped = IPV4_MAPPED.exec(address);
	if (mapped) return mapped[1];
	const halves = address.split('%')[0].split('::');
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(':') : [];
	const tail = halves[1] ? halves[1].split(':') : [];
	// A dotted quad at the end stands for two hextets.
	const given = [...head, ...tail].reduce((n, part) => n + (part.includes('.') ? 2 : 1), 0);
	if (halves.length === 1 ? given !== 8 : given > 7) return null;
	const hextets = [...head, ...Array<string>(8 - given).fill('0'), ...tail].slice(0, 4);
	if (!hextets.every((hextet) => HEXTET.test(hextet))) return null;
	return `${hextets.map((hextet) => parseInt(hextet, 16).toString(16)).join(':')}::`;
}

/** Each address: five at once, then one every twelve minutes. */
export const REGISTER_ADDRESS_POLICY: RateLimitPolicy = {
	capacity: 5,
	refillWindowMs: 60 * 60_000
};
/**
 * All verified registrations together: a hundred at once, then ten a minute. A
 * launch-day peak is a few a minute, so real signups never meet it, while a
 * flood from many addresses cannot run the store's writes up faster than this.
 */
export const REGISTER_GLOBAL_POLICY: RateLimitPolicy = {
	capacity: 100,
	refillWindowMs: 10 * 60_000
};

/** The caller's own registration allowance; checked before anything is read. */
export function checkRegisterLimit(
	getClientAddress: () => string,
	now = Date.now()
): Promise<RateLimitResult> {
	return new TokenBucketLimiter(getDb()).check(
		`register:${clientAddress(getClientAddress)}`,
		REGISTER_ADDRESS_POLICY,
		now
	);
}

/**
 * Everyone's registration allowance. Charged only for a request whose
 * credential and human check already passed, so junk from many addresses
 * cannot drain it and lock real signups out.
 */
export function chargeRegisterGlobalLimit(now = Date.now()): Promise<RateLimitResult> {
	return new TokenBucketLimiter(getDb()).check('register-global', REGISTER_GLOBAL_POLICY, now);
}

export function rateLimitResponse(result: Exclude<RateLimitResult, { allowed: true }>): Response {
	recordRateLimit();
	return Response.json(
		{ error: 'Too many requests' },
		{ status: 429, headers: { 'retry-after': String(result.retryAfterSeconds) } }
	);
}

let activeSyncRequests = 0;

export function enterSyncRequest(maxConcurrent = 8): (() => void) | null {
	if (activeSyncRequests >= maxConcurrent) return null;
	activeSyncRequests += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		activeSyncRequests = Math.max(0, activeSyncRequests - 1);
	};
}
