// Reminder wakes for the iPhone app, sent through Apple's push service (APNs).
// The app shows its own notification for every reminder it holds, so a push only
// covers a reminder the phone has not synced yet, with the words a browser shows
// for a note it does not hold. Apple sees the phone's push token, the time and
// those fixed words: never a note, a title or an account.
import {
	SCRAPSCACHE_APNS_KEY,
	SCRAPSCACHE_APNS_KEY_ID,
	SCRAPSCACHE_APNS_TEAM_ID,
	SCRAPSCACHE_APNS_TOPICS
} from '$app/env/private';
import { p256 } from '@noble/curves/nist.js';
import { wakeNotificationId } from '#lib/model/reminderWakes.js';
import { postToApple } from '#lib/server/apnsTransport.js';
import type { DueWake } from '#lib/server/syncStore.js';
import type { WakeSendResult } from '#lib/server/webPush.js';

const PRODUCTION_HOST = 'api.push.apple.com';
/** Where a build run from Xcode or in a simulator is registered. */
const SANDBOX_HOST = 'api.sandbox.push.apple.com';
const SEND_TIMEOUT_MS = 10_000;
/** How long Apple keeps a push for a phone that is off, as web push does. */
const EXPIRY_SECONDS = 24 * 60 * 60;
/**
 * Apple refuses a provider token older than an hour, and one replaced more often
 * than every twenty minutes. Every isolate signs the same token for the same half
 * hour (the signature is deterministic), so none of them replaces another's.
 */
const TOKEN_WINDOW_SECONDS = 30 * 60;

const ADDRESS_RE = /^apns:\/\/([A-Za-z0-9.-]{1,155})\/([0-9a-f]{64,200})\/([A-Za-z0-9_-]{16,128})$/;
const REASON_RE = /^[A-Za-z]{1,64}$/;

const encoder = new TextEncoder();

export type ApnsConfig = { key: string; keyId: string; teamId: string; topics: string[] };
/** An installed app's push token, and the app (its bundle id) the token belongs to. */
export type ApnsDevice = { token: string; topic: string };

let warnedIncomplete = false;

/** The Apple key and the apps it may send to, or null when this relay sends to none. */
export function apnsConfig(): ApnsConfig | null {
	const key = SCRAPSCACHE_APNS_KEY?.trim();
	const keyId = SCRAPSCACHE_APNS_KEY_ID?.trim();
	const teamId = SCRAPSCACHE_APNS_TEAM_ID?.trim();
	const topics = (SCRAPSCACHE_APNS_TOPICS ?? '')
		.split(',')
		.map((topic) => topic.trim())
		.filter(Boolean);
	if (key && keyId && teamId && topics.length) return { key, keyId, teamId, topics };
	if ((key || keyId || teamId || topics.length) && !warnedIncomplete) {
		warnedIncomplete = true;
		console.warn(
			JSON.stringify({
				level: 'warn',
				event: 'apns_config_incomplete',
				message:
					'Set SCRAPSCACHE_APNS_KEY, _KEY_ID, _TEAM_ID and _TOPICS together; push to the iPhone app is off'
			})
		);
	}
	return null;
}

/**
 * How a phone is stored among the push devices. iOS gives an app one token for
 * all its workspaces, so the account is part of the address: each account's row
 * is its own, and a token re-registered under the same account replaces the row
 * it had.
 */
export function apnsAddress(device: ApnsDevice, accountId: string): string {
	return `apns://${device.topic}/${device.token}/${accountId}`;
}

export function isApnsAddress(endpoint: string): boolean {
	return endpoint.startsWith('apns://');
}

export function parseApnsAddress(endpoint: string): ApnsDevice | null {
	const match = ADDRESS_RE.exec(endpoint);
	return match ? { topic: match[1], token: match[2] } : null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
	const raw = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
	const bytes = new Uint8Array(new ArrayBuffer(raw.length));
	for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
	return bytes;
}

let signingKey: { pem: string; secret: Uint8Array } | null = null;

/** The private scalar inside Apple's `.p8` file, which is a PKCS#8 PEM. */
async function signingSecret(pem: string): Promise<Uint8Array> {
	if (signingKey?.pem === pem) return signingKey.secret;
	const der = base64ToBytes(
		pem
			.replaceAll('\\n', '\n')
			.replace(/-----[A-Z ]+-----/g, '')
			.replace(/\s+/g, '')
	);
	const key = await crypto.subtle.importKey(
		'pkcs8',
		der,
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['sign']
	);
	const jwk = await crypto.subtle.exportKey('jwk', key);
	if (!jwk.d) throw new Error('The Apple push key holds no private key');
	const secret = base64ToBytes(jwk.d);
	signingKey = { pem, secret };
	return secret;
}

/** The token that tells Apple who is sending, the same for the whole half hour. */
export async function providerToken(config: ApnsConfig, now: number): Promise<string> {
	const issuedAt = Math.floor(now / 1000 / TOKEN_WINDOW_SECONDS) * TOKEN_WINDOW_SECONDS;
	const header = bytesToBase64Url(
		encoder.encode(JSON.stringify({ alg: 'ES256', kid: config.keyId }))
	);
	const claims = bytesToBase64Url(
		encoder.encode(JSON.stringify({ iss: config.teamId, iat: issuedAt }))
	);
	const signingInput = `${header}.${claims}`;
	const signature = p256.sign(encoder.encode(signingInput), await signingSecret(config.key), {
		prehash: true,
		format: 'compact'
	});
	return `${signingInput}.${bytesToBase64Url(signature)}`;
}

/** What a browser shows for a reminder whose note it does not hold. */
const WAKE_BODY = JSON.stringify({
	aps: {
		alert: { title: 'Reminder', body: 'Open Scraps Cache to check your notes.' },
		sound: 'default'
	}
});

function wakeHeaders(
	device: ApnsDevice,
	wake: DueWake,
	token: string,
	now: number
): Record<string, string> {
	return {
		authorization: `bearer ${token}`,
		'apns-topic': device.topic,
		'apns-push-type': 'alert',
		'apns-priority': '10',
		'apns-expiration': String(Math.floor(now / 1000) + EXPIRY_SECONDS),
		// The number the app's own notification for this wake goes by, so the two
		// are one notification and the app takes this one down the same way.
		'apns-collapse-id': String(wakeNotificationId(wake.wakeId)),
		'content-type': 'application/json'
	};
}

type Answer = { ok: boolean; status: number; reason: string | null };

/** Why Apple refused, when it says so in the one word its replies carry. */
function refusal(body: string): string | null {
	try {
		const reason = (JSON.parse(body) as { reason?: unknown } | null)?.reason;
		return typeof reason === 'string' && REASON_RE.test(reason) ? reason : null;
	} catch {
		return null;
	}
}

async function post(
	host: string,
	device: ApnsDevice,
	headers: Record<string, string>
): Promise<Answer> {
	const answer = await postToApple(
		host,
		`/3/device/${device.token}`,
		headers,
		WAKE_BODY,
		SEND_TIMEOUT_MS
	);
	const ok = answer.status >= 200 && answer.status < 300;
	return { ok, status: answer.status, reason: ok ? null : refusal(answer.body) };
}

function logFailure(status: number | null, reason: string | null): void {
	console.info(
		JSON.stringify({
			level: 'info',
			event: 'reminder_wake_failed',
			service: 'apns',
			status,
			...(reason === null ? {} : { message: reason })
		})
	);
}

/** Apple no longer knows the token, or it is another app's: the phone is dropped. */
function isGone(answer: Answer): boolean {
	return (
		answer.status === 410 ||
		(answer.status === 400 &&
			(answer.reason === 'BadDeviceToken' || answer.reason === 'DeviceTokenNotForTopic'))
	);
}

/**
 * Send one wake to one phone. Like a web push send, every failure is the send's
 * own: logged and reported, never thrown.
 */
export async function sendApnsWake(wake: DueWake, now = Date.now()): Promise<WakeSendResult> {
	const device = parseApnsAddress(wake.endpoint);
	if (!device) {
		logFailure(null, 'MalformedAddress');
		return 'gone';
	}
	const config = apnsConfig();
	// A relay that lost its key keeps its phones: the wake is retried until it expires.
	if (!config) {
		logFailure(null, 'NotConfigured');
		return 'failed';
	}
	if (!config.topics.includes(device.topic)) {
		logFailure(null, 'TopicNotAllowed');
		return 'gone';
	}
	try {
		const headers = wakeHeaders(device, wake, await providerToken(config, now), now);
		let answer = await post(PRODUCTION_HOST, device, headers);
		// A token Apple's production service does not know may be a development build's.
		if (answer.status === 400 && answer.reason === 'BadDeviceToken') {
			answer = await post(SANDBOX_HOST, device, headers);
		}
		if (answer.ok) return 'sent';
		logFailure(answer.status, answer.reason);
		return isGone(answer) ? 'gone' : 'failed';
	} catch (error) {
		logFailure(null, error instanceof Error ? error.name : 'SendFailed');
		return 'failed';
	}
}
