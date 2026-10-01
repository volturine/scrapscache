// Reminder push on this device. Notifications are one app-wide switch (the
// browser's permission), but each synced workspace gets a push subscription of
// its own: a service worker registration under `/push/<workspace id>/`, with its
// own push address and a device id derived for its account. The relay therefore
// cannot tell that two accounts belong to the same browser.
import { sha256 } from '@noble/hashes/sha2.js';
import { relayReminderWakes, type ReminderNote, type ReminderWake } from '$lib/reminderNotify';
export type { ReminderWake };
import { syncStore } from '$lib/stores/sync.svelte';
import type { StoredProfile } from '$lib/profiles';
import { identityFromSyncKey } from '$lib/syncPairing';
import { uid } from '$lib/model';

const DEVICE_SECRET_KEY = 'scrapscache-push-device';
const PUSH_SCOPE_PREFIX = '/push/';
let cachedVapidKey: string | null = null;
/** `accountId\0endpoint` of every account this browser is registered under. */
const registeredDevices = new Set<string>();
const registrationFlights = new Map<string, Promise<boolean>>();
let publishedWakes: { accountId: string; revision: number; signature: string } | null = null;
let publishFlight: { key: string; promise: Promise<ReminderWake[] | null> } | null = null;
const WAKE_ID_RE = /^[A-Za-z0-9_-]{43}$/;

type Workspace = Pick<StoredProfile, 'id' | 'syncKey'>;

export function reminderPushSupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof Notification !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window
	);
}

/** The service worker scope whose push subscription belongs to one workspace. */
export function workspacePushScope(workspaceId: string): string {
	return `${PUSH_SCOPE_PREFIX}${encodeURIComponent(workspaceId)}/`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** A random secret of this browser's; it never leaves the device. */
function deviceSecret(): string {
	if (typeof localStorage === 'undefined') return uid();
	const existing = localStorage.getItem(DEVICE_SECRET_KEY);
	if (existing && existing.length >= 16) return existing;
	const next = uid();
	localStorage.setItem(DEVICE_SECRET_KEY, next);
	return next;
}

/** This browser's id under one account. Ids under two accounts share nothing. */
export function reminderDeviceId(accountId: string): string {
	const digest = sha256(
		new TextEncoder().encode(`scraps-cache-push-device:v1\0${deviceSecret()}\0${accountId}`)
	);
	return bytesToBase64Url(digest).slice(0, 32);
}

function applicationServerKey(publicKey: string): Uint8Array<ArrayBuffer> {
	const padding = '='.repeat((4 - (publicKey.length % 4)) % 4);
	const raw = atob((publicKey + padding).replace(/-/g, '+').replace(/_/g, '/'));
	const bytes = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
	return bytes;
}

function sameKey(left: ArrayBuffer | null, right: Uint8Array<ArrayBuffer>): boolean {
	if (!left) return false;
	const bytes = new Uint8Array(left);
	return bytes.length === right.length && bytes.every((value, index) => value === right[index]);
}

export async function preloadVapidPublicKey(): Promise<string | null> {
	if (cachedVapidKey) return cachedVapidKey;
	try {
		const response = await fetch('/api/sync/push/vapid');
		const vapid = (await response.json()) as { publicKey?: unknown };
		if (!response.ok || typeof vapid.publicKey !== 'string' || !vapid.publicKey) return null;
		cachedVapidKey = vapid.publicKey;
		return cachedVapidKey;
	} catch {
		return null;
	}
}

/** A registration can only subscribe once its service worker is active. */
function whenActive(
	registration: ServiceWorkerRegistration,
	timeoutMs = 8_000
): Promise<ServiceWorkerRegistration | null> {
	if (registration.active) return Promise.resolve(registration);
	const worker = registration.installing ?? registration.waiting;
	if (!worker) return Promise.resolve(null);
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(null), timeoutMs);
		worker.addEventListener('statechange', () => {
			if (worker.state !== 'activated') return;
			clearTimeout(timer);
			resolve(registration);
		});
	});
}

function scopeUrl(workspaceId: string): string {
	return new URL(workspacePushScope(workspaceId), location.origin).href;
}

/** The workspace's own registration, when this browser has one. */
async function findWorkspaceRegistration(
	workspaceId: string
): Promise<ServiceWorkerRegistration | null> {
	const registration = await navigator.serviceWorker
		.getRegistration(scopeUrl(workspaceId))
		.catch(() => undefined);
	// Without its own, the lookup answers with the app's registration instead.
	return registration?.scope === scopeUrl(workspaceId) ? registration : null;
}

async function workspaceRegistration(
	workspaceId: string
): Promise<ServiceWorkerRegistration | null> {
	const registration =
		(await findWorkspaceRegistration(workspaceId)) ??
		(await navigator.serviceWorker
			.register('/sw.js', { scope: workspacePushScope(workspaceId), updateViaCache: 'none' })
			.catch(() => null));
	return registration ? whenActive(registration) : null;
}

/** The workspace's push subscription, made when missing and renewed when the push key changed. */
async function workspaceSubscription(
	workspaceId: string
): Promise<{ endpoint: string; keys: { p256dh: string; auth: string } } | null> {
	if (!reminderPushSupported() || Notification.permission !== 'granted') return null;
	const registration = await workspaceRegistration(workspaceId);
	if (!registration?.pushManager) return null;
	const publicKey = cachedVapidKey ?? (await preloadVapidPublicKey());
	if (!publicKey) return null;
	const expectedKey = applicationServerKey(publicKey);
	let subscription = await registration.pushManager.getSubscription();
	if (subscription && !sameKey(subscription.options.applicationServerKey, expectedKey)) {
		await subscription.unsubscribe().catch(() => false);
		subscription = null;
	}
	try {
		subscription ??= await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: expectedKey
		});
	} catch {
		return null;
	}
	const json = subscription.toJSON();
	if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return null;
	return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

/** Register one synced workspace's subscription on the relay. No-op when already registered. */
export async function registerReminderDevice(workspace: Workspace): Promise<boolean> {
	if (!workspace.syncKey) return false;
	const account = identityFromSyncKey(workspace.syncKey);
	const subscription = await workspaceSubscription(workspace.id);
	if (!subscription) return false;
	const key = `${account.accountId}\0${subscription.endpoint}`;
	if (registeredDevices.has(key)) return true;
	const pending = registrationFlights.get(key);
	if (pending) return pending;
	const promise = (async () => {
		try {
			const response = await syncStore.authorizedFetch(
				'/api/sync/push/wakes',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ deviceId: reminderDeviceId(account.accountId), subscription })
				},
				account
			);
			if (response.ok) registeredDevices.add(key);
			return response.ok;
		} catch {
			return false;
		}
	})();
	registrationFlights.set(key, promise);
	return promise.finally(() => {
		if (registrationFlights.get(key) === promise) registrationFlights.delete(key);
	});
}

/**
 * With notifications on, give every synced workspace on this device its own
 * push subscription, open or not, and drop the ones no workspace here needs any
 * more. True when at least one workspace is registered.
 */
export async function registerAllReminderDevices(): Promise<boolean> {
	if (!reminderPushSupported() || Notification.permission !== 'granted') return false;
	const synced = syncStore.profiles.filter((profile) => profile.syncKey);
	await dropUnusedSubscriptions(new Set(synced.map((profile) => profile.id)));
	const results = await Promise.all(synced.map((profile) => registerReminderDevice(profile)));
	return results.some(Boolean);
}

/**
 * Subscriptions of workspaces this device no longer syncs, and the app's own
 * registration's, which no workspace owns: push goes to workspace registrations.
 */
async function dropUnusedSubscriptions(syncedIds: Set<string>): Promise<void> {
	const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
	const prefix = new URL(PUSH_SCOPE_PREFIX, location.origin).href;
	for (const registration of registrations) {
		if (!registration.scope.startsWith(prefix)) {
			const shared = await registration.pushManager?.getSubscription().catch(() => null);
			await shared?.unsubscribe().catch(() => false);
			continue;
		}
		const id = decodeURIComponent(registration.scope.slice(prefix.length).replace(/\/$/, ''));
		if (syncedIds.has(id)) continue;
		const subscription = await registration.pushManager?.getSubscription().catch(() => null);
		await subscription?.unsubscribe().catch(() => false);
		await registration.unregister().catch(() => false);
	}
}

/** Make the relay wake list match this snapshot. No-op when it already does. */
export async function publishReminderWakes(notes: ReminderNote[]): Promise<ReminderWake[] | null> {
	const account = syncStore.account;
	if (!account) return null;
	const wakes = relayReminderWakes(notes, Date.now());
	const signature = JSON.stringify(wakes);
	const revision = await syncStore.committedRevision();
	if (revision === null) return null;
	if (
		publishedWakes?.accountId === account.accountId &&
		publishedWakes.revision === revision &&
		publishedWakes.signature === signature
	)
		return wakes;
	const key = `${account.accountId}\0${revision}\0${signature}`;
	if (publishFlight?.key === key) return publishFlight.promise;
	const promise = (async () => {
		try {
			const response = await syncStore.authorizedFetch('/api/sync/push/wakes', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					revision,
					wakes
				})
			});
			if (!response.ok) return null;
			publishedWakes = { accountId: account.accountId, revision, signature };
			return wakes;
		} catch {
			return null;
		}
	})();
	publishFlight = { key, promise };
	return promise.finally(() => {
		if (publishFlight?.promise === promise) publishFlight = null;
	});
}

/** Fetch the wakes stored on the relay for one workspace. */
export async function fetchReminderWakes(
	workspace: Workspace
): Promise<{ revision: number | null; wakes: ReminderWake[] } | null> {
	if (!workspace.syncKey) return null;
	const account = identityFromSyncKey(workspace.syncKey);
	try {
		const response = await syncStore.authorizedFetch(
			'/api/sync/push/wakes',
			{ method: 'GET' },
			account
		);
		if (!response.ok) return null;
		const data = (await response.json()) as { revision?: unknown; wakes?: unknown };
		const wakes = Array.isArray(data.wakes)
			? data.wakes.filter(
					(wake): wake is ReminderWake =>
						wake &&
						typeof wake.id === 'string' &&
						WAKE_ID_RE.test(wake.id) &&
						Number.isSafeInteger(wake.fireAt)
				)
			: [];
		return {
			revision: typeof data.revision === 'number' ? data.revision : null,
			wakes
		};
	} catch {
		return null;
	}
}

/**
 * Stop reminder pushes for one workspace on this browser: its subscription and
 * service worker registration go, and the relay forgets this browser under its
 * account. Every other workspace keeps its own.
 */
export async function unregisterReminderDevice(workspace: Workspace): Promise<void> {
	if (reminderPushSupported()) {
		const registration = await findWorkspaceRegistration(workspace.id);
		const subscription = await registration?.pushManager.getSubscription().catch(() => null);
		await subscription?.unsubscribe().catch(() => false);
		await registration?.unregister().catch(() => false);
	}
	if (!workspace.syncKey) return;
	const account = identityFromSyncKey(workspace.syncKey);
	for (const key of registeredDevices) {
		if (key.startsWith(`${account.accountId}\0`)) registeredDevices.delete(key);
	}
	if (publishedWakes?.accountId === account.accountId) publishedWakes = null;
	let response: Response;
	try {
		response = await syncStore.authorizedFetch(
			'/api/sync/push/wakes',
			{
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				keepalive: true,
				body: JSON.stringify({
					deviceId: reminderDeviceId(account.accountId)
				})
			},
			account
		);
	} catch (err) {
		throw new Error('Could not reach the relay to remove this device from reminder push', {
			cause: err
		});
	}
	if (!response.ok) {
		throw new Error(`The relay rejected this device's reminder push removal (${response.status})`);
	}
}
