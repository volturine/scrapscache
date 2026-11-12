// Reminder push for the iPhone app. The app fires every reminder it holds by
// itself (see localNotifications); the relay's push covers the ones it has not
// synced yet, set or moved on another device while the app was closed. iOS gives
// the app one push token, so it is registered under each synced workspace's
// account, along with the wakes the phone shows itself: the relay sends the rest.
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { reminderDeviceId } from '#lib/reminderWake.js';
import type { UpcomingReminder } from '#lib/stores/reminders.svelte.js';
import { serverOrigin } from '#lib/serverOrigin.svelte.js';
import { syncStore } from '#lib/stores/sync.svelte.js';
import { identityFromSyncKey } from '#lib/syncPairing.js';
import { PENDING_LIMIT } from './localNotifications.js';

/** How long iOS gets to answer a token request before this round goes without one. */
const TOKEN_WAIT_MS = 30_000;

let token: string | null = null;
let listening: Promise<unknown> | null = null;
let answer: ((value: string | null) => void) | null = null;

/** The app's push token from iOS; null when iOS gives none in time, and it is asked again next time. */
async function pushToken(): Promise<string | null> {
	if (token) return token;
	// iOS answers through one of these two, and again if it ever renews the token.
	listening ??= Promise.all([
		PushNotifications.addListener('registration', (registered) => {
			token = registered.value;
			answer?.(token);
		}),
		PushNotifications.addListener('registrationError', () => answer?.(null))
	]);
	await listening;
	return new Promise<string | null>((resolve) => {
		answer = resolve;
		// iOS can leave the request unanswered (no route to Apple's push service).
		setTimeout(() => resolve(null), TOKEN_WAIT_MS);
		PushNotifications.register().catch(() => resolve(null));
	});
}

/** What each account's relay was last told, so an unchanged schedule sends nothing. */
const told = new Map<string, string>();
/** Relays that send to no phone (a self-hosted one has no Apple key): there the app keeps to its own notifications. */
const cannotSend = new Set<string>();

const WAKES_PATH = '/api/sync/push/wakes';
const JSON_BODY = { 'Content-Type': 'application/json' };

/** The synced workspaces on this phone, each with the account its relay knows it by. */
function syncedAccounts(): Map<string, ReturnType<typeof identityFromSyncKey>> {
	return new Map(
		syncStore.profiles
			.filter((profile) => profile.syncKey)
			.map((profile) => [profile.id, identityFromSyncKey(profile.syncKey as string)])
	);
}

function accountIds(accounts: ReturnType<typeof syncedAccounts>): Set<string> {
	return new Set([...accounts.values()].map((account) => account.accountId));
}

/** An unlinked workspace's relay forgot this phone: linked again, it is told afresh. */
function forgetUnlinked(accounts: ReturnType<typeof syncedAccounts>): void {
	const current = accountIds(accounts);
	for (const accountId of told.keys()) if (!current.has(accountId)) told.delete(accountId);
}

const KNOWN_KEY = 'scrapscache-push-registrations';

/** An account a relay may know this phone under, and the server that relay is. */
type Registration = { server: string; accountId: string };

const same = (a: Registration, b: Registration) =>
	a.server === b.server && a.accountId === b.accountId;

let known: Registration[] | null = null;

/**
 * Where this phone may be registered. Kept across launches and written before
 * the phone registers: whatever is here that the phone no longer syncs to is a
 * registration to take back.
 */
function registrations(): Registration[] {
	if (known) return known;
	known = [];
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(KNOWN_KEY) ?? '[]');
		if (Array.isArray(stored)) {
			known = stored.filter(
				(entry): entry is Registration =>
					typeof entry?.server === 'string' && typeof entry?.accountId === 'string'
			);
		}
	} catch {
		// Unreadable: nothing is known, and Apple reports the token gone in the end.
	}
	return known;
}

/** Keep the list, and say whether it will still be there after a relaunch. */
function keepRegistrations(next: Registration[]): boolean {
	known = next;
	try {
		localStorage.setItem(KNOWN_KEY, JSON.stringify(next));
		return true;
	} catch {
		return false;
	}
}

/** The registrations on a server the app has left, or for an account no workspace here syncs to now. */
function registrationsLeft(): Registration[] {
	const server = serverOrigin();
	const synced = accountIds(syncedAccounts());
	return registrations().filter((entry) => entry.server !== server || !synced.has(entry.accountId));
}

/**
 * Take back the registrations the phone has left. iOS gives the app one push
 * token for all its workspaces and keeps it good after one of them is unlinked,
 * so the relay would go on pushing that workspace's reminders here. Unlinking
 * tells the relay once, and may fail to reach it; by then the workspace's key is
 * gone, so the phone asks by its token instead, again each time until the relay
 * answers.
 */
async function leave(value: string, topic: string): Promise<void> {
	await Promise.all(
		registrationsLeft().map(async (left) => {
			// Whatever the relay last heard is void: linked again, the account is told afresh.
			if (left.server === serverOrigin()) told.delete(left.accountId);
			const response = await fetch(`${left.server}${WAKES_PATH}`, {
				method: 'DELETE',
				headers: JSON_BODY,
				body: JSON.stringify({ accountId: left.accountId, apns: { token: value, topic } })
			}).catch(() => null);
			// Unreachable, busy or in trouble: asked again next time.
			if (!response || response.status === 429 || response.status >= 500) return;
			// Linked again while this was on its way: the next round registers it.
			if (!registrationsLeft().some((entry) => same(entry, left))) return;
			keepRegistrations(registrations().filter((entry) => !same(entry, left)));
		})
	);
}

/** Register the phone under each synced workspace's account, with the wakes it holds there. */
async function register(
	value: string,
	topic: string,
	server: string,
	upcoming: UpcomingReminder[]
): Promise<void> {
	// Read after the wait for iOS: a workspace unlinked meanwhile is not registered.
	const accounts = syncedAccounts();
	forgetUnlinked(accounts);
	const held = new Map<string, string[]>();
	for (const item of upcoming.slice(0, PENDING_LIMIT)) {
		held.set(item.workspaceId, [...(held.get(item.workspaceId) ?? []), item.wakeId]);
	}
	await Promise.all(
		[...accounts].map(async ([workspaceId, account]) => {
			const ids = (held.get(workspaceId) ?? []).sort();
			const signature = `${server}\0${value}\0${ids.join(',')}`;
			if (told.get(account.accountId) === signature) return;
			const here = { server, accountId: account.accountId };
			// A phone that cannot remember where it registered could never take it
			// back: it registers nowhere, and keeps to its own notifications.
			if (
				!registrations().some((entry) => same(entry, here)) &&
				!keepRegistrations([...registrations(), here])
			) {
				keepRegistrations(registrations().filter((entry) => !same(entry, here)));
				return;
			}
			const response = await syncStore
				.authorizedFetch(
					WAKES_PATH,
					{
						method: 'POST',
						headers: JSON_BODY,
						body: JSON.stringify({
							deviceId: reminderDeviceId(account.accountId),
							apns: { token: value, topic },
							held: ids
						})
					},
					account
				)
				.catch(() => null);
			// 501 from a relay without the key; 400 from one too old to know phones.
			if (response?.status === 501 || response?.status === 400) cannotSend.add(server);
			// Unlinked while the registration was on its way: `leave` takes it off again.
			if (!response?.ok || !accountIds(syncedAccounts()).has(account.accountId)) return;
			told.set(account.accountId, signature);
		})
	);
}

/** One round: `upcoming` is null when the phone may show no notifications, and so registers nowhere. */
async function tell(upcoming: UpcomingReminder[] | null): Promise<void> {
	const server = serverOrigin();
	const synced = syncedAccounts();
	forgetUnlinked(synced);
	const registers =
		upcoming !== null && server !== null && synced.size > 0 && !cannotSend.has(server);
	if (!registers && !registrationsLeft().length) return;
	const [value, info] = await Promise.all([pushToken(), App.getInfo()]);
	if (!value) return;
	if (registers) await register(value, info.id, server, upcoming);
	// After the registrations, so one that crossed an unlink is taken back.
	await leave(value, info.id);
}

let flight: Promise<void> | null = null;
let waiting: { upcoming: UpcomingReminder[] | null } | null = null;

/**
 * Register this phone for push under every synced workspace, and tell the relay
 * which reminders the system now holds. Call it once they are scheduled, or with
 * null while notifications are not allowed: the phone then registers nowhere,
 * but still takes itself off what it has left. A call during another waits its
 * turn, and only the latest schedule is sent.
 */
export function registerRemotePush(upcoming: UpcomingReminder[] | null): Promise<void> {
	waiting = { upcoming };
	flight ??= (async () => {
		while (waiting) {
			const next = waiting;
			waiting = null;
			await tell(next.upcoming).catch(() => undefined);
		}
	})().finally(() => {
		flight = null;
	});
	return flight;
}

/**
 * A push that arrives while the app is open shows nothing (see capacitor.config):
 * the app looks up what came due instead and shows it itself.
 */
export function onRemotePush(handler: () => void): Promise<PluginListenerHandle> {
	return PushNotifications.addListener('pushNotificationReceived', handler);
}
