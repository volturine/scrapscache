import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReminderHistoryStore } from '$lib/stores/reminderHistory';
import { ReminderHistoryClient } from '$lib/reminderHistoryClient';
import { createSyncIdentity, identityFromSyncKey } from '$lib/syncPairing';
import { syncStore } from '$lib/stores/sync.svelte';
import { getSyncOutboxKeys, getSyncState, setSyncState } from '$lib/db/idb';
import { readReminderHistory } from '$lib/reminderHistory';
import {
	REMINDER_CHANNEL_KEY,
	sealReminderEvent,
	openReminderEvent,
	type ReminderPacket
} from '$lib/reminderChannel';
import { openReminderEvents } from '$lib/server/reminderEvents';
import { exchangeReminderHistory } from '$lib/server/reminderHistoryRelay';
import { SyncStore } from '$lib/server/syncStore';
import { testDb, cleanupTestDbs } from '$lib/server/testDb';

afterEach(() => {
	vi.restoreAllMocks();
	cleanupTestDbs();
});
async function setup() {
	const account = createSyncIdentity();
	const db = testDb();
	const relay = new SyncStore(db);
	await relay.createAccount(account.accountId, 'credential');
	const profiles = [
		{ id: 'receipts-a', syncKey: account.syncKey },
		{ id: 'receipts-b', syncKey: account.syncKey }
	];
	const send = vi.fn(async (_profile: unknown, body: string) => {
		const request = JSON.parse(body) as { cursor: number; events: ReminderPacket[] };
		return Response.json(
			await exchangeReminderHistory(account.accountId, request.cursor, request.events, db)
		);
	});
	const a = new ReminderHistoryStore(),
		b = new ReminderHistoryStore();
	await a.hydrate('active-other');
	await b.hydrate(profiles[1].id);
	const clientA = new ReminderHistoryClient(a, () => profiles, send);
	const clientB = new ReminderHistoryClient(b, () => profiles, send);
	return { a, b, clientA, clientB, send, db, account, profiles };
}
const fired = { id: 'w'.repeat(43), noteId: 'private-note-id', firedAt: 1000 };

describe('independent reminder delivery', () => {
	it('delivers an inactive workspace dismissal without touching note sync or its cursor', async () => {
		const { a, b, clientA, clientB, profiles, db } = await setup();
		const sync = vi.spyOn(syncStore, 'requestAutoSync').mockImplementation(() => undefined);
		await setSyncState(profiles[0].id, 'note-sync-cursor', 42);
		a.recordDismissed(profiles[0].id, fired, 2000);
		await a.waitForPendingWrites();
		await clientA.exchange(profiles[0].id);
		await clientB.exchange(profiles[1].id);
		expect(b.get(fired.id)?.dismissedAt).toBe(2000);
		expect(sync).not.toHaveBeenCalled();
		expect(await getSyncOutboxKeys(profiles[0].id)).toEqual([]);
		expect(await getSyncState(profiles[0].id, 'note-sync-cursor')).toBe(42);
		expect((await db.relay.execute('SELECT next_seq FROM accounts')).rows[0].next_seq).toBe(0);
		const rows = (await db.relay.execute('SELECT * FROM reminder_history')).rows;
		expect(JSON.stringify(rows)).not.toContain(fired.noteId);
	});
	it('keeps a dismissal made while its fired receipt is in flight, and retries after failure', async () => {
		const { a, clientA, clientB, b, send, profiles, account } = await setup();
		a.recordFired(profiles[0].id, [fired]);
		await a.waitForPendingWrites();
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const original = send.getMockImplementation()!;
		send.mockImplementationOnce(async (profile, body) => {
			await held;
			return original(profile, body);
		});
		const first = clientA.exchange(profiles[0].id);
		await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
		a.recordDismissed(profiles[0].id, fired, 3000);
		await a.waitForPendingWrites();
		release();
		await first;
		send.mockRejectedValueOnce(new Error('offline'));
		await expect(clientA.exchange(profiles[0].id)).rejects.toThrow('offline');
		const state = await a.prepare(profiles[0].id, account.accountId);
		expect(state.pending).toHaveLength(1);
		await clientA.exchange(profiles[0].id);
		await clientB.exchange(profiles[1].id);
		expect(b.get(fired.id)?.dismissedAt).toBe(3000);
	});
	it('merges concurrent receipts and permanently removes a deleted note history', async () => {
		const { a, b, clientA, clientB, profiles, account, db } = await setup();
		a.recordFired(profiles[0].id, [fired]);
		b.recordDismissed(profiles[1].id, fired, 2500);
		await Promise.all([a.waitForPendingWrites(), b.waitForPendingWrites()]);
		await Promise.all([clientA.exchange(profiles[0].id), clientB.exchange(profiles[1].id)]);
		await clientA.exchange(profiles[0].id);
		expect((await readReminderHistory(profiles[0].id))[0]).toMatchObject({
			firedAt: 1000,
			dismissedAt: 2500
		});
		a.forgetNotes(profiles[0].id, { [fired.noteId]: 1 });
		await a.waitForPendingWrites();
		await clientA.exchange(profiles[0].id);
		const stale = await sealReminderEvent(account.syncKey, { kind: 'handled', value: fired });
		await exchangeReminderHistory(account.accountId, 0, [stale], db);
		await clientB.exchange(profiles[1].id);
		expect(await readReminderHistory(profiles[1].id)).toEqual([]);
		expect((await db.relay.execute('SELECT deleted FROM reminder_history')).rows).toEqual([
			expect.objectContaining({ deleted: 1 })
		]);
	});
	it('binds every receipt to its account, event and note tag', async () => {
		const { account } = await setup();
		const packet = await sealReminderEvent(account.syncKey, { kind: 'handled', value: fired });
		await expect(
			openReminderEvent(account.syncKey, { ...packet, note: '0'.repeat(64) })
		).rejects.toThrow();
		await expect(openReminderEvent(createSyncIdentity().syncKey, packet)).rejects.toThrow();
	});
	it('rebuilds receipts after a relay reset without resetting note state', async () => {
		const { a, clientA, profiles, db } = await setup();
		a.recordDismissed(profiles[0].id, fired, 4000);
		await a.waitForPendingWrites();
		await clientA.exchange(profiles[0].id);
		await db.relay.execute('DELETE FROM reminder_history');
		await clientA.exchange(profiles[0].id);
		expect((await db.relay.execute('SELECT id FROM reminder_history')).rows).toHaveLength(1);
		expect(await getSyncOutboxKeys(profiles[0].id)).toEqual([]);
	});
	it('learns a second device dismissal from SSE without manually fetching or invoking note sync', async () => {
		const { a, b, profiles, send, account } = await setup();
		const requestNotes = vi.spyOn(syncStore, 'requestAutoSync').mockImplementation(() => undefined);
		const open = (_profile: unknown, signal?: AbortSignal) =>
			openReminderEvents(account.accountId, signal);
		const clientA = new ReminderHistoryClient(a, () => [profiles[0]], send, open);
		const clientB = new ReminderHistoryClient(b, () => [profiles[1]], send, open);
		const stopA = clientA.attach(),
			stopB = clientB.attach();
		try {
			await vi.waitFor(() => expect(send.mock.calls.length).toBeGreaterThanOrEqual(2));
			a.recordDismissed(profiles[0].id, fired, 6000);
			await vi.waitFor(() => expect(b.get(fired.id)?.dismissedAt).toBe(6000));
			expect(requestNotes).not.toHaveBeenCalled();
			expect(await getSyncOutboxKeys(profiles[0].id)).toEqual([]);
		} finally {
			stopA();
			stopB();
			await a.waitForPendingWrites();
			await b.waitForPendingWrites();
		}
	});
	it('starts a new identity exchange after an old in-flight request without waiting for another event', async () => {
		const { a, profiles, db, account } = await setup();
		const replacement = createSyncIdentity();
		await new SyncStore(db).createAccount(replacement.accountId, 'replacement-credential');
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let calls = 0;
		const send = async (profile: { syncKey: string }, body: string) => {
			const identity = identityFromSyncKey(profile.syncKey);
			const request = JSON.parse(body) as { cursor: number; events: ReminderPacket[] };
			calls++;
			if (calls === 1) await held;
			return Response.json(
				await exchangeReminderHistory(identity.accountId, request.cursor, request.events, db)
			);
		};
		const client = new ReminderHistoryClient(a, () => profiles, send);
		a.recordDismissed(profiles[0].id, fired, 7000);
		await a.waitForPendingWrites();
		const old = client.exchange(profiles[0].id);
		await vi.waitFor(() => expect(calls).toBe(1));
		profiles[0].syncKey = replacement.syncKey;
		const next = client.exchange(profiles[0].id);
		release();
		await Promise.all([old, next]);
		expect(calls).toBe(2);
		expect((await a.prepare(profiles[0].id, replacement.accountId)).pending).toEqual([]);
		expect((await exchangeReminderHistory(replacement.accountId, 0, [], db)).events).toHaveLength(
			1
		);
		expect((await exchangeReminderHistory(account.accountId, 0, [], db)).events).toHaveLength(1);
	});
});
