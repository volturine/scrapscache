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
/** The relay sends to no phone (a self-hosted one has no Apple key): the app keeps to its own notifications. */
let relayCannotSend = false;

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

const KNOWN_KEY = 'scrapscache-push-accounts';

/**
 * The accounts a relay may know this phone under, each with the server it is on.
 * Kept across launches and written before the phone registers: whatever is here
 * with no workspace syncing to it any more is an account to take the phone off.
 */
function knownAccounts(): Map<string, string> {
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(KNOWN_KEY) ?? '{}');
		if (!stored || typeof stored !== 'object') return new Map();
		return new Map(
			Object.entries(stored).filter(
				(entry): entry is [string, string] => typeof entry[1] === 'string'
			)
		);
	} catch {
		return new Map();
	}
}

function keepKnownAccounts(change: (known: Map<string, string>) => void): void {
	const known = knownAccounts();
	change(known);
	try {
		localStorage.setItem(KNOWN_KEY, JSON.stringify(Object.fromEntries(known)));
	} catch {
		// Not kept: the phone stays on the account until Apple reports its token gone.
	}
}

/** The known accounts no workspace here syncs to now. */
function accountsLeft(): Array<[accountId: string, server: string]> {
	const synced = accountIds(syncedAccounts());
	return [...knownAccounts()].filter(([accountId]) => !synced.has(accountId));
}

/**
 * Take the phone off the accounts it has left. iOS gives the app one push token
 * for all its workspaces and keeps it good after one of them is unlinked, so the
 * relay would go on pushing that workspace's reminders here. Unlinking tells the
 * relay once, and may fail to reach it; by then the workspace's key is gone, so
 * the phone asks by its token instead, again each time until the relay answers.
 */
async function leave(value: string, topic: string): Promise<void> {
	await Promise.all(
		accountsLeft().map(async ([accountId, server]) => {
			const response = await fetch(`${server}${WAKES_PATH}`, {
				method: 'DELETE',
				headers: JSON_BODY,
				body: JSON.stringify({ accountId, apns: { token: value, topic } })
			}).catch(() => null);
			// Unreachable, busy or in trouble: asked again next time.
			if (!response || response.status === 429 || response.status >= 500) return;
			// Linked again while this was on its way: the next round registers it.
			if (accountIds(syncedAccounts()).has(accountId)) return;
			keepKnownAccounts((known) => known.delete(accountId));
		})
	);
}

/** Register the phone under each synced workspace's account, with the wakes it holds there. */
async function register(value: string, topic: string, upcoming: UpcomingReminder[]): Promise<void> {
	const server = serverOrigin();
	if (!server) return;
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
			const signature = `${value}\0${ids.join(',')}`;
			if (told.get(account.accountId) === signature) return;
			keepKnownAccounts((known) => known.set(account.accountId, server));
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
			if (response?.status === 501 || response?.status === 400) relayCannotSend = true;
			// Unlinked while the registration was on its way: `leave` takes it off again.
			if (!response?.ok || !accountIds(syncedAccounts()).has(account.accountId)) return;
			told.set(account.accountId, signature);
		})
	);
}

async function tell(upcoming: UpcomingReminder[]): Promise<void> {
	const synced = syncedAccounts();
	forgetUnlinked(synced);
	const registers = synced.size > 0 && !relayCannotSend;
	if (!registers && !accountsLeft().length) return;
	const [value, info] = await Promise.all([pushToken(), App.getInfo()]);
	if (!value) return;
	if (registers) await register(value, info.id, upcoming);
	// After the registrations, so one that crossed an unlink is taken back.
	await leave(value, info.id);
}

let flight: Promise<void> | null = null;
let waiting: UpcomingReminder[] | null = null;

/**
 * Register this phone for push under every synced workspace, and tell the relay
 * which reminders the system now holds. Call it once they are scheduled; a call
 * during another waits its turn, and only the latest schedule is sent.
 */
export function registerRemotePush(upcoming: UpcomingReminder[]): Promise<void> {
	waiting = upcoming;
	flight ??= (async () => {
		while (waiting) {
			const next = waiting;
			waiting = null;
			await tell(next).catch(() => undefined);
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
