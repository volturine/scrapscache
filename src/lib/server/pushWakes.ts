import { Option, Schema } from 'effect';
import {
	MAX_WAKES_PER_ACCOUNT,
	WAKE_RETAIN_MS,
	type ReminderWakeInput
} from '#lib/server/syncStore.js';

const TWENTY_YEARS_MS = 20 * 365 * 24 * 60 * 60 * 1000;
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
export const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
export const WAKE_ID_RE = /^[A-Za-z0-9_-]{43}$/;

const PUSH_KEY = /^[A-Za-z0-9_-]+={0,2}$/;

export type PushKeys = { p256dh: string; auth: string };
export type PushSubscriptionBody = { endpoint: string; keys: PushKeys };

function ipVersion(hostname: string): 4 | 6 | null {
	if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
		const octets = hostname.split('.');
		const valid = octets.every((octet) => {
			if (octet.length > 1 && octet.startsWith('0')) return false;
			const value = Number(octet);
			return Number.isInteger(value) && value >= 0 && value <= 255;
		});
		return valid ? 4 : null;
	}
	if (hostname.includes(':') && /^[0-9a-fA-F:.]+$/.test(hostname)) return 6;
	return null;
}

function isPrivateIp(hostname: string): boolean {
	const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (ipVersion(normalized) === 4) {
		const [first, second] = normalized.split('.').map(Number);
		return (
			first === 0 ||
			first === 10 ||
			first === 127 ||
			(first === 100 && second >= 64 && second <= 127) ||
			(first === 169 && second === 254) ||
			(first === 172 && second >= 16 && second <= 31) ||
			(first === 192 && second === 168) ||
			(first === 198 && (second === 18 || second === 19)) ||
			first >= 224
		);
	}
	if (ipVersion(normalized) === 6) {
		return (
			normalized === '::' ||
			normalized === '::1' ||
			normalized.startsWith('fc') ||
			normalized.startsWith('fd') ||
			normalized.startsWith('64:ff9b:') ||
			/^fe[89ab]/.test(normalized) ||
			normalized.startsWith('::ffff:')
		);
	}
	return false;
}

/**
 * The push services browsers subscribe through. A push endpoint is accepted only
 * on one of them, at registration and again at send time, so the relay never
 * POSTs to a host an account chose: not to internal services, and not in bulk
 * to anyone else.
 */
export const PUSH_SERVICE_HOSTS: readonly string[] = [
	// Firefox: Mozilla autopush.
	'updates.push.services.mozilla.com',
	// Chrome, Edge on Android, Brave, Opera, Vivaldi, Samsung Internet: FCM.
	'fcm.googleapis.com',
	// Safari on macOS and iOS.
	'web.push.apple.com'
];
/** Edge on Windows: WNS nodes such as `wns2-par02p.notify.windows.com`. */
export const PUSH_SERVICE_HOST_SUFFIXES: readonly string[] = ['.notify.windows.com'];

export function isPushServiceHost(hostname: string): boolean {
	const name = hostname.toLowerCase();
	return (
		PUSH_SERVICE_HOSTS.includes(name) ||
		PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => name.endsWith(suffix))
	);
}

/** An https URL on a known push service, with no credentials. */
export function isHttpsEndpoint(value: string): boolean {
	if (value.length < 16 || value.length > 2048) return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' && !url.username && !url.password && isPushServiceHost(url.hostname)
		);
	} catch {
		return false;
	}
}

/** Minimal DNS resolution surface the endpoint check depends on. */
export type EndpointResolver = (hostname: string) => Promise<Array<{ address: string }>>;

const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

async function dohRecords(hostname: string, type: 'A' | 'AAAA'): Promise<string[]> {
	const response = await fetch(
		`${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`,
		{ headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4_000) }
	);
	if (!response.ok) throw new Error(`DoH lookup failed with ${response.status}`);
	const body = (await response.json()) as {
		Status?: number;
		Answer?: Array<{ type: number; data: string }>;
	};
	if (body.Status !== 0) throw new Error(`DoH lookup returned status ${body.Status}`);
	const recordType = type === 'A' ? 1 : 28;
	return (body.Answer ?? [])
		.filter((record) => record.type === recordType)
		.map((record) => record.data);
}

/** DNS-over-HTTPS keeps private-address rejection portable across Node and Workers. */
export const dohResolve: EndpointResolver = async (hostname) => {
	const [v4, v6] = await Promise.all([dohRecords(hostname, 'A'), dohRecords(hostname, 'AAAA')]);
	return [...v4, ...v6].map((address) => ({ address }));
};

/**
 * Endpoint hostnames must resolve to public addresses at registration time.
 * The host allowlist already keeps endpoints on push services; this guards
 * against a DNS answer that would still point one of them at private space.
 */
export async function isPublicEndpoint(
	value: string,
	resolve: EndpointResolver = dohResolve
): Promise<boolean> {
	if (!isHttpsEndpoint(value)) return false;
	try {
		const addresses = await resolve(new URL(value).hostname.toLowerCase());
		return addresses.length > 0 && addresses.every(({ address }) => !isPrivateIp(address));
	} catch {
		return false;
	}
}

const pushKey = (minLength: number, maxLength: number) =>
	Schema.String.pipe(
		Schema.check(Schema.isBetweenLength(minLength, maxLength), Schema.isPattern(PUSH_KEY))
	);

const isPushSubscriptionBody = Schema.is(
	Schema.Struct({
		endpoint: Schema.String.pipe(
			Schema.refine((endpoint): endpoint is string => isHttpsEndpoint(endpoint))
		),
		keys: Schema.Struct({ p256dh: pushKey(16, 256), auth: pushKey(8, 128) })
	})
);

export function isPushSubscription(value: unknown): value is PushSubscriptionBody {
	return isPushSubscriptionBody(value);
}

const decodeWakes = Schema.decodeUnknownOption(
	Schema.Array(
		Schema.Struct({
			id: Schema.String.pipe(Schema.check(Schema.isPattern(WAKE_ID_RE))),
			fireAt: Schema.Number.pipe(
				Schema.check(
					Schema.isInt(),
					Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER })
				)
			)
		})
	)
);

export function parseReminderWakes(value: unknown, now: number): ReminderWakeInput[] | null {
	// Counted before any item is read, so an oversized list costs nothing.
	if (!Array.isArray(value) || value.length > MAX_WAKES_PER_ACCOUNT) return null;
	const decoded = Option.getOrNull(decodeWakes(value));
	if (!decoded) return null;
	const seen = new Set<string>();
	const wakes = new Map<string, ReminderWakeInput>();
	for (const wake of decoded) {
		if (seen.has(wake.id)) return null;
		seen.add(wake.id);
		if (wake.fireAt <= now - WAKE_RETAIN_MS || wake.fireAt > now + TWENTY_YEARS_MS) continue;
		wakes.set(wake.id, { id: wake.id, fireAt: wake.fireAt });
	}
	return [...wakes.values()].sort(
		(left, right) => left.fireAt - right.fireAt || left.id.localeCompare(right.id)
	);
}
