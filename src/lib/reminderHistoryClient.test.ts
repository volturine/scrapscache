import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReminderHistoryStore } from '$lib/stores/reminderHistory';
import { ReminderHistoryClient } from '$lib/reminderHistoryClient';
import { createSyncIdentity, identityFromSyncKey } from '$lib/syncPairing';
import { syncStore } from '$lib/stores/sync.svelte';
import { getSyncOutboxKeys, getSyncState, setSyncState } from '$lib/db/idb';
import { readReminderHistory, RECEIPTS_PER_NOTE } from '$lib/reminderHistory';
import { sealNoteReceipts, openNoteReceipts, type ReminderPacket } from '$lib/reminderChannel';
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
		const request = JSON.parse(body) as { cursor: number; notes: ReminderPacket[] };
		return Response.json(
			await exchangeReminderHistory(account.accountId, request.cursor, request.notes, db)
		);
	});
	const a = new ReminderHistoryStore(),
		b = new ReminderHistoryStore();
	await a.hydrate('active-other');
	await b.hydrate(profiles[1].id);
	const clientA = new ReminderHistoryClient(
		a,
		() => profiles,
		() => profiles[0].id,
		send
	);
	const clientB = new ReminderHistoryClient(
		b,
		() => profiles,
		() => profiles[1].id,
		send
	);
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
		const rows = (await db.relay.execute('SELECT * FROM reminder_receipts')).rows;
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
		await clientB.exchange(profiles[1].id);
		expect(b.get(fired.id)?.dismissedAt).toBe(3000);

		const later = { id: 'v'.repeat(43), noteId: fired.noteId, firedAt: 5000 };
		a.recordFired(profiles[0].id, [later]);
		await a.waitForPendingWrites();
		send.mockRejectedValueOnce(new Error('offline'));
		await expect(clientA.exchange(profiles[0].id)).rejects.toThrow('offline');
		const outbox = await a.prepare(profiles[0].id, account.accountId);
		expect(outbox.notes).toEqual([
			{
				kind: 'handled',
				noteId: fired.noteId,
				entries: [later, { ...fired, dismissedAt: 3000 }]
			}
		]);
		await clientA.exchange(profiles[0].id);
		await clientB.exchange(profiles[1].id);
		expect(b.get(later.id)).toEqual(later);
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
		const stale = await sealNoteReceipts(account.syncKey, {
			kind: 'handled',
			noteId: fired.noteId,
			entries: [fired]
		});
		await exchangeReminderHistory(account.accountId, 0, [stale], db);
		await clientB.exchange(profiles[1].id);
		expect(await readReminderHistory(profiles[1].id)).toEqual([]);
		expect((await db.relay.execute('SELECT deleted FROM reminder_receipts')).rows).toEqual([
			expect.objectContaining({ deleted: 1 })
		]);
	});
	it('binds every row to its account, note tag and deletion flag', async () => {
		const { account } = await setup();
		const packet = await sealNoteReceipts(account.syncKey, {
			kind: 'handled',
			noteId: fired.noteId,
			entries: [fired]
		});
		await expect(
			openNoteReceipts(account.syncKey, { ...packet, note: '0'.repeat(64) })
		).rejects.toThrow();
		await expect(openNoteReceipts(account.syncKey, { ...packet, deleted: true })).rejects.toThrow();
		await expect(openNoteReceipts(createSyncIdentity().syncKey, packet)).rejects.toThrow();
		const other = await sealNoteReceipts(account.syncKey, {
			kind: 'handled',
			noteId: 'another-note',
			entries: [fired]
		});
		await expect(openNoteReceipts(account.syncKey, other)).rejects.toThrow();
	});
	it('rebuilds receipts after a relay reset without resetting note state', async () => {
		const { a, clientA, profiles, db } = await setup();
		a.recordDismissed(profiles[0].id, fired, 4000);
		await a.waitForPendingWrites();
		await clientA.exchange(profiles[0].id);
		await db.relay.execute('DELETE FROM reminder_receipts');
		await clientA.exchange(profiles[0].id);
		expect((await db.relay.execute('SELECT note FROM reminder_receipts')).rows).toHaveLength(1);
		expect(await getSyncOutboxKeys(profiles[0].id)).toEqual([]);
	});
	it('learns a second device dismissal from SSE without manually fetching or invoking note sync', async () => {
		const { a, b, profiles, send, account } = await setup();
		const requestNotes = vi.spyOn(syncStore, 'requestAutoSync').mockImplementation(() => undefined);
		const open = (_profile: unknown, clientId: string, signal?: AbortSignal) =>
			openReminderEvents(account.accountId, signal, clientId);
		const clientA = new ReminderHistoryClient(
			a,
			() => [profiles[0]],
			() => profiles[0].id,
			send,
			open
		);
		const clientB = new ReminderHistoryClient(
			b,
			() => [profiles[1]],
			() => profiles[1].id,
			send,
			open
		);
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
			const request = JSON.parse(body) as { cursor: number; notes: ReminderPacket[] };
			calls++;
			if (calls === 1) await held;
			return Response.json(
				await exchangeReminderHistory(identity.accountId, request.cursor, request.notes, db)
			);
		};
		const client = new ReminderHistoryClient(
			a,
			() => profiles,
			() => '',
			send
		);
		a.recordDismissed(profiles[0].id, fired, 7000);
		await a.waitForPendingWrites();
		const old = client.exchange(profiles[0].id);
		await vi.waitFor(() => expect(calls).toBe(1));
		profiles[0].syncKey = replacement.syncKey;
		const next = client.exchange(profiles[0].id);
		release();
		await Promise.all([old, next]);
		expect(calls).toBe(2);
		expect((await a.prepare(profiles[0].id, replacement.accountId)).notes).toEqual([]);
		expect((await exchangeReminderHistory(replacement.accountId, 0, [], db)).notes).toHaveLength(1);
		expect((await exchangeReminderHistory(account.accountId, 0, [], db)).notes).toHaveLength(1);
	});
	it('keeps one relay row and a few local receipts per note, however often it fires', async () => {
		const { a, clientA, profiles, db } = await setup();
		for (let index = 0; index < 10; index += 1) {
			a.recordFired(profiles[0].id, [
				{ id: `${index}`.padEnd(43, 'w'), noteId: fired.noteId, firedAt: 1000 + index }
			]);
		}
		await a.waitForPendingWrites();
		await clientA.exchange(profiles[0].id);
		expect((await db.relay.execute('SELECT note FROM reminder_receipts')).rows).toHaveLength(1);
		const kept = await readReminderHistory(profiles[0].id);
		expect(kept).toHaveLength(RECEIPTS_PER_NOTE);
		expect(Math.min(...kept.map((entry) => entry.firedAt))).toBe(1000 + 10 - RECEIPTS_PER_NOTE);
	});
	it('marks on the relay only deleted notes that had receipts', async () => {
		const { a, clientA, profiles, db, account } = await setup();
		a.recordFired(profiles[0].id, [fired]);
		await a.waitForPendingWrites();
		await clientA.exchange(profiles[0].id);
		// A first run after upgrade meets every note this workspace ever deleted.
		const tombstones = Object.fromEntries(
			Array.from({ length: 200 }, (_, index) => [`old-note-${index}`, 1])
		);
		a.forgetNotes(profiles[0].id, { ...tombstones, [fired.noteId]: 2 });
		await a.waitForPendingWrites();
		await clientA.exchange(profiles[0].id);
		expect((await db.relay.execute('SELECT deleted FROM reminder_receipts')).rows).toEqual([
			expect.objectContaining({ deleted: 1 })
		]);
		expect((await a.prepare(profiles[0].id, account.accountId)).notes).toEqual([]);
	});
	it('answers a receipt row for a note deleted here with its deletion', async () => {
		const { a, b, clientA, clientB, profiles, db } = await setup();
		// B deletes the note before it ever heard of A's receipt.
		b.forgetNotes(profiles[1].id, { [fired.noteId]: 1 });
		await b.waitForPendingWrites();
		a.recordFired(profiles[0].id, [fired]);
		await a.waitForPendingWrites();
		await clientA.exchange(profiles[0].id);
		await clientB.exchange(profiles[1].id);
		expect((await db.relay.execute('SELECT deleted FROM reminder_receipts')).rows).toEqual([
			expect.objectContaining({ deleted: 1 })
		]);
		await clientA.exchange(profiles[0].id);
		expect(await readReminderHistory(profiles[0].id)).toEqual([]);
	});
	it('does not let an upload replace a row its device has not seen', async () => {
		const { a, b, clientA, clientB, profiles, db, account } = await setup();
		b.recordFired(profiles[1].id, [fired]);
		await b.waitForPendingWrites();
		a.recordDismissed(profiles[0].id, fired, 2000);
		await a.waitForPendingWrites();
		await clientA.exchange(profiles[0].id);
		// B uploads before it has downloaded A's row: the relay keeps A's row and
		// hands it to B, which merges it and uploads what it adds.
		await clientB.exchange(profiles[1].id);
		expect(b.get(fired.id)).toEqual({ ...fired, dismissedAt: 2000 });
		await clientA.exchange(profiles[0].id);
		expect(await readReminderHistory(profiles[0].id)).toEqual([{ ...fired, dismissedAt: 2000 }]);
		const [row] = (await exchangeReminderHistory(account.accountId, 0, [], db)).notes;
		expect(await openNoteReceipts(account.syncKey, row)).toEqual({
			kind: 'handled',
			noteId: fired.noteId,
			entries: [{ ...fired, dismissedAt: 2000 }]
		});
	});
	it('converges every device and the relay, whatever order they exchange in', async () => {
		let seed = 7;
		const random = () => {
			seed = (seed * 48271) % 2147483647;
			return seed / 2147483647;
		};
		for (let round = 0; round < 20; round += 1) {
			const account = createSyncIdentity();
			const db = testDb();
			await new SyncStore(db).createAccount(account.accountId, 'credential');
			const profiles = [0, 1, 2].map((index) => ({
				id: `converge-${round}-${index}`,
				syncKey: account.syncKey
			}));
			const sends = { count: 0 };
			const send = async (_profile: unknown, body: string) => {
				sends.count += 1;
				const request = JSON.parse(body) as { cursor: number; notes: ReminderPacket[] };
				return Response.json(
					await exchangeReminderHistory(account.accountId, request.cursor, request.notes, db)
				);
			};
			const devices = profiles.map((profile) => {
				const store = new ReminderHistoryStore();
				return {
					profile,
					store,
					client: new ReminderHistoryClient(
						store,
						() => profiles,
						() => '',
						send
					)
				};
			});
			for (let step = 0; step < 24; step += 1) {
				const device = devices[Math.floor(random() * devices.length)];
				const wake = Math.floor(random() * 7);
				const id = `${wake}`.padEnd(43, 'w');
				// Every device records a wake's due time; dismissals differ per device.
				const entry = { id, noteId: 'shared-note', firedAt: 1000 + wake * 100 };
				if (random() < 0.5) device.store.recordFired(device.profile.id, [entry]);
				else
					device.store.recordDismissed(
						device.profile.id,
						entry,
						2000 + Math.floor(random() * 50) * 10
					);
				await device.store.waitForPendingWrites();
				if (random() < 0.4) await device.client.exchange(device.profile.id);
			}
			// Quiesce: each pass exchanges every device; a converged system needs no uploads.
			let passes = 0;
			for (; passes < 6; passes += 1) {
				const before = sends.count;
				const uploads = await Promise.all(
					devices.map(
						async ({ store, profile }) =>
							(await store.prepare(profile.id, account.accountId)).notes.length
					)
				);
				for (const { client, profile } of devices) await client.exchange(profile.id);
				if (uploads.every((count) => count === 0) && sends.count - before === devices.length) break;
			}
			expect(passes).toBeLessThan(6);
			const histories = await Promise.all(
				devices.map(({ profile }) => readReminderHistory(profile.id))
			);
			expect(histories[1]).toEqual(histories[0]);
			expect(histories[2]).toEqual(histories[0]);
			const [row] = (await exchangeReminderHistory(account.accountId, 0, [], db)).notes;
			const opened = await openNoteReceipts(account.syncKey, row);
			expect(opened).toMatchObject({ entries: expect.any(Array) });
			if (opened.kind === 'handled')
				expect([...opened.entries].sort((l, r) => l.id.localeCompare(r.id))).toEqual(histories[0]);
		}
	});
});
