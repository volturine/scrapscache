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

/** The synced workspaces on this phone, each with the account its relay knows it by. */
function syncedAccounts(): Map<string, ReturnType<typeof identityFromSyncKey>> {
	return new Map(
		syncStore.profiles
			.filter((profile) => profile.syncKey)
			.map((profile) => [profile.id, identityFromSyncKey(profile.syncKey as string)])
	);
}

/** An unlinked workspace's relay forgot this phone: linked again, it is told afresh. */
function forgetUnlinked(accounts: ReturnType<typeof syncedAccounts>): void {
	const current = new Set([...accounts.values()].map((account) => account.accountId));
	for (const accountId of told.keys()) if (!current.has(accountId)) told.delete(accountId);
}

async function tell(upcoming: UpcomingReminder[]): Promise<void> {
	const before = syncedAccounts();
	forgetUnlinked(before);
	if (!before.size || relayCannotSend) return;
	const [value, info] = await Promise.all([pushToken(), App.getInfo()]);
	if (!value) return;
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
			const deviceId = reminderDeviceId(account.accountId);
			const send = (method: 'POST' | 'DELETE', body: object) =>
				syncStore
					.authorizedFetch(
						'/api/sync/push/wakes',
						{
							method,
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(body)
						},
						account
					)
					.catch(() => null);
			const response = await send('POST', {
				deviceId,
				apns: { token: value, topic: info.id },
				held: ids
			});
			// 501 from a relay without the key; 400 from one too old to know phones.
			if (response?.status === 501 || response?.status === 400) relayCannotSend = true;
			if (!response?.ok) return;
			// Unlinked while the registration was on its way: it may have landed after
			// the unlink's own removal, so the phone is taken off the account again.
			if (syncedAccounts().get(workspaceId)?.accountId !== account.accountId) {
				await send('DELETE', { deviceId });
				return;
			}
			told.set(account.accountId, signature);
		})
	);
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
