// Service worker — caches the app shell so iOS reloads are instant.
// JS/CSS must not be cache-first forever: hashed builds change filenames, but
// a stale shell HTML or long-lived module cache leaves phones on old UI bugs.

const CACHE_NAME = 'scrapscache-v3';

// The app registers this script twice over: once for the whole app (the shell
// cache), and once per synced workspace under `/push/<workspace id>/`, which
// holds that workspace's own push subscription. A workspace's instance caches
// nothing and only handles that workspace's reminders.
const PUSH_WORKSPACE = (() => {
	try {
		const match = new URL(self.registration.scope).pathname.match(/^\/push\/([^/]+)\/$/);
		return match ? decodeURIComponent(match[1]) : null;
	} catch {
		return null;
	}
})();
const APP_SHELL = [
	'/',
	'/manifest.json',
	'/icon-192.png',
	'/icon-512.png',
	'/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
	if (PUSH_WORKSPACE) {
		event.waitUntil(self.skipWaiting());
		return;
	}
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(APP_SHELL).catch(() => undefined))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	if (PUSH_WORKSPACE) {
		event.waitUntil(self.clients.claim());
		return;
	}
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
		).then(() => self.clients.claim())
	);
});

function isImmutableAsset(url) {
	return (
		url.pathname.startsWith('/_app/immutable/') ||
		url.pathname.startsWith('/excalidraw-assets/')
	);
}

self.addEventListener('fetch', (event) => {
	const req = event.request;
	// Only handle GET requests.
	if (req.method !== 'GET') return;

	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;

	// Don't intercept API calls (sync) — always go to network.
	if (url.pathname.startsWith('/api/')) return;

	// Never cache the service worker itself.
	if (url.pathname === '/sw.js') {
		event.respondWith(fetch(req));
		return;
	}

	// Navigation: network first so deploys replace the shell HTML promptly.
	if (req.mode === 'navigate') {
		event.respondWith(
			fetch(req)
				.then((res) => {
					const copy = res.clone();
					caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
					return res;
				})
				.catch(() => caches.match(req).then((res) => res || caches.match('/')))
		);
		return;
	}

	// Hashed build assets are immutable: cache-first is safe once fetched.
	if (isImmutableAsset(url)) {
		event.respondWith(
			caches.match(req).then((cached) => {
				if (cached) return cached;
				return fetch(req).then((res) => {
					if (res.ok) {
						const copy = res.clone();
						caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
					}
					return res;
				});
			})
		);
		return;
	}

	// Other same-origin GETs (CSS from shell, icons, etc.): network first, cache fallback.
	event.respondWith(
		fetch(req)
			.then((res) => {
				if (res.ok) {
					const copy = res.clone();
					caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
				}
				return res;
			})
			.catch(() => caches.match(req).then((res) => res || fetch(req)))
	);
});

// Reminders. Every workspace on this device keeps its notes in its own database,
// `scrapscache-profile-<id>`; the device database lists them. A wake names no
// workspace, so each is searched for the note it belongs to.
const DEVICE_DB = 'scrapscache-device';
const DEVICE_DB_VERSION = 2;
const WORKSPACES_STORE = 'workspaces';
const LINK_PREVIEWS_STORE = 'link-previews';
const NOTES_STORE = 'notes';
const SYNC_STATE_STORE = 'sync-state';
const FIRED_KEY = 'scrapscache-fired-reminders';
const HISTORY_KEY = 'scrapscache-reminder-history';
const RECEIPT_CHANNEL_KEY = 'scrapscache-reminder-channel';
const WAKE_ID_RE = /^[A-Za-z0-9_-]{43}$/;
const WAKE_DOMAIN = 'scraps-cache-reminder-wake:v1\0';
const LOOKUP_BUDGET_MS = 1_500;

function idbRequest(request) {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function idbTransaction(transaction) {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
}

function withTimeout(promise, ms) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timeout')), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

/** The same schema the app creates, so whichever opens it first builds it whole. */
function openDeviceDb() {
	const request = indexedDB.open(DEVICE_DB, DEVICE_DB_VERSION);
	request.onupgradeneeded = () => {
		const db = request.result;
		if (!db.objectStoreNames.contains(WORKSPACES_STORE))
			db.createObjectStore(WORKSPACES_STORE, { keyPath: 'id' });
		if (!db.objectStoreNames.contains(LINK_PREVIEWS_STORE))
			db.createObjectStore(LINK_PREVIEWS_STORE, { keyPath: 'url' });
		if (!db.objectStoreNames.contains('device-state')) db.createObjectStore('device-state');
	};
	return idbRequest(request);
}

/** `{ id, tag }` of every workspace on this device. */
async function registeredWorkspaces() {
	const db = await openDeviceDb();
	try {
		const rows = await idbRequest(db.transaction(WORKSPACES_STORE).objectStore(WORKSPACES_STORE).getAll());
		return Array.isArray(rows) ? rows.filter((row) => row && typeof row.id === 'string') : [];
	} finally {
		db.close();
	}
}

/** Open a workspace's database only if it exists; opening one that does not would create it. */
async function openWorkspaceDb(id) {
	const name = 'scrapscache-profile-' + id;
	if (typeof indexedDB.databases === 'function') {
		const databases = await indexedDB.databases();
		if (!databases.some((database) => database.name === name)) return null;
	}
	return idbRequest(indexedDB.open(name));
}

function showGenericReminder(wakeId) {
	return self.registration.showNotification('Reminder', {
		body: 'Open Scraps Cache to check your notes.',
		tag: 'scrapscache-reminder:' + wakeId,
		renotify: false,
		icon: '/icon-192.png',
		data: { type: 'reminder', wakeId }
	});
}

function reminderPreview(note) {
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

function formatWhen(ts) {
	return new Date(ts).toLocaleString([], {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
}

function bytesToBase64Url(bytes) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function reminderWakeId(noteId, reminder) {
	const bytes = new TextEncoder().encode(WAKE_DOMAIN + noteId + '\0' + reminder);
	return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

/** The note a wake belongs to in one workspace, and whether any device already handled it. */
async function findInWorkspace(workspace, wake) {
	const db = await openWorkspaceDb(workspace.id);
	if (!db) return null;
	try {
		if (!db.objectStoreNames.contains(NOTES_STORE)) return null;
		const notes = await idbRequest(db.transaction(NOTES_STORE).objectStore(NOTES_STORE).getAll());
		let note = null;
		for (const candidate of Array.isArray(notes) ? notes : []) {
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
			const history = await idbRequest(
				db.transaction(SYNC_STATE_STORE).objectStore(SYNC_STATE_STORE).get(HISTORY_KEY)
			);
			handled =
				Array.isArray(history) && history.some((entry) => entry && entry.id === wake.id);
		}
		return { workspace, note, handled };
	} finally {
		db.close();
	}
}

/** Claim a wake in its workspace's ledger. False when this device already showed it. */
async function claimFiredWake(workspaceId, wakeId) {
	const db = await openWorkspaceDb(workspaceId);
	if (!db) return true;
	try {
		if (!db.objectStoreNames.contains(SYNC_STATE_STORE)) return true;
		const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
		const done = idbTransaction(tx);
		const store = tx.objectStore(SYNC_STATE_STORE);
		const stored = await idbRequest(store.get(FIRED_KEY));
		const fired = new Set(
			Array.isArray(stored) ? stored.filter((item) => typeof item === 'string') : []
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
async function recordReminderReceipt(data, dismissed = false) {
	if (
		!data ||
		typeof data.workspaceId !== 'string' ||
		typeof data.noteId !== 'string' ||
		!WAKE_ID_RE.test(data.wakeId) ||
		typeof data.reminder !== 'number' ||
		!(data.reminder > 0)
	)
		return;
	const db = await openWorkspaceDb(data.workspaceId);
	if (!db) return;
	try {
		const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
		const done = idbTransaction(tx);
		const store = tx.objectStore(SYNC_STATE_STORE);
		const stored = await idbRequest(store.get(HISTORY_KEY));
		const history = Array.isArray(stored) ? stored : [];
		const saved = await idbRequest(store.get(RECEIPT_CHANNEL_KEY));
		const channel = {
			accountId: typeof saved?.accountId === 'string' ? saved.accountId : '',
			cursor: Number.isSafeInteger(saved?.cursor) ? saved.cursor : 0,
			pending: Array.isArray(saved?.pending) ? saved.pending : [],
			deletedNotes:
				saved?.deletedNotes && typeof saved.deletedNotes === 'object' ? saved.deletedNotes : {}
		};
		if (!channel.deletedNotes[data.noteId]) {
			const previous = history.find((entry) => entry?.id === data.wakeId);
			if (!previous || (dismissed && previous.dismissedAt === undefined)) {
				// Receipts record when the reminder was due, the same on every device.
				const value = {
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
	if (!self.clients?.matchAll) return;
	const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	for (const client of clients)
		client.postMessage({ type: 'reminder-history-pending', workspaceId: data.workspaceId });
}

async function findReminder(wake) {
	const registered = await registeredWorkspaces();
	// A workspace's own subscription only ever carries its own wakes.
	const workspaces = PUSH_WORKSPACE
		? [registered.find((row) => row.id === PUSH_WORKSPACE) || { id: PUSH_WORKSPACE, tag: null }]
		: registered;
	const found = await Promise.all(
		workspaces.map((workspace) => findInWorkspace(workspace, wake).catch(() => null))
	);
	return found.find(Boolean) || null;
}

async function showReminderWake(wake) {
	let found = null;
	try {
		found = await withTimeout(findReminder(wake), LOOKUP_BUDGET_MS);
	} catch {
		found = null;
	}
	// A note this device does not hold yet: say only that something is due. Nothing
	// is claimed, so the app still shows the real reminder once the note arrives.
	if (!found) {
		await showGenericReminder(wake.id);
		return;
	}
	if (found.handled) return;
	try {
		if (!(await claimFiredWake(found.workspace.id, wake.id))) return;
	} catch {
		/* IndexedDB can be unavailable; retain once-per-push delivery. */
	}
	await self.registration.showNotification(reminderPreview(found.note), {
		body: formatWhen(wake.fireAt),
		tag: 'scrapscache-reminder:' + wake.id,
		renotify: false,
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

self.addEventListener('push', (event) => {
	let data = null;
	try {
		data = event.data && event.data.json();
	} catch {
		data = null;
	}
	const wake =
		data &&
		data.type === 'reminder-wake' &&
		typeof data.id === 'string' &&
		WAKE_ID_RE.test(data.id) &&
		Number.isSafeInteger(data.fireAt)
			? { id: data.id, fireAt: data.fireAt }
			: null;
	if (!wake) {
		event.waitUntil(showGenericReminder('unknown'));
		return;
	}
	event.waitUntil(showReminderWake(wake).catch(() => showGenericReminder(wake.id)));
});

function notePath(data) {
	const noteId = data && typeof data.noteId === 'string' ? data.noteId : null;
	if (!noteId) return '/reminders';
	const params = new URLSearchParams();
	if (typeof data.workspaceTag === 'string' && data.workspaceTag) params.set('w', data.workspaceTag);
	params.set('note', noteId);
	return '/#' + params.toString();
}

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const data = event.notification.data || {};
	const text = (value) => (typeof value === 'string' ? value : null);
	event.waitUntil(
		recordReminderReceipt(data, true)
			.catch(() => undefined)
			.then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
			.then((clients) => {
				for (const client of clients) {
					try {
						if (new URL(client.url).origin !== self.location.origin) continue;
					} catch {
						continue;
					}
					client.postMessage({
						type: 'open-note',
						noteId: text(data.noteId),
						wakeId: text(data.wakeId),
						workspaceId: text(data.workspaceId),
						reminder: typeof data.reminder === 'number' ? data.reminder : null
					});
					if ('focus' in client) return client.focus();
				}
				if (self.clients.openWindow) return self.clients.openWindow(notePath(data));
			})
	);
});

self.addEventListener('notificationclose', (event) => {
	event.waitUntil(recordReminderReceipt(event.notification.data, true).catch(() => undefined));
});
