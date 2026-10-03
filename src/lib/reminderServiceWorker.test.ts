import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { indexedDB } from 'fake-indexeddb';
import { reminderWakeId } from '#lib/model/index.js';
import { DEVICE_DB_NAME, resolveDbName } from '#lib/db/idb.js';

function request<T>(operation: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		operation.onsuccess = () => resolve(operation.result);
		operation.onerror = () => reject(operation.error);
	});
}

async function done(tx: IDBTransaction): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/** The device list the app keeps: one `{ id, tag }` row per workspace. */
async function seedRegistry(workspaces: { id: string; tag: string }[]): Promise<void> {
	const opened = indexedDB.open(DEVICE_DB_NAME, 1);
	opened.onupgradeneeded = () => {
		opened.result.createObjectStore('workspaces', { keyPath: 'id' });
		opened.result.createObjectStore('link-previews', { keyPath: 'url' });
	};
	const db = await request(opened);
	const tx = db.transaction('workspaces', 'readwrite');
	for (const workspace of workspaces) tx.objectStore('workspaces').put(workspace);
	await done(tx);
	db.close();
}

async function seedWorkspace(id: string, notes: unknown[], history: unknown[] = []): Promise<void> {
	const opened = indexedDB.open(resolveDbName(id), 1);
	opened.onupgradeneeded = () => {
		opened.result.createObjectStore('notes', { keyPath: 'id' });
		opened.result.createObjectStore('sync-state');
	};
	const db = await request(opened);
	const tx = db.transaction(['notes', 'sync-state'], 'readwrite');
	for (const note of notes) tx.objectStore('notes').put(note);
	if (history.length) tx.objectStore('sync-state').put(history, 'scrapscache-reminder-history');
	await done(tx);
	db.close();
}

async function firedWakeIds(workspace: string): Promise<string[]> {
	const db = await request(indexedDB.open(resolveDbName(workspace)));
	const stored = await request(
		db.transaction('sync-state').objectStore('sync-state').get('scrapscache-fired-reminders')
	);
	db.close();
	return Array.isArray(stored) ? stored : [];
}

function reminderNote(id: string, title: string, reminder: number) {
	return { id, title, body: '', reminder, archived: false, trashed: false };
}

function loadServiceWorker(
	showNotification: ReturnType<typeof vi.fn>,
	clients: Record<string, unknown> = {},
	scope = 'https://scrapscache.example/',
	caches: Record<string, unknown> = { open: vi.fn(), keys: vi.fn() }
) {
	const listeners = new Map<string, (event: unknown) => void>();
	const self = {
		location: { origin: 'https://scrapscache.example' },
		registration: { showNotification, scope },
		clients,
		addEventListener(type: string, listener: (event: unknown) => void) {
			listeners.set(type, listener);
		},
		skipWaiting: vi.fn()
	};
	runInNewContext(readFileSync('static/sw.js', 'utf8'), {
		self,
		indexedDB,
		crypto: webcrypto,
		TextEncoder,
		URL,
		URLSearchParams,
		Request,
		Response,
		fetch: vi.fn(),
		caches,
		setTimeout,
		clearTimeout,
		btoa
	});
	return listeners;
}

function loadPushHandler(showNotification: ReturnType<typeof vi.fn>, scope?: string) {
	const handler = loadServiceWorker(showNotification, {}, scope).get('push');
	if (!handler) throw new Error('Service worker did not register a push handler');
	return async (payload: unknown) => {
		let completion: Promise<unknown> | null = null;
		handler({
			data: {
				json: typeof payload === 'function' ? (payload as () => unknown) : () => payload
			},
			waitUntil(promise: Promise<unknown>) {
				completion = promise;
			}
		});
		await completion;
	};
}

function loadClickHandler(clients: Record<string, unknown>) {
	const handler = loadServiceWorker(vi.fn(), clients).get('notificationclick');
	if (!handler) throw new Error('Service worker did not register a notificationclick handler');
	return async (notification: { close: () => void; data?: unknown }) => {
		let completion: Promise<unknown> | null = null;
		handler({
			notification,
			waitUntil(promise: Promise<unknown>) {
				completion = promise;
			}
		});
		await completion;
	};
}

describe('reminder service worker', () => {
	it('shows the note from whichever workspace holds it, and claims it there', async () => {
		const note = reminderNote('550e8400-e29b-41d4-a716-446655440000', 'Pick up groceries', 1_000);
		await seedWorkspace('work', []);
		await seedWorkspace('home', [note]);
		await seedRegistry([
			{ id: 'work', tag: 'work-tag' },
			{ id: 'home', tag: 'home-tag' }
		]);
		const show = vi.fn().mockResolvedValue(undefined);
		const push = loadPushHandler(show);
		const id = reminderWakeId(note.id, note.reminder);

		await push({ type: 'reminder-wake', id, fireAt: note.reminder });

		expect(show).toHaveBeenCalledWith(
			'Pick up groceries',
			expect.objectContaining({
				tag: `scrapscache-reminder:${id}`,
				data: {
					type: 'reminder',
					noteId: note.id,
					wakeId: id,
					workspaceId: 'home',
					workspaceTag: 'home-tag',
					reminder: note.reminder
				}
			})
		);
		expect(await firedWakeIds('home')).toEqual([id]);
		expect(await firedWakeIds('work')).toEqual([]);
	});

	it('shows a repeated wake only once', async () => {
		const note = reminderNote('note-1', 'Call back', 2_000);
		await seedWorkspace('home', [note]);
		await seedRegistry([{ id: 'home', tag: 'home-tag' }]);
		const show = vi.fn().mockResolvedValue(undefined);
		const push = loadPushHandler(show);
		const payload = { type: 'reminder-wake', id: reminderWakeId(note.id, 2_000), fireAt: 2_000 };
		await push(payload);
		await push(payload);
		expect(show).toHaveBeenCalledOnce();
	});

	it('stays quiet for a reminder another device already handled', async () => {
		const note = reminderNote('note-2', 'Water plants', 3_000);
		const id = reminderWakeId(note.id, 3_000);
		await seedWorkspace(
			'home',
			[note],
			[{ id, noteId: note.id, firedAt: 3_000, dismissedAt: 3_100 }]
		);
		await seedRegistry([{ id: 'home', tag: 'home-tag' }]);
		const show = vi.fn().mockResolvedValue(undefined);
		await loadPushHandler(show)({ type: 'reminder-wake', id, fireAt: 3_000 });
		expect(show).not.toHaveBeenCalled();
	});

	it("searches only its own workspace when registered under that workspace's push scope", async () => {
		const note = reminderNote('note-3', 'Stand-up', 4_000);
		await seedWorkspace('home', [note]);
		await seedWorkspace('work', []);
		await seedRegistry([
			{ id: 'home', tag: 'home-tag' },
			{ id: 'work', tag: 'work-tag' }
		]);
		const id = reminderWakeId(note.id, 4_000);

		const workShow = vi.fn().mockResolvedValue(undefined);
		await loadPushHandler(
			workShow,
			'https://scrapscache.example/push/work/'
		)({
			type: 'reminder-wake',
			id,
			fireAt: 4_000
		});
		expect(workShow).toHaveBeenCalledWith('Reminder', expect.anything());

		const homeShow = vi.fn().mockResolvedValue(undefined);
		await loadPushHandler(
			homeShow,
			'https://scrapscache.example/push/home/'
		)({
			type: 'reminder-wake',
			id,
			fireAt: 4_000
		});
		expect(homeShow).toHaveBeenCalledWith(
			'Stand-up',
			expect.objectContaining({ data: expect.objectContaining({ workspaceId: 'home' }) })
		);
	});

	it("leaves the app's cache alone when installed for a workspace's push", async () => {
		const caches = { open: vi.fn(), keys: vi.fn() };
		const install = loadServiceWorker(
			vi.fn(),
			{},
			'https://scrapscache.example/push/home/',
			caches
		).get('install')!;
		let completion: Promise<unknown> | null = null;
		install({ waitUntil: (promise: Promise<unknown>) => (completion = promise) });
		await completion;
		expect(caches.open).not.toHaveBeenCalled();
	});

	it('says only that something is due for a note this device does not hold yet', async () => {
		await seedWorkspace('home', []);
		await seedRegistry([{ id: 'home', tag: 'home-tag' }]);
		const show = vi.fn().mockResolvedValue(undefined);
		const id = reminderWakeId('missing-note', 2_000);
		await loadPushHandler(show)({ type: 'reminder-wake', id, fireAt: 2_000 });
		expect(show).toHaveBeenCalledWith(
			'Reminder',
			expect.objectContaining({
				body: 'Open Scraps Cache to check your notes.',
				tag: `scrapscache-reminder:${id}`
			})
		);
		// Nothing claimed: the app still shows the real reminder once the note syncs.
		expect(await firedWakeIds('home')).toEqual([]);
	});

	it('falls back to the generic reminder for malformed payloads without crashing', async () => {
		const show = vi.fn().mockResolvedValue(undefined);
		const push = loadPushHandler(show);
		const malformed: unknown[] = [
			() => {
				throw new Error('not json');
			},
			undefined,
			{},
			{ type: 'something-else' },
			{ type: 'reminder-wake', id: 'too-short', fireAt: 1_000 },
			{ type: 'reminder-wake', id: 'a'.repeat(43) },
			{ type: 'reminder-wake', id: 'a'.repeat(43), fireAt: 1.5 }
		];
		for (const payload of malformed) await push(payload);
		expect(show).toHaveBeenCalledTimes(malformed.length);
		for (const call of show.mock.calls) {
			expect(call[0]).toBe('Reminder');
			expect(call[1]).toMatchObject({ tag: 'scrapscache-reminder:unknown' });
		}
	});

	it('focuses a matching window and posts the note to open on notificationclick', async () => {
		const client = {
			url: 'https://scrapscache.example/',
			postMessage: vi.fn(),
			focus: vi.fn(async () => client)
		};
		const clients = { matchAll: vi.fn(async () => [client]), openWindow: vi.fn() };
		const click = loadClickHandler(clients);
		const close = vi.fn();
		await click({
			close,
			data: { type: 'reminder', noteId: 'note-9', wakeId: 'w', workspaceId: 'home' }
		});
		expect(close).toHaveBeenCalled();
		expect(client.postMessage).toHaveBeenCalledWith({
			type: 'open-note',
			noteId: 'note-9',
			wakeId: 'w',
			workspaceId: 'home',
			reminder: null
		});
		expect(client.focus).toHaveBeenCalled();
		expect(clients.openWindow).not.toHaveBeenCalled();
	});

	it('opens a fallback page when no window matches or no note is attached', async () => {
		const foreign = { url: 'https://other.example/', postMessage: vi.fn(), focus: vi.fn() };
		const clients = { matchAll: vi.fn(async () => [foreign]), openWindow: vi.fn() };
		const click = loadClickHandler(clients);
		await click({ close: vi.fn(), data: { type: 'reminder', wakeId: 'w' } });
		expect(clients.openWindow).toHaveBeenCalledWith('/reminders');
		await click({
			close: vi.fn(),
			data: { type: 'reminder', noteId: 'note 10', wakeId: 'w', workspaceTag: 'home-tag' }
		});
		// The link names the workspace, so the app opens the note in it.
		expect(clients.openWindow).toHaveBeenCalledWith('/#w=home-tag&note=note+10');
	});
});

describe('service worker receipt queue', () => {
	it('records a system dismissal without invoking note sync', async () => {
		const pid = 'system-dismiss';
		const note = reminderNote('note-system', 'System reminder', 1000);
		await seedWorkspace(pid, [note]);
		const wakeId = reminderWakeId(note.id, 1000);
		const postMessage = vi.fn();
		const listeners = loadServiceWorker(vi.fn(), { matchAll: async () => [{ postMessage }] });
		let completion: Promise<void> | undefined;
		listeners.get('notificationclose')!({
			notification: { data: { workspaceId: pid, noteId: note.id, wakeId, reminder: 1000 } },
			waitUntil: (promise: Promise<void>) => {
				completion = promise;
			}
		});
		await completion;
		const db = await request(indexedDB.open(resolveDbName(pid)));
		const stored = await request(
			db.transaction('sync-state').objectStore('sync-state').get('scrapscache-reminder-channel')
		);
		db.close();
		expect(stored.pending).toEqual([
			expect.objectContaining({
				kind: 'handled',
				// The due time, as every device records it.
				value: expect.objectContaining({
					id: wakeId,
					firedAt: 1000,
					dismissedAt: expect.any(Number)
				})
			})
		]);
		expect(postMessage).toHaveBeenCalledWith({
			type: 'reminder-history-pending',
			workspaceId: pid
		});
	});
});
