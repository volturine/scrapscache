import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import { wakeNotificationId } from '#lib/model/reminderWakes.js';
import { privateEnv } from '../../tests/env';

const apple = vi.hoisted(() => ({
	post: vi.fn<
		(
			host: string,
			path: string,
			headers: Record<string, string>,
			body: string,
			timeoutMs: number
		) => Promise<{ status: number; body: string }>
	>()
}));
vi.mock('#lib/server/apnsTransport.js', () => ({ postToApple: apple.post }));

import {
	apnsAddress,
	apnsConfig,
	isApnsAddress,
	parseApnsAddress,
	providerToken,
	sendApnsWake
} from './apns';

const TOKEN = 'ab'.repeat(32);
const TOPIC = 'com.scrapscache.app';
const ACCOUNT = 'account-aaaaaaaaaaaa';
const WAKE_ID = 'KF2Uqldw0Rk-G-3Q53tTgfPtymnms48Rkks3tUian18';
const NOW = Date.UTC(2030, 0, 7, 9, 10);
/** The reminder's own time: the send under test is a retry, hours late. */
const FIRED = NOW - 5 * 60 * 60_000;

function base64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64UrlToBytes(value: string): Uint8Array {
	return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (character) =>
		character.charCodeAt(0)
	);
}

/** A key as Apple hands it out: a PKCS#8 PEM, with the public half to check signatures. */
async function appleKey(): Promise<{ pem: string; publicKey: Uint8Array }> {
	const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);
	const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
	const lines = base64(der).match(/.{1,64}/g) ?? [];
	return {
		pem: `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`,
		publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
	};
}

async function configure(): Promise<{ publicKey: Uint8Array }> {
	const key = await appleKey();
	privateEnv.SCRAPSCACHE_APNS_KEY = key.pem;
	privateEnv.SCRAPSCACHE_APNS_KEY_ID = 'KEY1234567';
	privateEnv.SCRAPSCACHE_APNS_TEAM_ID = 'TEAM123456';
	privateEnv.SCRAPSCACHE_APNS_TOPICS = `${TOPIC}, ${TOPIC}.dev`;
	return key;
}

const wake = (endpoint = apnsAddress({ token: TOKEN, topic: TOPIC }, ACCOUNT)) => ({
	accountId: ACCOUNT,
	deviceId: 'device-aaaaaaaaaaaa',
	wakeId: WAKE_ID,
	fireAt: FIRED,
	endpoint,
	p256dh: '',
	auth: ''
});

/** What Apple answers the next sends with, in order: a status and its one-word reason. */
function answers(...responses: Array<[number, string?]>) {
	apple.post.mockReset();
	apple.post.mockImplementation(async () => {
		const [status, reason] = responses.shift() ?? [200];
		return { status, body: reason ? JSON.stringify({ reason }) : '' };
	});
	return apple.post;
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined);
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the relay’s Apple push settings', () => {
	it('is off until the key, its id, the team and the apps are all set', async () => {
		expect(apnsConfig()).toBeNull();
		await configure();
		expect(apnsConfig()).toMatchObject({
			keyId: 'KEY1234567',
			teamId: 'TEAM123456',
			topics: [TOPIC, `${TOPIC}.dev`]
		});
		delete privateEnv.SCRAPSCACHE_APNS_TEAM_ID;
		expect(apnsConfig()).toBeNull();
	});
});

describe('a phone among the push devices', () => {
	it('is one address per account, so two workspaces on a phone each keep their own', () => {
		const first = apnsAddress({ token: TOKEN, topic: TOPIC }, ACCOUNT);
		const second = apnsAddress({ token: TOKEN, topic: TOPIC }, 'account-bbbbbbbbbbbb');
		expect(first).not.toBe(second);
		expect(isApnsAddress(first)).toBe(true);
		expect(isApnsAddress('https://fcm.googleapis.com/fcm/send/x')).toBe(false);
		expect(parseApnsAddress(first)).toEqual({ token: TOKEN, topic: TOPIC });
		expect(parseApnsAddress(second)).toEqual({ token: TOKEN, topic: TOPIC });
	});

	it('reads nothing out of an address that is not a whole one', () => {
		expect(parseApnsAddress(`apns://${TOPIC}/${TOKEN}`)).toBeNull();
		expect(parseApnsAddress(`apns://${TOPIC}/not-hex/${ACCOUNT}`)).toBeNull();
		expect(parseApnsAddress(`apns://${TOPIC}/${TOKEN}/${ACCOUNT}/more`)).toBeNull();
		expect(parseApnsAddress(`apns://evil.example/3/device/${TOKEN}/${ACCOUNT}`)).toBeNull();
	});
});

describe('the token that names the sender to Apple', () => {
	it('is signed with the Apple key and names the key and the team', async () => {
		const { publicKey } = await configure();
		const config = apnsConfig();
		if (!config) throw new Error('not configured');
		const token = await providerToken(config, NOW);
		const [header, claims, signature] = token.split('.');
		expect(JSON.parse(new TextDecoder().decode(base64UrlToBytes(header)))).toEqual({
			alg: 'ES256',
			kid: 'KEY1234567'
		});
		const { iss, iat } = JSON.parse(new TextDecoder().decode(base64UrlToBytes(claims)));
		expect(iss).toBe('TEAM123456');
		expect(iat).toBeLessThanOrEqual(NOW / 1000);
		expect(iat).toBeGreaterThan(NOW / 1000 - 30 * 60);
		expect(
			p256.verify(
				base64UrlToBytes(signature),
				new TextEncoder().encode(`${header}.${claims}`),
				publicKey,
				{ prehash: true, format: 'compact' }
			)
		).toBe(true);
	});

	it('is the same for half an hour, so no isolate replaces another’s', async () => {
		await configure();
		const config = apnsConfig();
		if (!config) throw new Error('not configured');
		const first = await providerToken(config, NOW);
		expect(await providerToken(config, NOW + 19 * 60_000)).toBe(first);
		expect(await providerToken(config, NOW + 31 * 60_000)).not.toBe(first);
	});
});

describe('sending a wake to a phone', () => {
	it('posts the browser’s words for an unsynced note, and nothing about the note', async () => {
		await configure();
		const post = answers([200]);
		await expect(sendApnsWake(wake(), NOW)).resolves.toBe('sent');
		expect(post).toHaveBeenCalledOnce();
		const [host, path, headers, body] = post.mock.calls[0];
		expect(host).toBe('api.push.apple.com');
		expect(path).toBe(`/3/device/${TOKEN}`);
		expect(headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
		expect(headers['apns-topic']).toBe(TOPIC);
		expect(headers['apns-push-type']).toBe('alert');
		expect(headers['apns-priority']).toBe('10');
		// A day from the reminder, however late the send.
		expect(headers['apns-expiration']).toBe(String(FIRED / 1000 + 86_400));
		// The app's own notification for the wake goes by the same number.
		expect(headers['apns-collapse-id']).toBe(String(wakeNotificationId(WAKE_ID)));
		expect(JSON.parse(body)).toEqual({
			aps: {
				alert: { title: 'Reminder', body: 'Open Scraps Cache to check your notes.' },
				sound: 'default'
			}
		});
		for (const sent of [path, body, JSON.stringify(headers)]) {
			expect(sent).not.toContain(ACCOUNT);
			expect(sent).not.toContain(WAKE_ID);
		}
	});

	it('drops a phone Apple no longer knows', async () => {
		await configure();
		answers([410, 'Unregistered']);
		await expect(sendApnsWake(wake(), NOW)).resolves.toBe('gone');
		answers([400, 'DeviceTokenNotForTopic']);
		await expect(sendApnsWake(wake(), NOW)).resolves.toBe('gone');
	});

	it('reaches a development build through Apple’s sandbox', async () => {
		await configure();
		const post = answers([400, 'BadDeviceToken'], [200]);
		await expect(sendApnsWake(wake(), NOW)).resolves.toBe('sent');
		expect(post.mock.calls.map(([host]) => host)).toEqual([
			'api.push.apple.com',
			'api.sandbox.push.apple.com'
		]);
	});

	it('drops a token neither of Apple’s services knows', async () => {
		await configure();
		answers([400, 'BadDeviceToken'], [400, 'BadDeviceToken']);
		await expect(sendApnsWake(wake(), NOW)).resolves.toBe('gone');
	});

	it('tries again later when Apple refuses the send for another reason', async () => {
		await configure();
		for (const answer of [
			[403, 'ExpiredProviderToken'],
			[429, 'TooManyRequests'],
			[503],
			[400]
		] as Array<[number, string?]>) {
			answers(answer);
			await expect(sendApnsWake(wake(), NOW)).resolves.toBe('failed');
		}
	});

	it('tries again later when Apple cannot be reached', async () => {
		await configure();
		apple.post.mockReset();
		apple.post.mockRejectedValue(new TypeError('network'));
		await expect(sendApnsWake(wake(), NOW)).resolves.toBe('failed');
	});

	it('keeps its phones while the key is missing, and sends nothing', async () => {
		const post = answers([200]);
		await expect(sendApnsWake(wake(), NOW)).resolves.toBe('failed');
		expect(post).not.toHaveBeenCalled();
	});

	it('drops an app the key may not send to, and a malformed address', async () => {
		await configure();
		const post = answers([200]);
		const other = apnsAddress({ token: TOKEN, topic: 'com.example.other' }, ACCOUNT);
		await expect(sendApnsWake(wake(other), NOW)).resolves.toBe('gone');
		await expect(sendApnsWake(wake('apns://nonsense'), NOW)).resolves.toBe('gone');
		expect(post).not.toHaveBeenCalled();
	});

	it('logs why a send failed without the token, the account or the wake', async () => {
		await configure();
		answers([403, 'InvalidProviderToken']);
		await sendApnsWake(wake(), NOW);
		const logged = vi.mocked(console.info).mock.calls.flat().join('\n');
		expect(logged).toContain('InvalidProviderToken');
		for (const secret of [TOKEN, ACCOUNT, WAKE_ID]) expect(logged).not.toContain(secret);
	});
});
