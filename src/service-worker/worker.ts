// The service worker: an offline copy of each build, and reminder notifications.
//
// The app registers this worker twice over: once for the whole app (the shell
// cache), and once per synced workspace under `/push/<workspace id>/`, which
// holds that workspace's own push subscription. A workspace's instance caches
// nothing and only handles that workspace's reminders.

import {
	DEVICE_DB_NAME,
	DEVICE_DB_VERSION,
	DEVICE_STATE_STORE,
	LINK_PREVIEWS_STORE,
	NOTES_STORE,
	resolveDbName,
	SYNC_STATE_STORE,
	WORKSPACES_STORE
} from '#lib/db/names.js';

/** What one build of the app needs offline. */
export interface Build {
	/** The app's version name; with the files below it names this build's cache. */
	version: string;
	/** Paths fetched into the cache on install, the shell `/` among them. */
	precache: string[];
}

/** How long a navigation waits for the network before the cached shell answers. */
export const NAVIGATION_TIMEOUT_MS = 3_000;

const CACHE_PREFIX = 'scrapscache-';
const IMMUTABLE_PREFIX = '/_app/immutable/';

// Reminders. Every workspace on this device keeps its notes in its own database;
// the device database lists them. A wake names no workspace, so each is searched
// for the note it belongs to.
const FIRED_KEY = 'scrapscache-fired-reminders';
const HISTORY_KEY = 'scrapscache-reminder-history';
const RECEIPT_CHANNEL_KEY = 'scrapscache-reminder-channel';
const WAKE_ID_RE = /^[A-Za-z0-9_-]{43}$/;
const WAKE_DOMAIN = 'scraps-cache-reminder-wake:v1\0';
const LOOKUP_BUDGET_MS = 1_500;

type Workspace = { id: string; tag: string | null };
type StoredNote = {
	id: string;
	title?: unknown;
	body?: unknown;
	reminder?: unknown;
	archived?: unknown;
	trashed?: unknown;
};
type Wake = { id: string; fireAt: number };
type Found = { workspace: Workspace; note: StoredNote; handled: boolean };
type HistoryEntry = { id: string; noteId: string; firedAt: number; dismissedAt?: number };
type ReceiptData = { workspaceId: string; noteId: string; wakeId: string; reminder: number };

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function idbTransaction(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timeout')), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

function reminderPreview(note: StoredNote): string {
	const title = String(note.title || '').trim();
	if (title) return title;
	for (const raw of String(note.body || '').split('\n')) {
		const line = raw
			.replace(/^\s*[-*+•]\s+/, '')
			.replace(/^(?:\s*(?:[-*•]\s+)?)?\[[ xX]?\]\s*/, '')
			.trim();
		if (line) return line.slice(0, 80);
	}
	return 'Untitled note';
}

function formatWhen(ts: number): string {
	return new Date(ts).toLocaleString([], {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
}

/**
 * Names the cache after the build's files as well as its version: a build
 * without a commit to name it (a container build is 'unversioned') still gets
 * a cache of its own, and every other cache is dropped once it activates.
 */
export function cacheName(build: Build): string {
	let hash = 0x811c9dc5;
	for (const path of build.precache) {
		for (let index = 0; index < path.length; index++) {
			hash = Math.imul(hash ^ path.charCodeAt(index), 0x01000193);
		}
		hash = Math.imul(hash ^ 0x0a, 0x01000193);
	}
	return `${CACHE_PREFIX}${build.version}-${(hash >>> 0).toString(16)}`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function notePath(data: Record<string, unknown>): string {
	const noteId = typeof data.noteId === 'string' ? data.noteId : null;
	if (!noteId) return '/reminders';
	const params = new URLSearchParams();
	if (typeof data.workspaceTag === 'string' && data.workspaceTag)
		params.set('w', data.workspaceTag);
	params.set('note', noteId);
	return '/#' + params.toString();
}

function isReceiptData(data: unknown): data is ReceiptData {
	if (!data || typeof data !== 'object') return false;
	const value = data as Record<string, unknown>;
	return (
		typeof value.workspaceId === 'string' &&
		typeof value.noteId === 'string' &&
		typeof value.wakeId === 'string' &&
		WAKE_ID_RE.test(value.wakeId) &&
		typeof value.reminder === 'number' &&
		value.reminder > 0
	);
}

/** The workspace whose push this instance holds, or null for the app's own instance. */
function pushWorkspace(sw: ServiceWorkerGlobalScope): string | null {
	try {
		const match = new URL(sw.registration.scope).pathname.match(/^\/push\/([^/]+)\/$/);
		return match ? decodeURIComponent(match[1]) : null;
	} catch {
		return null;
	}
}

export function startServiceWorker(sw: ServiceWorkerGlobalScope, build: Build): void {
	const PUSH_WORKSPACE = pushWorkspace(sw);
	const CACHE_NAME = cacheName(build);

	// --- The offline copy of this build ------------------------------------

	/**
	 * Hashed files are named by their content, so a copy an earlier build
	 * already holds is this build's file too; only what changed is downloaded.
	 */
	async function precache(cache: Cache): Promise<void> {
		await Promise.all(
			build.precache.map(async (path) => {
				const kept = path.startsWith(IMMUTABLE_PREFIX) ? await sw.caches.match(path) : undefined;
				if (kept) return cache.put(path, kept);
				const response = await sw.fetch(path);
				if (!response.ok || response.redirected) throw new Error(`Could not precache ${path}`);
				return cache.put(path, response);
			})
		);
	}

	sw.addEventListener('install', (event) => {
		if (PUSH_WORKSPACE) {
			event.waitUntil(sw.skipWaiting());
			return;
		}
		// A failed install leaves the previous worker and its complete copy in charge;
		// the browser tries again on its next update check.
		event.waitUntil(
			sw.caches
				.open(CACHE_NAME)
				.then(precache)
				.then(() => sw.skipWaiting())
		);
	});

	sw.addEventListener('activate', (event) => {
		if (PUSH_WORKSPACE) {
			event.waitUntil(sw.clients.claim());
			return;
		}
		// Each build replaces the one before it whole, so the cache never outgrows one build.
		event.waitUntil(
			sw.caches
				.keys()
				.then((keys) =>
					Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => sw.caches.delete(k)))
				)
				.then(() => sw.clients.claim())
		);
	});

	function remember(request: Request, response: Response): void {
		const copy = response.clone();
		void sw.caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
	}

	async function cachedPage(request: Request): Promise<Response | undefined> {
		const cache = await sw.caches.open(CACHE_NAME);
		return (await cache.match(request)) ?? (await cache.match('/'));
	}

	/**
	 * The network answers when it can, so a deploy replaces the shell promptly.
	 * When it is slow, this build's own shell answers instead: every file it
	 * references was precached with it. The network still finishes and refreshes
	 * the copy for next time.
	 *
	 * Only a good page may stand in for the shell offline: a 5xx during a deploy
	 * would otherwise be served for as long as the cache lives. A redirected
	 * response is left out too, since a navigation cannot be answered with one
	 * from the cache.
	 */
	async function navigate(event: FetchEvent): Promise<Response> {
		const request = event.request;
		const network = sw.fetch(request).then((response) => {
			if (response.ok && !response.redirected) remember(request, response);
			return response;
		});
		event.waitUntil(network.catch(() => undefined));
		const cached = await cachedPage(request);
		if (!cached) return network;
		const slow = new Promise<undefined>((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT_MS));
		const answered = await Promise.race([network.catch(() => undefined), slow]);
		return answered ?? cached;
	}

	sw.addEventListener('fetch', (event) => {
		const req = event.request;
		// Only handle GET requests.
		if (req.method !== 'GET') return;

		const url = new URL(req.url);
		if (url.origin !== sw.location.origin) return;

		// Don't intercept API calls (sync) — always go to network.
		if (url.pathname.startsWith('/api/')) return;

		if (req.mode === 'navigate') {
			event.respondWith(navigate(event));
			return;
		}

		// Hashed build assets are immutable: cache-first is safe.
		if (url.pathname.startsWith(IMMUTABLE_PREFIX)) {
			event.respondWith(
				sw.caches.match(req).then(
					(cached) =>
						cached ??
						sw.fetch(req).then((res) => {
							if (res.ok) remember(req, res);
							return res;
						})
				)
			);
			return;
		}

		// Other same-origin GETs (icons, Excalidraw fonts, etc.): network first, cache fallback.
		event.respondWith(
			sw
				.fetch(req)
				.then((res) => {
					if (res.ok) remember(req, res);
					return res;
				})
				.catch(() => sw.caches.match(req).then((res) => res ?? sw.fetch(req)))
		);
	});

	// --- Reminders -----------------------------------------------------------

	/** The same schema the app creates, so whichever opens it first builds it whole. */
	function openDeviceDb(): Promise<IDBDatabase> {
		const request = sw.indexedDB.open(DEVICE_DB_NAME, DEVICE_DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(WORKSPACES_STORE))
				db.createObjectStore(WORKSPACES_STORE, { keyPath: 'id' });
			if (!db.objectStoreNames.contains(LINK_PREVIEWS_STORE))
				db.createObjectStore(LINK_PREVIEWS_STORE, { keyPath: 'url' });
			if (!db.objectStoreNames.contains(DEVICE_STATE_STORE))
				db.createObjectStore(DEVICE_STATE_STORE);
		};
		return idbRequest(request);
	}

	/** `{ id, tag }` of every workspace on this device. */
	async function registeredWorkspaces(): Promise<Workspace[]> {
		const db = await openDeviceDb();
		try {
			const rows: unknown = await idbRequest(
				db.transaction(WORKSPACES_STORE).objectStore(WORKSPACES_STORE).getAll()
			);
			return Array.isArray(rows)
				? rows.filter((row): row is Workspace => Boolean(row) && typeof row.id === 'string')
				: [];
		} finally {
			db.close();
		}
	}

	/** Open a workspace's database only if it exists; opening one that does not would create it. */
	async function openWorkspaceDb(id: string): Promise<IDBDatabase | null> {
		const name = resolveDbName(id);
		if (typeof sw.indexedDB.databases === 'function') {
			const databases = await sw.indexedDB.databases();
			if (!databases.some((database) => database.name === name)) return null;
		}
		return idbRequest(sw.indexedDB.open(name));
	}

	function showGenericReminder(wakeId: string): Promise<void> {
		return sw.registration.showNotification('Reminder', {
			body: 'Open Scraps Cache to check your notes.',
			tag: 'scrapscache-reminder:' + wakeId,
			icon: '/icon-192.png',
			data: { type: 'reminder', wakeId, workspaceId: PUSH_WORKSPACE }
		});
	}

	async function reminderWakeId(noteId: string, reminder: number): Promise<string> {
		const bytes = new TextEncoder().encode(WAKE_DOMAIN + noteId + '\0' + reminder);
		return bytesToBase64Url(new Uint8Array(await sw.crypto.subtle.digest('SHA-256', bytes)));
	}

	/** The note a wake belongs to in one workspace, and whether any device already handled it. */
	async function findInWorkspace(workspace: Workspace, wake: Wake): Promise<Found | null> {
		const db = await openWorkspaceDb(workspace.id);
		if (!db) return null;
		try {
			if (!db.objectStoreNames.contains(NOTES_STORE)) return null;
			const notes: unknown = await idbRequest(
				db.transaction(NOTES_STORE).objectStore(NOTES_STORE).getAll()
			);
			let note: StoredNote | null = null;
			for (const candidate of Array.isArray(notes) ? (notes as StoredNote[]) : []) {
				if (!candidate || candidate.archived || candidate.trashed) continue;
				if (Number(candidate.reminder) !== wake.fireAt) continue;
				if ((await reminderWakeId(String(candidate.id), Number(candidate.reminder))) === wake.id) {
					note = candidate;
					break;
				}
			}
			if (!note) return null;
			let handled = false;
			if (db.objectStoreNames.contains(SYNC_STATE_STORE)) {
				const history: unknown = await idbRequest(
					db.transaction(SYNC_STATE_STORE).objectStore(SYNC_STATE_STORE).get(HISTORY_KEY)
				);
				handled =
					Array.isArray(history) &&
					history.some((entry: { id?: unknown } | null) => entry && entry.id === wake.id);
			}
			return { workspace, note, handled };
		} finally {
			db.close();
		}
	}

	/** Claim a wake in its workspace's ledger. False when this device already showed it. */
	async function claimFiredWake(workspaceId: string, wakeId: string): Promise<boolean> {
		const db = await openWorkspaceDb(workspaceId);
		if (!db) return true;
		try {
			if (!db.objectStoreNames.contains(SYNC_STATE_STORE)) return true;
			const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
			const done = idbTransaction(tx);
			const store = tx.objectStore(SYNC_STATE_STORE);
			const stored: unknown = await idbRequest(store.get(FIRED_KEY));
			const fired = new Set(
				Array.isArray(stored)
					? stored.filter((item): item is string => typeof item === 'string')
					: []
			);
			if (fired.has(wakeId)) {
				await done;
				return false;
			}
			fired.add(wakeId);
			await idbRequest(store.put([...fired], FIRED_KEY));
			await done;
			return true;
		} finally {
			db.close();
		}
	}

	/** Receipt queue shared with the app; no sync key is exposed to the worker. */
	async function recordReminderReceipt(data: unknown, dismissed = false): Promise<void> {
		if (!isReceiptData(data)) return;
		const db = await openWorkspaceDb(data.workspaceId);
		if (!db) return;
		try {
			const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
			const done = idbTransaction(tx);
			const store = tx.objectStore(SYNC_STATE_STORE);
			const stored: unknown = await idbRequest(store.get(HISTORY_KEY));
			const history = (Array.isArray(stored) ? stored : []) as (HistoryEntry | null)[];
			const saved = (await idbRequest(store.get(RECEIPT_CHANNEL_KEY))) as
				| { accountId?: unknown; cursor?: unknown; pending?: unknown; deletedNotes?: unknown }
				| undefined;
			const channel = {
				accountId: typeof saved?.accountId === 'string' ? saved.accountId : '',
				cursor: Number.isSafeInteger(saved?.cursor) ? (saved?.cursor as number) : 0,
				pending: Array.isArray(saved?.pending) ? (saved.pending as unknown[]) : [],
				deletedNotes:
					saved?.deletedNotes && typeof saved.deletedNotes === 'object'
						? (saved.deletedNotes as Record<string, unknown>)
						: {}
			};
			if (!channel.deletedNotes[data.noteId]) {
				const previous = history.find((entry) => entry?.id === data.wakeId);
				if (!previous || (dismissed && previous.dismissedAt === undefined)) {
					// Receipts record when the reminder was due, the same on every device.
					const value: HistoryEntry = {
						id: data.wakeId,
						noteId: data.noteId,
						firedAt: previous?.firedAt || data.reminder,
						...(dismissed ? { dismissedAt: Date.now() } : {})
					};
					// The app trims each note's history when it next merges.
					await idbRequest(
						store.put([...history.filter((entry) => entry?.id !== data.wakeId), value], HISTORY_KEY)
					);
					channel.pending.push({ kind: 'handled', value });
					await idbRequest(store.put(channel, RECEIPT_CHANNEL_KEY));
				}
			}
			await done;
		} finally {
			db.close();
		}
		if (!sw.clients?.matchAll) return;
		const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
		for (const client of clients)
			client.postMessage({ type: 'reminder-history-pending', workspaceId: data.workspaceId });
	}

	async function findReminder(wake: Wake): Promise<Found | null> {
		const registered = await registeredWorkspaces();
		// A workspace's own subscription only ever carries its own wakes.
		const workspaces = PUSH_WORKSPACE
			? [registered.find((row) => row.id === PUSH_WORKSPACE) || { id: PUSH_WORKSPACE, tag: null }]
			: registered;
		const found = await Promise.all(
			workspaces.map((workspace) => findInWorkspace(workspace, wake).catch(() => null))
		);
		return found.find((item) => item !== null) ?? null;
	}

	async function showReminderWake(wake: Wake): Promise<void> {
		let found: Found | null = null;
		try {
			found = await withTimeout(findReminder(wake), LOOKUP_BUDGET_MS);
		} catch {
			found = null;
		}
		// A note this device does not hold yet: say only that something is due. Nothing
		// is claimed, so the app still shows the real reminder once the note arrives.
		if (!found) {
			await showGenericReminder(wake.id);
			void sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
				for (const client of clients) {
					try {
						if (new URL(client.url).origin !== sw.location.origin) continue;
					} catch {
						continue;
					}
					client.postMessage({
						type: 'reminder-wake',
						wakeId: wake.id,
						workspaceId: PUSH_WORKSPACE
					});
				}
			});
			return;
		}
		if (found.handled) return;
		try {
			if (!(await claimFiredWake(found.workspace.id, wake.id))) return;
		} catch {
			/* IndexedDB can be unavailable; retain once-per-push delivery. */
		}
		await sw.registration.showNotification(reminderPreview(found.note), {
			body: formatWhen(wake.fireAt),
			tag: 'scrapscache-reminder:' + wake.id,
			icon: '/icon-192.png',
			data: {
				type: 'reminder',
				noteId: found.note.id,
				wakeId: wake.id,
				workspaceId: found.workspace.id,
				workspaceTag: typeof found.workspace.tag === 'string' ? found.workspace.tag : null,
				reminder: found.note.reminder
			}
		});
		await recordReminderReceipt({
			workspaceId: found.workspace.id,
			noteId: found.note.id,
			wakeId: wake.id,
			reminder: found.note.reminder
		});
	}

	sw.addEventListener('push', (event) => {
		let data: { type?: unknown; id?: unknown; fireAt?: unknown } | null = null;
		try {
			data = event.data && event.data.json();
		} catch {
			data = null;
		}
		const wake: Wake | null =
			data &&
			data.type === 'reminder-wake' &&
			typeof data.id === 'string' &&
			WAKE_ID_RE.test(data.id) &&
			Number.isSafeInteger(data.fireAt)
				? { id: data.id, fireAt: data.fireAt as number }
				: null;
		if (!wake) {
			event.waitUntil(showGenericReminder('unknown'));
			return;
		}
		event.waitUntil(showReminderWake(wake).catch(() => showGenericReminder(wake.id)));
	});

	sw.addEventListener('notificationclick', (event) => {
		event.notification.close();
		const data = (event.notification.data || {}) as Record<string, unknown>;
		const text = (value: unknown) => (typeof value === 'string' ? value : null);
		event.waitUntil(
			recordReminderReceipt(data, true)
				.catch(() => undefined)
				.then(() => sw.clients.matchAll({ type: 'window', includeUncontrolled: true }))
				.then((clients) => {
					for (const client of clients) {
						try {
							if (new URL(client.url).origin !== sw.location.origin) continue;
						} catch {
							continue;
						}
						client.postMessage({
							type: 'open-note',
							noteId: text(data.noteId),
							wakeId: text(data.wakeId),
							workspaceId: text(data.workspaceId) || PUSH_WORKSPACE,
							reminder: typeof data.reminder === 'number' ? data.reminder : null
						});
						if ('focus' in client) return client.focus();
					}
					if (sw.clients.openWindow) return sw.clients.openWindow(notePath(data));
				})
		);
	});

	sw.addEventListener('notificationclose', (event) => {
		event.waitUntil(recordReminderReceipt(event.notification.data, true).catch(() => undefined));
	});
}
