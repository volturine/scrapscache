import { afterEach, describe, expect, it, vi } from 'vitest';
import { openReminderEvents, notifyReminderEvents } from './reminderEvents';
import { syncEventEmitter } from './syncEvents';
import { exchangeReminderHistory } from './reminderHistoryRelay';
import { testDb, cleanupTestDbs } from './testDb';
import { SyncStore } from './syncStore';

afterEach(() => {
	cleanupTestDbs();
	vi.useRealTimers();
	syncEventEmitter.clear();
});
const text = (value?: Uint8Array) => new TextDecoder().decode(value);
describe('reminder-only server events', () => {
	it('signals receipt writes only to their account and never to note sync', async () => {
		const db = testDb();
		await new SyncStore(db).createAccount('account-a', 'credential');
		const a = (await openReminderEvents('account-a')).body!.getReader();
		const b = (await openReminderEvents('account-b')).body!.getReader();
		await a.read();
		await b.read();
		const notes = vi.fn();
		const stopNotes = syncEventEmitter.subscribe('account-a', notes);
		const next = a.read();
		let otherSignalled = false;
		const other = b.read().then((result) => {
			otherSignalled = !result.done;
		});
		try {
			await exchangeReminderHistory(
				'account-a',
				0,
				[{ note: 'b'.repeat(64), deleted: false, ciphertext: 'c'.repeat(100) }],
				db
			);
			expect(text((await next).value)).toBe('data: {}\n\n');
			expect(notes).not.toHaveBeenCalled();
			expect(otherSignalled).toBe(false);
			let fetchedAgain = false;
			const idle = a.read().then((result) => {
				fetchedAgain = !result.done;
			});
			await exchangeReminderHistory('account-a', 0, [], db);
			await a.cancel();
			await idle;
			expect(fetchedAgain).toBe(false);
		} finally {
			await a.cancel();
			await b.cancel();
			await other;
			stopNotes();
		}
	});
	it('leaves the uploading window out, and keeps a slow reader connected through bursts', async () => {
		const sender = (await openReminderEvents('burst', undefined, 'sender')).body!.getReader();
		const other = (await openReminderEvents('burst', undefined, 'other')).body!.getReader();
		await sender.read();
		await other.read();
		try {
			for (let index = 0; index < 5; index += 1) await notifyReminderEvents('burst', 'sender');
			const first = await other.read();
			expect(text(first.value)).toBe('data: {}\n\n');
			// The burst coalesced into one message and the stream stayed open.
			const next = other.read();
			await notifyReminderEvents('burst', 'sender');
			expect(text((await next).value)).toBe('data: {}\n\n');
			let senderSignalled = false;
			const own = sender.read().then((result) => {
				senderSignalled = !result.done;
			});
			await sender.cancel();
			await own;
			expect(senderSignalled).toBe(false);
		} finally {
			await sender.cancel();
			await other.cancel();
		}
	});
	it('sends only heartbeats while idle, and closes aborted streams', async () => {
		vi.useFakeTimers();
		const abort = new AbortController();
		const reader = (await openReminderEvents('heartbeat', abort.signal)).body!.getReader();
		expect(text((await reader.read()).value)).toBe(': connected\n\n');
		const heartbeat = reader.read();
		await vi.advanceTimersByTimeAsync(25_000);
		expect(text((await heartbeat).value)).toBe(': ping\n\n');
		abort.abort();
		expect((await reader.read()).done).toBe(true);
		await notifyReminderEvents('heartbeat');
		expect(vi.getTimerCount()).toBe(0);
	});
	it('bounds stalled streams and releases the connection limit after cancellation', async () => {
		const streams = await Promise.all(
			Array.from({ length: 64 }, () => openReminderEvents('limited'))
		);
		try {
			expect((await openReminderEvents('limited')).status).toBe(429);
			await streams[0].body!.cancel();
			const replacement = await openReminderEvents('limited');
			expect(replacement.status).toBe(200);
			await replacement.body!.cancel();
		} finally {
			await Promise.all(streams.map((response) => response.body!.cancel()));
		}
	});
});
