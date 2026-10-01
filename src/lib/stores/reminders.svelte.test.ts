import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wakeMocks = vi.hoisted(() => ({
	publish: vi.fn(),
	register: vi.fn(),
	fetch: vi.fn()
}));

vi.mock('$lib/reminderWake', () => ({
	publishReminderWakes: wakeMocks.publish,
	registerAllReminderDevices: wakeMocks.register,
	fetchReminderWakes: wakeMocks.fetch
}));

import { ReminderStore, type ReminderHost } from './reminders.svelte';
import { ReminderHistoryStore } from './reminderHistory';
import { reminderWakeId } from '$lib/model';
import type { ReminderNote } from '$lib/reminderNotify';
import { readReminderHistory } from '$lib/reminderHistory';
import { deleteSyncState, getFiredReminderKeys, getSyncOutboxKeys } from '$lib/db/idb';
import { TEST_WORKSPACE } from '../../tests/workspace';

const OTHER = 'reminders-other';

function note(partial: Partial<ReminderNote> = {}): ReminderNote {
	return {
		id: 'n1',
		title: 'Groceries',
		body: '',
		reminder: Date.now() - 1,
		archived: false,
		trashed: false,
		...partial
	};
}

/** The app shell, with `others` as the notes of workspaces that are not open. */
function testHost(
	options: { others?: Record<string, ReminderNote[]>; linked?: string[] } = {}
): ReminderHost & {
	opened: [string, string][];
	openedWorkspaces: string[];
	reconcile: ReturnType<typeof vi.fn<(pid: string) => void>>;
	triggerSync: ReturnType<typeof vi.fn<(pid: string) => void>>;
} {
	const others = options.others ?? {};
	const linked = new Set(options.linked ?? []);
	const opened: [string, string][] = [];
	const openedWorkspaces: string[] = [];
	return {
		opened,
		openedWorkspaces,
		workspaces: () =>
			[TEST_WORKSPACE, ...Object.keys(others)].map((id) => ({
				id,
				name: 'Personal',
				syncKey: linked.has(id) ? 'dummy-key' : null
			})),
		loadNotes: async (pid) => others[pid] ?? [],
		reconcile: vi.fn<(pid: string) => void>(),
		triggerSync: vi.fn<(pid: string) => void>(),
		openNote: (pid, noteId) => opened.push([pid, noteId]),
		openWorkspace: (pid) => openedWorkspaces.push(pid)
	};
}

/** Each store gets its own history, as each page load does. */
function newStore() {
	const history = new ReminderHistoryStore();
	return { store: new ReminderStore(history), history };
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
	localStorage.clear();
	wakeMocks.publish.mockReset().mockResolvedValue([]);
	wakeMocks.register.mockReset().mockResolvedValue(false);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('ReminderStore', () => {
	it('raises an in-app alert when system notifications are unavailable', async () => {
		const { store } = newStore();
		await store.activateProfile(TEST_WORKSPACE, [note({ reminder: 100 })]);
		await vi.waitFor(() =>
			expect(store.alerts).toEqual([
				expect.objectContaining({ noteId: 'n1', title: 'Groceries', workspaceId: TEST_WORKSPACE })
			])
		);
	});

	it('keeps local reminder delivery active when relay device registration fails', async () => {
		const showNotification = vi.fn(async () => undefined);
		vi.stubGlobal('Notification', { permission: 'granted' });
		vi.stubGlobal('navigator', {
			serviceWorker: { ready: Promise.resolve({ showNotification }) }
		});
		const due = note({ id: 'registration-failed', reminder: Date.now() - 1 });
		const wakeId = reminderWakeId(due.id, due.reminder as number);
		wakeMocks.publish.mockResolvedValue([{ id: wakeId, fireAt: due.reminder }]);
		wakeMocks.register.mockResolvedValue(false);
		const { store } = newStore();
		await store.activateProfile(TEST_WORKSPACE, []);

		store.publish([due]);

		await vi.waitFor(() => expect(showNotification).toHaveBeenCalledOnce());
		expect(wakeMocks.publish).toHaveBeenCalledWith([due]);
		expect(wakeMocks.register).toHaveBeenCalledOnce();
	});

	it('does not re-alert a reminder the user already dismissed', async () => {
		const { store } = newStore();
		const due = note({ reminder: 100 });
		await store.activateProfile(TEST_WORKSPACE, [due]);
		await vi.waitFor(() => expect(store.alerts).toHaveLength(1));
		store.dismiss(reminderWakeId(due.id, 100));
		store.sync([due]);
		expect(store.alerts).toEqual([]);
	});

	it('does not replay an in-app alert after reload using only local device state', async () => {
		const due = note({ id: 'local-reload-reminder', reminder: 100 });
		const first = newStore().store;
		await first.activateProfile(TEST_WORKSPACE, [due]);
		await vi.waitFor(() => expect(first.alerts).toHaveLength(1));

		await deleteSyncState(TEST_WORKSPACE, 'scrapscache-fired-reminders');
		const reloaded = new ReminderStore(new ReminderHistoryStore());
		await reloaded.activateProfile(TEST_WORKSPACE, [due]);
		await settle();

		expect(reloaded.alerts).toEqual([]);
	});

	it('persists a system notification before displaying it and does not replay it after reload', async () => {
		const deliveredWithFiredKeys: string[][] = [];
		const showNotification = vi.fn(async () => {
			deliveredWithFiredKeys.push(await getFiredReminderKeys(TEST_WORKSPACE));
		});
		vi.stubGlobal('Notification', { permission: 'granted' });
		vi.stubGlobal('navigator', {
			serviceWorker: { ready: Promise.resolve({ showNotification }) }
		});

		const due = note({ id: 'reload-reminder', reminder: 100 });
		const wakeId = reminderWakeId(due.id, due.reminder as number);
		await newStore().store.activateProfile(TEST_WORKSPACE, [due]);
		await vi.waitFor(() => expect(showNotification).toHaveBeenCalledOnce());

		expect(deliveredWithFiredKeys).toEqual([[wakeId]]);

		await newStore().store.activateProfile(TEST_WORKSPACE, [due]);
		await settle();
		expect(showNotification).toHaveBeenCalledOnce();
	});

	it('opens the note in its workspace and clears the alert', async () => {
		const { store } = newStore();
		const host = testHost();
		const stop = store.attach(host);
		const due = note({ reminder: 100 });
		await store.activateProfile(TEST_WORKSPACE, [due]);
		await vi.waitFor(() => expect(store.alerts).toHaveLength(1));
		store.open(reminderWakeId(due.id, 100));
		expect(host.opened).toEqual([[TEST_WORKSPACE, 'n1']]);
		expect(store.alerts).toEqual([]);
		stop();
	});

	it('fires a later reminder after the scheduled time', async () => {
		const now = Date.now();
		const { store } = newStore();
		await store.activateProfile(TEST_WORKSPACE, [note({ reminder: now + 5_000 })]);
		expect(store.alerts).toEqual([]);
		vi.useFakeTimers({ now });
		store.sync([note({ reminder: now + 5_000 })]);
		await vi.advanceTimersByTimeAsync(5_000);
		await vi.waitFor(() => expect(store.alerts[0]?.noteId).toBe('n1'));
		// The fire is also written to the synced history; that write runs on the fake clock.
		await vi.runAllTimersAsync();
	});

	it('claims fired reminders independently for each workspace', async () => {
		const { store } = newStore();
		const internals = store as unknown as {
			claimFired(alert: { workspaceId: string; wakeId: string; noteId: string }): Promise<boolean>;
		};
		await store.activateProfile('reminders-a', []);
		const claim = (workspaceId: string) =>
			internals.claimFired({ workspaceId, wakeId: 'shared-wake', noteId: 'n1' });
		await expect(claim('reminders-a')).resolves.toBe(true);
		expect(await getFiredReminderKeys('reminders-a')).toEqual(['shared-wake']);
		expect(await getFiredReminderKeys('reminders-b')).toEqual([]);

		await store.activateProfile('reminders-b', []);
		await expect(claim('reminders-b')).resolves.toBe(true);
		expect(await getFiredReminderKeys('reminders-b')).toEqual(['shared-wake']);
	});

	describe('every workspace on the device', () => {
		it('alerts a due reminder from a workspace that is not open, and opens it there', async () => {
			const { store } = newStore();
			const elsewhere = note({ id: 'elsewhere', title: 'Dentist', reminder: 100 });
			const host = testHost({ others: { [OTHER]: [elsewhere] } });
			const stop = store.attach(host);
			await store.activateProfile(TEST_WORKSPACE, []);
			await vi.waitFor(() =>
				expect(store.alerts).toEqual([
					expect.objectContaining({ noteId: 'elsewhere', workspaceId: OTHER })
				])
			);

			store.open(reminderWakeId('elsewhere', 100));

			expect(host.opened).toEqual([[OTHER, 'elsewhere']]);
			stop();
		});

		it("records a reminder in its own workspace's history and outbox", async () => {
			const { store } = newStore();
			const elsewhere = note({ id: 'elsewhere', reminder: 100 });
			const wakeId = reminderWakeId('elsewhere', 100);
			const stop = store.attach(testHost({ others: { [OTHER]: [elsewhere] } }));
			await store.activateProfile(TEST_WORKSPACE, []);
			await vi.waitFor(() => expect(store.alerts).toHaveLength(1));

			store.dismiss(wakeId);

			await vi.waitFor(async () =>
				expect(await readReminderHistory(OTHER)).toEqual([
					expect.objectContaining({
						id: wakeId,
						noteId: 'elsewhere',
						dismissedAt: expect.any(Number)
					})
				])
			);
			expect(await getSyncOutboxKeys(OTHER)).toEqual([]);
			expect(await readReminderHistory(TEST_WORKSPACE)).toEqual([]);
			expect(await getFiredReminderKeys(OTHER)).toEqual([wakeId]);
			stop();
		});

		it('asks a synced workspace that is not open about a reminder it missed', async () => {
			const { store } = newStore();
			const missed = note({ id: 'missed', reminder: Date.now() - 10 * 60_000 });
			const host = testHost({ others: { [OTHER]: [missed] }, linked: [OTHER] });
			const stop = store.attach(host);
			await store.activateProfile(TEST_WORKSPACE, []);
			await vi.waitFor(() => expect(host.reconcile).toHaveBeenCalledWith(OTHER));
			expect(store.alerts).toEqual([]);

			store.receiptsSettled(OTHER);

			await vi.waitFor(() =>
				expect(store.alerts).toEqual([expect.objectContaining({ workspaceId: OTHER })])
			);
			stop();
		});
	});

	describe('synced history', () => {
		it('records a reminder it shows and the user dismissing it', async () => {
			const { store, history } = newStore();
			const due = note({ reminder: 100 });
			const wakeId = reminderWakeId(due.id, 100);
			await history.hydrate(TEST_WORKSPACE);
			await store.activateProfile(TEST_WORKSPACE, [due]);
			await vi.waitFor(() => expect(store.alerts).toHaveLength(1));
			await vi.waitFor(() => expect(history.get(wakeId)?.firedAt).toBeGreaterThan(0));

			store.dismiss(wakeId);
			expect(history.get(wakeId)?.dismissedAt).toBeGreaterThan(0);
			expect(history.get(wakeId)?.noteId).toBe(due.id);
		});

		it('does not show a reminder another device already showed', async () => {
			const { store, history } = newStore();
			await history.hydrate(TEST_WORKSPACE);
			const due = note({ reminder: 100 });
			await history.receive(
				TEST_WORKSPACE,
				'',
				[
					{
						kind: 'handled',
						noteId: due.id,
						entries: [{ id: reminderWakeId(due.id, 100), noteId: due.id, firedAt: 150 }]
					}
				],
				[],
				0
			);
			await store.activateProfile(TEST_WORKSPACE, [due]);
			await settle();
			expect(store.alerts).toEqual([]);
		});

		it('takes down an alert another device dismissed', async () => {
			const { store, history } = newStore();
			await history.hydrate(TEST_WORKSPACE);
			const due = note({ reminder: 100 });
			const wakeId = reminderWakeId(due.id, 100);
			await store.activateProfile(TEST_WORKSPACE, [due]);
			await vi.waitFor(() => expect(store.alerts).toHaveLength(1));

			await history.receive(
				TEST_WORKSPACE,
				'',
				[
					{
						kind: 'handled',
						noteId: due.id,
						entries: [{ id: wakeId, noteId: due.id, firedAt: 150, dismissedAt: 200 }]
					}
				],
				[],
				0
			);
			expect(store.alerts).toEqual([]);
			await vi.waitFor(async () =>
				expect(await getFiredReminderKeys(TEST_WORKSPACE)).toContain(wakeId)
			);
		});

		it('holds a reminder missed here until a receipt exchange settles, then shows it if nobody handled it', async () => {
			const { store } = newStore();
			const host = testHost({ linked: [TEST_WORKSPACE] });
			const stop = store.attach(host);
			const missed = note({ reminder: Date.now() - 10 * 60_000 });
			await store.activateProfile(TEST_WORKSPACE, [missed]);
			await settle();
			expect(store.alerts).toEqual([]);
			expect(host.reconcile).toHaveBeenCalledOnce();

			store.sync([missed]);
			expect(host.reconcile).toHaveBeenCalledOnce();

			store.receiptsSettled(TEST_WORKSPACE);
			await vi.waitFor(() => expect(store.alerts).toHaveLength(1));
			stop();
		});

		it('drops a held reminder the receipt channel reports as handled elsewhere', async () => {
			const { store, history } = newStore();
			await history.hydrate(TEST_WORKSPACE);
			const stop = store.attach(testHost({ linked: [TEST_WORKSPACE] }));
			const missed = note({ reminder: Date.now() - 10 * 60_000 });
			await store.activateProfile(TEST_WORKSPACE, [missed]);

			await history.receive(
				TEST_WORKSPACE,
				'',
				[
					{
						kind: 'handled',
						noteId: missed.id,
						entries: [
							{
								id: reminderWakeId(missed.id, missed.reminder!),
								noteId: missed.id,
								firedAt: 1
							}
						]
					}
				],
				[],
				0
			);
			store.receiptsSettled(TEST_WORKSPACE);
			await settle();
			expect(store.alerts).toEqual([]);
			stop();
		});

		it('shows a reminder on time without waiting for the cloud', async () => {
			const { store } = newStore();
			const host = testHost({ linked: [TEST_WORKSPACE] });
			const stop = store.attach(host);
			await store.activateProfile(TEST_WORKSPACE, [note({ reminder: Date.now() - 1 })]);
			await vi.waitFor(() => expect(store.alerts).toHaveLength(1));
			expect(host.reconcile).not.toHaveBeenCalled();
			stop();
		});
	});

	describe('cross-device unsynced reminder wakes', () => {
		const dueTime = () => Date.now() - 1000;

		async function showRemoteWake(store: ReminderStore, wakeId: string, fireAt: number) {
			wakeMocks.fetch.mockResolvedValue({ revision: 1, wakes: [{ id: wakeId, fireAt }] });
			await store.activateProfile(TEST_WORKSPACE, []);
			await store.syncRemoteWakes(TEST_WORKSPACE);
			await vi.waitFor(() => expect(store.alerts).toHaveLength(1));
		}

		it('alerts for a due wake whose note has not synced, and keeps the alert until it does', async () => {
			const { store } = newStore();
			const host = testHost({ linked: [TEST_WORKSPACE] });
			const stop = store.attach(host);
			const fireAt = dueTime();
			const arrived = note({ id: 'remote-note-1', reminder: fireAt });
			const wakeId = reminderWakeId(arrived.id, fireAt);

			await showRemoteWake(store, wakeId, fireAt);
			expect(store.alerts[0]).toMatchObject({ wakeId, noteId: '', title: 'Reminder (Personal)' });
			expect(host.triggerSync).toHaveBeenCalledWith(TEST_WORKSPACE);

			// Other notes arriving first, as a pull usually delivers them, leave the alert alone.
			store.sync([note({ id: 'unrelated', reminder: null })]);
			expect(store.alerts).toHaveLength(1);

			store.sync([arrived]);
			expect(store.alerts[0]).toMatchObject({
				wakeId,
				noteId: 'remote-note-1',
				title: 'Groceries'
			});

			store.open(wakeId);
			expect(host.opened).toContainEqual([TEST_WORKSPACE, 'remote-note-1']);
			stop();
		});

		it('opens the workspace to pull the note when an alert has none yet', async () => {
			const { store } = newStore();
			const host = testHost({ linked: [TEST_WORKSPACE] });
			const stop = store.attach(host);
			const fireAt = dueTime();
			const wakeId = reminderWakeId('unsynced-note', fireAt);
			await showRemoteWake(store, wakeId, fireAt);

			store.open(wakeId);
			expect(host.openedWorkspaces).toEqual([TEST_WORKSPACE]);
			expect(host.opened).toEqual([]);
			expect(store.alerts).toHaveLength(0);
			stop();
		});

		it('drops an alert whose note arrives archived or trashed', async () => {
			const { store } = newStore();
			const stop = store.attach(testHost({ linked: [TEST_WORKSPACE] }));
			const fireAt = dueTime();
			const arrived = note({ id: 'remote-note-1', reminder: fireAt, trashed: true });
			await showRemoteWake(store, reminderWakeId(arrived.id, fireAt), fireAt);

			store.sync([arrived]);
			expect(store.alerts).toHaveLength(0);
			stop();
		});

		it.each([{ archived: true }, { trashed: true }])(
			'ignores a stale relay wake for a note held here as %o',
			async (state) => {
				const { store } = newStore();
				const host = testHost({ linked: [TEST_WORKSPACE] });
				const stop = store.attach(host);
				const fireAt = dueTime();
				const held = note({ id: 'held-note', reminder: fireAt, ...state });
				wakeMocks.fetch.mockResolvedValue({
					revision: 1,
					wakes: [{ id: reminderWakeId(held.id, fireAt), fireAt }]
				});

				await store.activateProfile(TEST_WORKSPACE, [held]);
				await store.syncRemoteWakes(TEST_WORKSPACE);
				await settle();
				expect(store.alerts).toHaveLength(0);
				expect(host.triggerSync).not.toHaveBeenCalled();
				stop();
			}
		);

		it('joins a fetch already in flight', async () => {
			const { store } = newStore();
			const stop = store.attach(testHost({ linked: [TEST_WORKSPACE] }));
			wakeMocks.fetch.mockClear();
			wakeMocks.fetch.mockResolvedValue({ revision: 1, wakes: [] });
			await store.activateProfile(TEST_WORKSPACE, []);
			await Promise.all([
				store.syncRemoteWakes(TEST_WORKSPACE),
				store.syncRemoteWakes(TEST_WORKSPACE)
			]);
			expect(wakeMocks.fetch).toHaveBeenCalledTimes(1);
			stop();
		});
	});
});
