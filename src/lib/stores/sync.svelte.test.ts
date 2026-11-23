import { saveProfile } from '#lib/profiles.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteImage } from '#lib/types.js';
import {
	createSyncIdentity,
	decryptSyncPayload,
	encryptSyncPayload,
	signSyncChallenge,
	type SyncIdentity
} from '#lib/syncPairing.js';
import { emptyRelayAttachments, syncControlKeys, type RelayAttachments } from '#lib/syncEngine.js';
import { sha256 } from '#lib/syncHash.js';
import * as idb from '#lib/db/idb.js';
import { MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST } from '#lib/syncLimits.js';
import { buildSyncRecords } from '#lib/syncRecords.js';
import {
	SYNC_DELTA_PATH,
	SYNC_PROTOCOL_HEADER,
	SYNC_PROTOCOL_VERSION
} from '#lib/model/protocol.js';
import { SyncStore } from './sync.svelte';
import { HISTORY_RECHECK_MS, syncOutcome } from '#lib/relaySync.js';
import { mcpWorkspaceStatuses } from '#lib/mcpWorkspaces.js';
import { relay, type SyncAccount } from '#lib/relayClient.js';
import { syncSnapshot, type SyncSnapshot } from '#lib/syncRecords.js';
import { unboundSyncEnvelope } from '../../tests/unboundEnvelope';
import { seedTestKeyring, TEST_WORKSPACE } from '../../tests/workspace';
import { syncOpen, syncParts } from '../../tests/openSync';

type RequestPayload = {
	cursor: number;
	envelopes: Array<{ id: string; slot: string; expectedId: string | null; ciphertext: string }>;
	deleteSlots: Array<{ id: string; slot: string }>;
};

type RelayData = {
	cursor: number;
	envelopes: Array<{ seq: number; id: string; slot: string; ciphertext: string }>;
	conflicts: Array<{ seq: number; id: string; slot: string; ciphertext: string }>;
	hasMore: boolean;
	reset: boolean;
	writesAccepted: boolean;
	usage?: {
		ciphertextBytes: number;
		envelopeCount: number;
		storageBytes: number;
		maxBytes: number;
	};
};

type RequestResult =
	| { success: true; data: RelayData }
	| { success: false; error: string; status?: number; unreachable?: boolean };

const emptyData = (overrides: Partial<RelayData> = {}): RelayData => ({
	cursor: 0,
	envelopes: [],
	conflicts: [],
	hasMore: false,
	reset: false,
	writesAccepted: true,
	...overrides
});

function note(
	id = 'note-1',
	overrides: Partial<Note> = {},
	images: NoteImage[] = overrides.images ?? []
): Note {
	const fieldTimes = {
		title: 1,
		body: 1,
		color: 1,
		pinned: 1,
		archived: 1,
		trashed: 1,
		reminder: 1,
		labels: 1,
		images: 1,
		linkPreviews: 1,
		...overrides.fieldTimes
	};
	return {
		id,
		title: id,
		body: '',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		...overrides,
		images,
		fieldTimes
	};
}

function attachment(id: string, dataUrl = 'data:image/png;base64,QQ=='): NoteImage {
	return {
		id,
		mime: 'image/png',
		dataUrl,
		createdAt: 1,
		contentHash: `hash-${id}`
	};
}

function envelope(
	account: SyncIdentity,
	id: string,
	seq: number,
	payload: unknown,
	slot = 'a'.repeat(64)
): RelayData['envelopes'][number] {
	return {
		seq,
		id,
		slot,
		ciphertext: encryptSyncPayload(account.syncKey, payload, slot)
	};
}

function createHarness(
	responder: (request: RequestPayload, index: number) => RequestResult | Promise<RequestResult>
): { store: SyncStore; account: SyncIdentity; requests: RequestPayload[] } {
	const account = createSyncIdentity();
	const store = new SyncStore();
	store.account = account;
	const requests: RequestPayload[] = [];
	vi.spyOn(
		relayOf(store) as unknown as {
			sendSyncRequest(
				path: string,
				payload: string
			): Promise<{ success: boolean; data?: RelayData; error?: string; status?: number }>;
		},
		'sendSyncRequest'
	).mockImplementation(async (_path, payload) => {
		const request = JSON.parse(payload) as RequestPayload;
		requests.push(request);
		return responder(request, requests.length - 1);
	});
	return { store, account, requests };
}

type Sessions = { sessions: Map<string, { accessToken: string; expiresAt: number }> };

/** The relay client a test's store signs in and sends through. */
const relayOf = (store: SyncStore) => syncParts(store).relay;

/** A store on a device that holds these keys, with the first one's workspace open. */
async function storeHolding(...accounts: SyncIdentity[]): Promise<SyncStore> {
	const store = new SyncStore();
	// The keyring loads once a store exists, and would replace the entries added here.
	await store.ensureProfilesLoaded();
	store.profiles = accounts.map((account, index) => ({
		id: index === 0 ? TEST_WORKSPACE : `workspace-${index}`,
		name: '',
		syncKey: account.syncKey,
		createdAt: index
	}));
	store.activateProfile(store.profiles[0]);
	return store;
}

async function passthrough(snapshot: SyncSnapshot): Promise<SyncSnapshot> {
	return snapshot;
}

async function seedControl(
	accountId: string,
	state: {
		cursor?: number;
		baseline?: Record<string, string>;
		recordIds?: Record<string, string>;
		outbox?: string[];
		/** What the device has seen the relay hold of attachments; nothing unless given. */
		relay?: RelayAttachments;
	}
): Promise<void> {
	const keys = syncControlKeys(accountId);
	if (state.cursor != null) await idb.setSyncState(TEST_WORKSPACE, keys.cursor, state.cursor);
	if (state.baseline) await idb.setSyncState(TEST_WORKSPACE, keys.baseline, state.baseline);
	if (state.baseline || state.relay)
		await idb.setSyncState(
			TEST_WORKSPACE,
			keys.relayAttachments,
			state.relay ?? emptyRelayAttachments()
		);
	if (state.recordIds) await idb.setSyncState(TEST_WORKSPACE, keys.recordIds, state.recordIds);
	if (state.outbox?.length) await idb.markSyncOutbox(TEST_WORKSPACE, state.outbox);
}

describe('client sync state machine', () => {
	beforeEach(() => {
		localStorage.clear();
		seedTestKeyring();
		vi.restoreAllMocks();
	});
	afterEach(() => vi.unstubAllGlobals());

	it('signs one challenge and caches the issued session', async () => {
		const account = createSyncIdentity();
		const store = await storeHolding(account);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({ challengeId: 'challenge-id', challenge: 'challenge-value' })
			)
			.mockResolvedValueOnce(
				Response.json({ accessToken: 'session-token', expiresAt: Date.now() + 60_000 })
			);
		vi.stubGlobal('fetch', fetchMock);
		const privateStore = relayOf(store) as unknown as {
			accessToken(account: SyncAccount): Promise<string>;
		};

		await expect(privateStore.accessToken(store.account!)).resolves.toBe('session-token');
		await expect(privateStore.accessToken(store.account!)).resolves.toBe('session-token');
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
			'/api/sync/auth/challenge',
			'/api/sync/auth/session'
		]);
		const exchange = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
			challengeId: string;
			signature: string;
		};
		expect(exchange.challengeId).toBe('challenge-id');
		expect(exchange.signature).toBe(
			signSyncChallenge(account.syncKey, account.accountId, 'challenge-value')
		);
	});

	it('does not offer a credential upgrade when the relay answers with a conflict', async () => {
		const store = new SyncStore();
		store.account = createSyncIdentity();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ error: 'conflict' }, { status: 409 }));
		vi.stubGlobal('fetch', fetchMock);
		const privateStore = relayOf(store) as unknown as {
			accessToken(account: SyncAccount): Promise<string>;
		};

		await expect(privateStore.accessToken(store.account!)).rejects.toThrow(
			'Could not start sync authentication'
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('keeps concurrent authentication scoped to the requested account', async () => {
		const accountA = createSyncIdentity();
		const accountB = createSyncIdentity();
		const store = await storeHolding(accountB, accountA);
		let releaseAccountA: ((response: Response) => void) | undefined;
		const accountAChallenge = new Promise<Response>((resolve) => {
			releaseAccountA = resolve;
		});
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const path = String(input);
			const request = JSON.parse(String(init?.body ?? '{}')) as { accountId?: string };
			if (path.endsWith('/challenge')) {
				if (request.accountId === accountA.accountId) return accountAChallenge;
				return new Response(JSON.stringify({ challengeId: 'b', challenge: 'challenge-b' }));
			}
			return new Response(
				JSON.stringify({
					accessToken: `token-${request.accountId}`,
					expiresAt: Date.now() + 60_000
				})
			);
		});
		vi.stubGlobal('fetch', fetchMock);
		const privateStore = relayOf(store) as unknown as Sessions & {
			accessToken(account: SyncIdentity): Promise<string>;
		};

		const tokenA = privateStore.accessToken(accountA);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		const tokenB = privateStore.accessToken(accountB);
		await expect(tokenB).resolves.toBe(`token-${accountB.accountId}`);
		releaseAccountA?.(new Response(JSON.stringify({ challengeId: 'a', challenge: 'challenge-a' })));
		await expect(tokenA).resolves.toBe(`token-${accountA.accountId}`);
		expect(fetchMock).toHaveBeenCalledTimes(4);
		// Each account has its own sign-in, whichever workspace is open.
		expect(privateStore.sessions.get(accountA.accountId)?.accessToken).toBe(
			`token-${accountA.accountId}`
		);
		expect(privateStore.sessions.get(accountB.accountId)?.accessToken).toBe(
			`token-${accountB.accountId}`
		);
	});

	it('does not keep a sign-in the server answered before the server setting moved', async () => {
		const account = createSyncIdentity();
		const store = await storeHolding(account);
		let releaseChallenge: ((response: Response) => void) | undefined;
		const challenge = new Promise<Response>((resolve) => {
			releaseChallenge = resolve;
		});
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockImplementationOnce(() => challenge)
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({ accessToken: 'late-token', expiresAt: Date.now() + 60_000 })
					)
				)
		);
		const privateStore = relayOf(store) as unknown as Sessions & {
			accessToken(account: SyncAccount): Promise<string>;
		};
		const pending = privateStore.accessToken(store.account!);
		relayOf(store).serverChanged();
		releaseChallenge?.(
			new Response(JSON.stringify({ challengeId: 'late', challenge: 'challenge' }))
		);

		await expect(pending).rejects.toThrow('Sync authentication was cancelled');
		expect(privateStore.sessions.size).toBe(0);
	});

	// Taking a key off this device is followed by telling the relay to forget this
	// device's push registration, which signs in with the key that just left.
	it('still signs in with a key that has just left this device', async () => {
		const account = createSyncIdentity();
		const store = await storeHolding(account);
		store.profiles = [{ ...store.profiles[0], syncKey: '' }];
		store.activateLocalWorkspace(TEST_WORKSPACE);
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(Response.json({ challengeId: 'c', challenge: 'challenge' }))
				.mockResolvedValueOnce(
					Response.json({ accessToken: 'goodbye-token', expiresAt: Date.now() + 60_000 })
				)
				.mockResolvedValueOnce(new Response(null, { status: 204 }))
		);

		const response = await relayOf(store).authorizedFetch(
			'/api/sync/push/wakes',
			{ method: 'DELETE' },
			account
		);

		expect(response.status).toBe(204);
	});

	// A workspace syncs whichever one the window shows, so opening it while its
	// sync is signing in must not throw that sign-in away.
	it('keeps a sign-in under way when the window opens its workspace', async () => {
		const account = createSyncIdentity();
		const store = new SyncStore();
		await store.ensureProfilesLoaded();
		const profile = { id: 'opened-later', name: 'Opened later', syncKey: account.syncKey };
		store.profiles = [...store.profiles, { ...profile, createdAt: 1 }];
		let releaseChallenge: ((response: Response) => void) | undefined;
		const challenge = new Promise<Response>((resolve) => {
			releaseChallenge = resolve;
		});
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(() => challenge)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ accessToken: 'kept-token', expiresAt: Date.now() + 60_000 }))
			);
		vi.stubGlobal('fetch', fetchMock);
		const privateStore = relayOf(store) as unknown as {
			accessToken(account: SyncIdentity): Promise<string>;
		};

		const pending = privateStore.accessToken(account);
		store.activateProfile({ ...profile, createdAt: 1 });
		releaseChallenge?.(new Response(JSON.stringify({ challengeId: 'c', challenge: 'challenge' })));

		await expect(pending).resolves.toBe('kept-token');
		// The open workspace uses the same session: nothing more is asked of the relay.
		await expect(privateStore.accessToken(account)).resolves.toBe('kept-token');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('hands the live socket a token that a refusal drops', async () => {
		const account = createSyncIdentity();
		const store = await storeHolding(account);
		const { sessions } = relayOf(store) as unknown as Sessions;
		sessions.set(account.accountId, {
			accessToken: 'cached-token',
			expiresAt: Date.now() + 60_000
		});
		const { token, refused } = await relayOf(store).connectionToken(store.account!);
		expect(token).toBe('cached-token');
		refused();
		expect(sessions.size).toBe(0);
	});

	it('keeps a sign-in that finishes after the window moved to another workspace', async () => {
		const background = createSyncIdentity();
		const store = new SyncStore();
		await store.ensureProfilesLoaded();
		store.profiles = [
			{ id: 'background', name: 'Background', syncKey: background.syncKey, createdAt: 1 }
		];
		let releaseChallenge: ((response: Response) => void) | undefined;
		const challenge = new Promise<Response>((resolve) => {
			releaseChallenge = resolve;
		});
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockImplementationOnce(() => challenge)
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({ accessToken: 'background-token', expiresAt: Date.now() + 60_000 })
					)
				)
		);
		const privateStore = relayOf(store) as unknown as {
			accessToken(account: typeof background): Promise<string>;
		};
		const pending = privateStore.accessToken(background);
		store.activateLocalWorkspace(TEST_WORKSPACE);
		releaseChallenge?.(
			new Response(JSON.stringify({ challengeId: 'late', challenge: 'challenge' }))
		);

		await expect(pending).resolves.toBe('background-token');
		// Cached for its next request, with no second sign-in.
		await expect(privateStore.accessToken(background)).resolves.toBe('background-token');
	});

	it('reauthenticates and retries an authorized request once after a rejected session', async () => {
		const account = createSyncIdentity();
		const store = await storeHolding(account);
		(relayOf(store) as unknown as Sessions).sessions.set(account.accountId, {
			accessToken: 'stale-token',
			expiresAt: Date.now() + 60_000
		});
		const resourceTokens: string[] = [];
		const resourceHeaders: Headers[] = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const path = String(input);
			if (path === '/resource') {
				resourceTokens.push(new Headers(init?.headers).get('authorization') ?? '');
				resourceHeaders.push(new Headers(init?.headers));
				return new Response(null, { status: resourceTokens.length === 1 ? 401 : 204 });
			}
			if (path.endsWith('/challenge'))
				return new Response(JSON.stringify({ challengeId: 'fresh', challenge: 'challenge' }));
			return new Response(
				JSON.stringify({ accessToken: 'fresh-token', expiresAt: Date.now() + 60_000 })
			);
		});
		vi.stubGlobal('fetch', fetchMock);

		const response = await relayOf(store).authorizedFetch('/resource', {}, store.account!);

		expect(response.status).toBe(204);
		expect(resourceTokens).toEqual(['Bearer stale-token', 'Bearer fresh-token']);
		expect(resourceHeaders.map((headers) => headers.get(SYNC_PROTOCOL_HEADER))).toEqual([
			SYNC_PROTOCOL_VERSION,
			SYNC_PROTOCOL_VERSION
		]);
	});

	it('marks a key retired when the relay refuses it for good', async () => {
		const account = createSyncIdentity();
		const store = await storeHolding(account);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ error: 'deleted', retired: true }, { status: 410 }))
		);

		await expect(relayOf(store).authorizedFetch('/resource', {}, store.account!)).rejects.toThrow(
			/deleted from the cloud/
		);
		expect(store.keyRetired).toBe(true);
	});

	it('does not mark the key retired when the account is merely missing', async () => {
		const store = new SyncStore();
		store.account = createSyncIdentity();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ error: 'Sync account not found' }, { status: 404 }))
		);

		await expect(relayOf(store).authorizedFetch('/resource', {}, store.account!)).rejects.toThrow();
		expect(store.keyRetired).toBe(false);
	});

	it('reauthenticates and retries the same delta request once after HTTP 401', async () => {
		const account = createSyncIdentity();
		const store = await storeHolding(account);
		const privateStore = relayOf(store) as unknown as Sessions & {
			sendSyncRequest(
				path: string,
				payload: string,
				uploadBytes: number,
				progress: () => void,
				account: SyncAccount
			): Promise<{ success: boolean; status?: number; data?: RelayData }>;
			sendSyncRequestWithToken(
				path: string,
				payload: string,
				uploadBytes: number,
				progress: () => void,
				accessToken: string
			): Promise<{ success: boolean; status?: number; data?: RelayData }>;
		};
		privateStore.sessions.set(account.accountId, {
			accessToken: 'stale-token',
			expiresAt: Date.now() + 60_000
		});
		const request = vi
			.spyOn(privateStore, 'sendSyncRequestWithToken')
			.mockResolvedValueOnce({ success: false, status: 401 })
			.mockResolvedValueOnce({ success: true, data: emptyData() });
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ challengeId: 'fresh', challenge: 'challenge' }))
				)
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({ accessToken: 'fresh-token', expiresAt: Date.now() + 60_000 })
					)
				)
		);

		await expect(
			privateStore.sendSyncRequest(SYNC_DELTA_PATH, '{}', 0, () => undefined, store.account!)
		).resolves.toEqual({
			success: true,
			data: emptyData()
		});
		expect(request.mock.calls.map((call) => call[4])).toEqual(['stale-token', 'fresh-token']);
	});

	it('keeps pending work on a protocol upgrade refusal without retrying', async () => {
		const local = note('note-1', { title: 'pending edit', updatedAt: 2 });
		const { store, requests } = createHarness(() => ({
			success: false,
			status: 409,
			error: 'Sync protocol version mismatch. Reload the app or update the MCP server.'
		}));
		await idb.markSyncOutbox(TEST_WORKSPACE, ['note:note-1']);

		const result = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);

		expect(result).toMatchObject({
			success: false,
			error: 'Sync protocol version mismatch. Reload the app or update the MCP server.'
		});
		expect(requests).toHaveLength(1);
		expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['note:note-1']);
	});

	it('durably applies a downloaded page before committing its cursor', async () => {
		const { store, account } = createHarness((request) => ({
			success: true,
			data: emptyData({
				cursor: 1,
				envelopes:
					request.cursor === 0
						? [envelope(account, 'remote-envelope', 1, { kind: 'note', value: note() })]
						: []
			})
		}));
		const keys = syncControlKeys(account.accountId);

		const result = await syncOpen(store, syncSnapshot(), async (snapshot) => {
			expect(await idb.getSyncState(TEST_WORKSPACE, keys.cursor)).toBeUndefined();
			for (const item of snapshot.notes) await idb.putNote(TEST_WORKSPACE, item);
			return snapshot;
		});

		expect(result.success, result.error).toBe(true);
		expect((await idb.getAllNotesMetadata(TEST_WORKSPACE)).map(({ id }) => id)).toEqual(['note-1']);
		expect(await idb.getSyncState(TEST_WORKSPACE, keys.cursor)).toBe(1);
	});

	// An operation that rewrites a workspace from the relay's copy commits that copy
	// and its sync state in one step of its own. Until then nothing may say it was read.
	it('reads the relay\u2019s whole copy without sending anything or recording that it was read', async () => {
		const { store, account, requests } = createHarness((request) => ({
			success: true,
			data: emptyData({
				cursor: 3,
				envelopes:
					request.cursor === 0
						? [
								envelope(account, 'remote-envelope', 3, { kind: 'note', value: note() }),
								envelope(
									account,
									'name-envelope',
									2,
									{ kind: 'profile-meta', value: { name: 'Named elsewhere' } },
									'b'.repeat(64)
								)
							]
						: []
			})
		}));
		const keys = syncControlKeys(account.accountId);
		// This device has synced before, and has an edit of its own queued.
		await seedControl(account.accountId, {
			cursor: 9,
			baseline: { 'note:local': 'fingerprint' },
			recordIds: { 'note:local': 'local-envelope' },
			outbox: ['note:local']
		});
		await store.ensureProfilesLoaded();
		const profile = {
			id: TEST_WORKSPACE,
			name: 'Named here',
			syncKey: account.syncKey,
			createdAt: 0
		};
		store.profiles = [profile];

		const read = await syncParts(store).engine.read(profile, new AbortController().signal);

		expect(read.success, read.error).toBe(true);
		// From the beginning, whatever this device had synced, and with nothing sent.
		expect(requests.map((request) => request.cursor)).toEqual([0]);
		expect(requests[0].envelopes).toEqual([]);
		expect(requests[0].deleteSlots).toEqual([]);
		expect(read.snapshot?.notes.map((item) => item.id)).toEqual(['note-1']);
		// What a device holding exactly that copy would have recorded.
		expect(read.control).toMatchObject({
			[keys.cursor]: 3,
			[keys.recordIds]: { 'note:note-1': 'remote-envelope' }
		});
		// The workspace's name is a record the relay holds too.
		expect(Object.keys(read.control?.[keys.baseline] as object).sort()).toEqual([
			'note:note-1',
			'profile-meta'
		]);
		// Nothing on this device changed.
		expect(await idb.getSyncState(TEST_WORKSPACE, keys.cursor)).toBe(9);
		expect(await idb.getSyncState(TEST_WORKSPACE, keys.baseline)).toEqual({
			'note:local': 'fingerprint'
		});
		expect(await idb.getSyncState(TEST_WORKSPACE, keys.recordIds)).toEqual({
			'note:local': 'local-envelope'
		});
		expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['note:local']);
		expect(await idb.getAllNotesMetadata(TEST_WORKSPACE)).toEqual([]);
		expect(store.profiles[0].name).toBe('Named here');
	});

	it('leaves all control state untouched when durable application fails', async () => {
		const { store, account } = createHarness(() => ({
			success: true,
			data: emptyData({
				cursor: 1,
				envelopes: [envelope(account, 'remote-envelope', 1, { kind: 'note', value: note() })]
			})
		}));
		const keys = syncControlKeys(account.accountId);

		const result = await syncOpen(store, syncSnapshot(), async () => {
			throw new Error('IndexedDB write failed');
		});

		expect(result).toMatchObject({ success: false });
		expect(await idb.getSyncState(TEST_WORKSPACE, keys.cursor)).toBeUndefined();
		expect(await idb.getSyncState(TEST_WORKSPACE, keys.baseline)).toBeUndefined();
		expect(await idb.getSyncState(TEST_WORKSPACE, keys.recordIds)).toBeUndefined();
		expect(await idb.getAllNotesMetadata(TEST_WORKSPACE)).toEqual([]);
	});

	it('drains every page before applying or committing, including cross-page attachments', async () => {
		const applied: SyncSnapshot[] = [];
		let cursorAtSecondRequest: unknown = 'not-requested';
		const { store, account, requests } = createHarness(async (_request, index) => {
			if (index === 0) {
				return {
					success: true,
					data: emptyData({
						cursor: 1,
						hasMore: true,
						envelopes: [
							envelope(account, 'note-envelope', 1, {
								kind: 'note',
								value: {
									...note(),
									images: [
										{
											id: 'image-1',
											mime: 'image/png',
											createdAt: 1,
											hash: 'image-hash'
										}
									]
								}
							})
						]
					})
				};
			}
			if (index > 1) return { success: true, data: emptyData({ cursor: 2 }) };
			cursorAtSecondRequest = await idb.getSyncState(
				TEST_WORKSPACE,
				syncControlKeys(account.accountId).cursor
			);
			return {
				success: true,
				data: emptyData({
					cursor: 2,
					envelopes: [
						envelope(account, 'attachment-envelope', 2, {
							kind: 'attachment',
							value: {
								id: 'image-1',
								mime: 'image/png',
								createdAt: 1,
								hash: 'image-hash',
								dataUrl: 'data:image/png;base64,QQ=='
							}
						})
					]
				})
			};
		});

		const result = await syncOpen(store, syncSnapshot(), async (snapshot) => {
			applied.push(snapshot);
			return snapshot;
		});

		expect(result.success, result.error).toBe(true);
		// Two pages, read without sending anything, then the round a first sync sends in.
		expect(requests).toHaveLength(3);
		expect(requests.slice(0, 2).every((request) => request.envelopes.length === 0)).toBe(true);
		expect(cursorAtSecondRequest).toBeUndefined();
		expect(applied).toHaveLength(1);
		expect(applied[0].notes[0]?.images?.[0]?.dataUrl).toBe('data:image/png;base64,QQ==');
		expect(await idb.getSyncState(TEST_WORKSPACE, syncControlKeys(account.accountId).cursor)).toBe(
			2
		);
	});

	it('merges downloaded state before building the first conditional upload', async () => {
		const local = note('note-1', {
			title: 'local winner',
			updatedAt: 20,
			fieldTimes: { title: 20, body: 1 }
		});
		const { store, account, requests } = createHarness((_request, index) => {
			if (index === 0) {
				return {
					success: true,
					data: emptyData({
						cursor: 1,
						envelopes: [
							envelope(account, 'remote-id', 1, {
								kind: 'note',
								value: note('note-1', {
									title: 'remote older',
									updatedAt: 10,
									fieldTimes: { title: 10, body: 1 }
								})
							})
						]
					})
				};
			}
			return { success: true, data: emptyData({ cursor: 2 }) };
		});
		await idb.markSyncOutbox(TEST_WORKSPACE, [`note:note-1`]);

		const result = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(requests[0].envelopes).toEqual([]);
		expect(requests[1].envelopes).toHaveLength(1);
		expect(requests[1].envelopes[0].expectedId).toBe('remote-id');
		expect(
			decryptSyncPayload(
				account.syncKey,
				requests[1].envelopes[0].ciphertext,
				requests[1].envelopes[0].slot
			)
		).toMatchObject({
			kind: 'note',
			value: { title: 'local winner' }
		});
	});

	it('applies a conditional-write conflict and retries against the returned version', async () => {
		const local = note('note-1', {
			title: 'local winner',
			updatedAt: 20,
			fieldTimes: { title: 20, body: 1 }
		});
		const { store, account, requests } = createHarness((_request, index) => {
			if (index === 0) return { success: true, data: emptyData({ cursor: 1 }) };
			if (index === 1) {
				return {
					success: true,
					data: emptyData({
						cursor: 2,
						writesAccepted: false,
						conflicts: [
							envelope(account, 'current-id', 2, {
								kind: 'note',
								value: note('note-1', {
									title: 'server older',
									updatedAt: 15,
									fieldTimes: { title: 15, body: 1 }
								})
							})
						]
					})
				};
			}
			return { success: true, data: emptyData({ cursor: 3 }) };
		});
		await seedControl(account.accountId, {
			cursor: 1,
			baseline: { 'note:note-1': 'old-fingerprint' },
			recordIds: { 'note:note-1': 'old-id' },
			outbox: ['note:note-1']
		});

		const result = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(requests).toHaveLength(4);
		expect(requests[1].envelopes[0].expectedId).toBe('old-id');
		expect(requests[2].envelopes).toEqual([]);
		expect(requests[3].envelopes[0].expectedId).toBe('current-id');
		expect(requests[3].envelopes[0].id).not.toBe(requests[1].envelopes[0].id);
		expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
	});

	it('downloads matching attachment bytes after a note conflict advances the relay cursor', async () => {
		const localImage = {
			...attachment('photo', 'data:image/png;base64,QQ=='),
			editedAt: 1
		};
		const remoteImage = {
			...attachment('photo', 'data:image/png;base64,Qg=='),
			editedAt: 2
		};
		const local = note(
			'note-1',
			{
				title: 'Local title',
				updatedAt: 20,
				fieldTimes: { title: 20, body: 1, images: 20 }
			},
			[localImage]
		);
		const remote = note(
			'note-1',
			{
				title: 'Remote title',
				updatedAt: 15,
				fieldTimes: { title: 15, body: 1, images: 15 }
			},
			[remoteImage]
		);
		const remoteRecords = await buildSyncRecords(syncSnapshot({ notes: [remote] }));
		const remoteNote = remoteRecords.find((record) => record.payload.kind === 'note')!;
		const remoteAttachment = remoteRecords.find((record) => record.payload.kind === 'attachment')!;
		const { store, account, requests } = createHarness(async (request, index) => {
			if (index === 0) return { success: true, data: emptyData({ cursor: 1 }) };
			if (index === 1) {
				return {
					success: true,
					data: emptyData({
						cursor: 3,
						writesAccepted: false,
						conflicts: [
							envelope(
								account,
								'remote-note',
								2,
								remoteNote.payload,
								await sha256(`${account.syncKey}\u0000note:note-1`)
							)
						]
					})
				};
			}
			if (request.envelopes.length === 0 && index === 2) {
				return {
					success: true,
					data: emptyData({
						cursor: 3,
						envelopes: [
							envelope(
								account,
								'remote-note',
								2,
								remoteNote.payload,
								await sha256(`${account.syncKey}\u0000note:note-1`)
							),
							envelope(
								account,
								'remote-attachment',
								3,
								remoteAttachment.payload,
								await sha256(`${account.syncKey}\u0000attachment:photo`)
							)
						]
					})
				};
			}
			return { success: true, data: emptyData({ cursor: 3, writesAccepted: true }) };
		});
		await seedControl(account.accountId, {
			cursor: 1,
			baseline: {
				'note:note-1': 'old-note-fingerprint',
				'attachment:photo': 'old-attachment-fingerprint'
			},
			recordIds: { 'note:note-1': 'old-note-id', 'attachment:photo': 'old-photo-id' },
			outbox: ['note:note-1', 'attachment:photo']
		});

		const result = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(requests).toHaveLength(4);
		expect(requests[2].cursor).toBe(1);
		expect(requests[2].envelopes).toEqual([]);
		expect(result.snapshot?.notes[0]?.images?.[0]?.dataUrl).toBe(remoteImage.dataUrl);
		expect(await idb.getSyncState(TEST_WORKSPACE, syncControlKeys(account.accountId).cursor)).toBe(
			3
		);
		expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
	});

	// Whoever decides when to sync again, and what to tell the user, needs to know
	// which kind of failure it was.
	it('tells a relay that was not reached from one that refused', async () => {
		let answer: RequestResult = { success: true, data: emptyData() };
		const { store } = createHarness(() => answer);
		const sync = () => syncOpen(store, syncSnapshot(), passthrough);

		answer = { success: false, error: 'Sync network error', unreachable: true };
		expect(syncOutcome(await sync())).toBe('failed');
		expect(store.relayUnreachable).toBe(true);

		answer = { success: false, status: 409, error: 'Client is out of date' };
		const refused = await sync();
		expect(syncOutcome(refused)).toBe('refused');
		expect(store.lastError).toBe('Client is out of date');
		expect(store.relayUnreachable).toBe(false);

		answer = { success: false, status: 503, error: 'Sync server is busy' };
		expect(syncOutcome(await sync())).toBe('failed');

		answer = { success: true, data: emptyData() };
		expect(syncOutcome(await sync())).toBe('synced');
		expect(store.lastError).toBeNull();
		expect(store.relayUnreachable).toBe(false);
	});

	it('recovers from an accepted upload whose response was lost without uploading it twice', async () => {
		const local = note();
		let accepted: RelayData['envelopes'][number] | null = null;
		let calls = 0;
		const { store, account, requests } = createHarness((request) => {
			calls += 1;
			if (calls === 1) return { success: true, data: emptyData() };
			if (calls === 2) {
				accepted = {
					seq: 1,
					id: request.envelopes[0].id,
					slot: request.envelopes[0].slot,
					ciphertext: request.envelopes[0].ciphertext
				};
				return { success: false, error: 'Sync timed out' };
			}
			if (calls === 3) {
				return { success: true, data: emptyData({ cursor: 1, envelopes: [accepted!] }) };
			}
			return { success: true, data: emptyData({ cursor: 1 }) };
		});
		await idb.markSyncOutbox(TEST_WORKSPACE, [`note:note-1`]);

		const failed = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);
		expect(failed).toMatchObject({ success: false, error: 'Sync timed out' });
		expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['note:note-1']);

		const retried = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);
		expect(retried.success, retried.error).toBe(true);
		expect(requests.filter((request) => request.envelopes.length > 0)).toHaveLength(1);
		expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
		expect(
			await idb.getSyncState(TEST_WORKSPACE, syncControlKeys(account.accountId).recordIds)
		).toEqual({
			'note:note-1': accepted!.id
		});
	});

	it('rewinds a leftover cursor when there is no baseline so a full pull can run', async () => {
		const pulled = note('note-1', { title: 'from account' });
		const { store, account, requests } = createHarness((request) => {
			if (request.cursor > 0) {
				return {
					success: true,
					data: emptyData({
						cursor: request.cursor,
						usage: { ciphertextBytes: 10, envelopeCount: 1, storageBytes: 522, maxBytes: 1000 }
					})
				};
			}
			return {
				success: true,
				data: emptyData({
					cursor: 1,
					envelopes: [envelope(account, 'cloud-id', 1, { kind: 'note', value: pulled })],
					usage: { ciphertextBytes: 10, envelopeCount: 1, storageBytes: 522, maxBytes: 1000 }
				})
			};
		});
		await seedControl(account.accountId, { cursor: 9 });

		const result = await syncOpen(store, syncSnapshot(), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(requests[0]?.cursor).toBe(0);
		expect(result.snapshot?.notes.map((item) => item.id)).toEqual(['note-1']);
	});

	it('sends its whole copy again once the relay says it was reset', async () => {
		const image = attachment('image-1');
		const local = note('note-1', { updatedAt: 5 }, [image]);
		const { store, account, requests } = createHarness((request, index) => {
			if (index === 0) {
				return {
					success: true,
					data: emptyData({ cursor: 0, reset: true, writesAccepted: false })
				};
			}
			return {
				success: true,
				data: emptyData({ cursor: request.envelopes.length })
			};
		});
		await seedControl(account.accountId, {
			cursor: 99,
			baseline: { 'note:note-1': 'stale' },
			recordIds: { 'note:note-1': 'stale-id' }
		});

		const reset = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);

		expect(reset.success, reset.error).toBe(true);
		expect(reset.bootstrap).toBe(true);
		expect(requests[0].envelopes).toEqual([]);
		// The note, its photo and the workspace's name: nothing as a replacement of
		// something the relay no longer has.
		const uploads = requests.flatMap((request) => request.envelopes);
		expect(uploads).toHaveLength(3);
		expect(uploads.every((item) => item.expectedId === null)).toBe(true);

		const sent = requests.length;
		const again = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);
		expect(again.success, again.error).toBe(true);
		expect(requests.slice(sent).flatMap((request) => request.envelopes)).toEqual([]);
	});

	it('sends what was not queued too after a reset, when something else was', async () => {
		const edited = note('note-1', { updatedAt: 5 });
		const untouched = note('note-2', { updatedAt: 5 });
		const { store, account, requests } = createHarness((request, index) => ({
			success: true,
			data:
				index === 0
					? emptyData({ cursor: 0, reset: true, writesAccepted: false })
					: emptyData({ cursor: request.envelopes.length })
		}));
		await seedControl(account.accountId, {
			cursor: 99,
			baseline: { 'note:note-1': 'stale', 'note:note-2': 'stale' },
			recordIds: { 'note:note-1': 'stale-1', 'note:note-2': 'stale-2' }
		});
		// Only one of the two notes was waiting to be sent when the relay was reset.
		await idb.markSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
		const local = syncSnapshot({ notes: [edited, untouched] });

		// The reset pass, and the pass the caller runs after it with every byte loaded.
		expect((await syncOpen(store, local, passthrough)).bootstrap).toBe(true);
		expect((await syncOpen(store, local, passthrough)).success).toBe(true);

		// What the first pass sent left a sync state that no longer looks like a first
		// upload: the untouched note is sent because it was queued at the reset.
		const sentNotes = requests
			.flatMap((request) => request.envelopes)
			.map(
				(item) =>
					decryptSyncPayload(account.syncKey, item.ciphertext, item.slot) as {
						kind: string;
						value?: { id?: string };
					}
			)
			.filter((payload) => payload.kind === 'note')
			.map((payload) => payload.value?.id);
		expect([...new Set(sentNotes)].sort()).toEqual(['note-1', 'note-2']);
		expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
	});

	it('keeps a note queued that an earlier round settled and a later one found changed here', async () => {
		const settled = note('note-n');
		const queued = note('note-m', { title: 'Edited here', updatedAt: 5 });
		// Another device changes the body of the note that the first round settles.
		const theirs = note('note-n', {
			body: 'Theirs',
			updatedAt: 20,
			fieldTimes: { ...settled.fieldTimes, body: 20 }
		});
		// As the relay holds them: the records this app itself would have sent.
		const asSent = async (item: Note) =>
			(await buildSyncRecords(syncSnapshot({ notes: [item] })))[0].payload;
		const first = await asSent(settled);
		const second = await asSent(theirs);
		const { store, account, requests } = createHarness((_request, index) => ({
			success: true,
			data:
				index === 0
					? emptyData({ cursor: 1, envelopes: [envelope(account, 'n-1', 1, first)] })
					: emptyData({
							cursor: 3,
							envelopes: index === 1 ? [envelope(account, 'n-2', 3, second)] : []
						})
		}));
		await seedControl(account.accountId, {
			cursor: 0,
			baseline: { 'note:note-m': 'older' },
			recordIds: { 'note:note-m': 'm-0' },
			outbox: ['note:note-m']
		});
		let saves = 0;

		const result = await syncOpen(
			store,
			syncSnapshot({ notes: [settled, queued] }),
			async (snapshot) => {
				saves += 1;
				if (saves < 2) return snapshot;
				// While the second round was with the relay the title was changed here:
				// the save merged it with what was pulled and queued the note.
				await idb.markSyncOutbox(TEST_WORKSPACE, ['note:note-n']);
				return {
					...snapshot,
					notes: snapshot.notes.map((item) =>
						item.id === 'note-n'
							? {
									...item,
									title: 'Mine',
									updatedAt: 30,
									fieldTimes: { ...item.fieldTimes, title: 30 }
								}
							: item
					)
				};
			}
		);

		expect(result.success, result.error).toBe(true);
		expect(requests.length).toBeGreaterThanOrEqual(2);
		// The relay holds their body without this device's title: the note is still owed.
		expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['note:note-n']);
	});

	it('does not send the workspace\u2019s name again when the relay already holds it', async () => {
		const { store, account, requests } = createHarness((request) => ({
			success: true,
			data: emptyData({ cursor: request.envelopes.length ? 2 : 1 })
		}));
		const local = syncSnapshot({ notes: [note()] });
		const names = () =>
			requests
				.flatMap((request) => request.envelopes)
				.map(
					(item) =>
						decryptSyncPayload(account.syncKey, item.ciphertext, item.slot) as { kind: string }
				)
				.filter((payload) => payload.kind === 'profile-meta').length;

		// Opening a workspace queues its name, every time.
		await idb.markSyncOutbox(TEST_WORKSPACE, ['profile-meta']);
		expect((await syncOpen(store, local, passthrough)).success).toBe(true);
		expect(names()).toBe(1);

		await idb.markSyncOutbox(TEST_WORKSPACE, ['profile-meta']);
		expect((await syncOpen(store, local, passthrough)).success).toBe(true);

		expect(names()).toBe(1);
		expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
	});

	it('keeps every upload round within the hosted relay mutation limit', async () => {
		const limit = MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST;
		const notes = Array.from({ length: limit * 2 + 1 }, (_, index) => note(`note-${index}`));
		const { store, requests } = createHarness((_request, index) => ({
			success: true,
			data: emptyData({ cursor: index === 0 ? 0 : index * limit })
		}));

		const result = await syncOpen(store, syncSnapshot({ notes: notes }), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(requests.map((request) => request.envelopes.length)).toEqual([0, limit, limit, 1]);
		expect(
			requests.every((request) => request.envelopes.length + request.deleteSlots.length <= limit)
		).toBe(true);
	});

	it('shares the hosted relay limit between uploads and deletions', async () => {
		const limit = MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST;
		const notes = Array.from({ length: limit + 1 }, (_, index) => note(`note-${index}`));
		const { store, account, requests } = createHarness((_request, index) => ({
			success: true,
			data: emptyData({ cursor: index })
		}));
		await seedControl(account.accountId, {
			recordIds: { 'attachment:orphan': 'orphan-id' }
		});

		const result = await syncOpen(store, syncSnapshot({ notes: notes }), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(requests.some((request) => request.deleteSlots.length > 0)).toBe(true);
		expect(
			requests.every((request) => request.envelopes.length + request.deleteSlots.length <= limit)
		).toBe(true);
	});

	it('limits attachment bytes to two records per upload round', async () => {
		const local = note('note-1', {}, [
			attachment('image-1'),
			attachment('image-2'),
			attachment('image-3')
		]);
		const { store, account, requests } = createHarness((request, index) => ({
			success: true,
			data: emptyData({ cursor: index === 0 ? 0 : index + request.envelopes.length })
		}));

		const result = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);
		const kinds = requests
			.slice(1)
			.map((request) =>
				request.envelopes.map(
					(item) =>
						(decryptSyncPayload(account.syncKey, item.ciphertext, item.slot) as { kind: string })
							.kind
				)
			);

		expect(result.success, result.error).toBe(true);
		// Bytes travel with the note that lists them, two attachments a round.
		expect(kinds).toEqual([
			['attachment', 'attachment', 'note'],
			['attachment', 'note']
		]);
	});

	it('does not delete the old photo until the replacement upload is accepted', async () => {
		const local = note('note-1', {}, [attachment('new')]);
		const { store, account, requests } = createHarness((_request, index) => ({
			success: true,
			data: emptyData({ cursor: index === 0 ? 1 : index + 1, writesAccepted: true })
		}));
		await seedControl(account.accountId, {
			cursor: 1,
			baseline: {
				'note:note-1': 'old-note-fp',
				'attachment:old': 'old-pic-fp'
			},
			recordIds: {
				'note:note-1': 'note-id',
				'attachment:old': 'old-att-id'
			},
			outbox: ['note:note-1', 'attachment:new']
		});

		const result = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);

		expect(result.success, result.error).toBe(true);
		let replacementAccepted = false;
		for (const request of requests) {
			const deletedOld = request.deleteSlots.some((slot) => slot.id === 'old-att-id');
			if (deletedOld) expect(replacementAccepted).toBe(true);
			const uploadedNew = request.envelopes.some((item) => {
				const payload = decryptSyncPayload(account.syncKey, item.ciphertext, item.slot) as {
					kind?: string;
					value?: { id?: string };
				};
				return payload.kind === 'attachment' && payload.value?.id === 'new';
			});
			if (uploadedNew) replacementAccepted = true;
		}
		expect(replacementAccepted).toBe(true);
		expect(requests.some((request) => request.deleteSlots.length > 0)).toBe(true);
	});

	it('waits for catch-up before sending an orphaned attachment deletion', async () => {
		const { store, account, requests } = createHarness((_request, index) => ({
			success: true,
			data: emptyData({ cursor: index === 0 ? 3 : 3 })
		}));
		const keys = syncControlKeys(account.accountId);
		await seedControl(account.accountId, {
			cursor: 3,
			baseline: { 'attachment:orphan': 'fingerprint' },
			recordIds: { 'attachment:orphan': 'orphan-id' }
		});

		const result = await syncOpen(store, syncSnapshot(), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(requests[0].deleteSlots).toEqual([]);
		expect(requests[1].deleteSlots).toEqual([expect.objectContaining({ id: 'orphan-id' })]);
		expect(await idb.getSyncState(TEST_WORKSPACE, keys.recordIds)).toEqual({});
	});

	it('skips unreadable ciphertext without applying it and records a warning', async () => {
		const { store, account } = createHarness((request) => ({
			success: true,
			data: emptyData({
				cursor: 1,
				envelopes:
					request.cursor === 0
						? [{ seq: 1, id: 'poison', slot: 'f'.repeat(64), ciphertext: 'not-decryptable' }]
						: []
			})
		}));
		const applied: SyncSnapshot[] = [];

		const result = await syncOpen(store, syncSnapshot(), async (snapshot) => {
			applied.push(snapshot);
			return snapshot;
		});

		expect(result.success, result.error).toBe(true);
		expect(applied[0].notes).toEqual([]);
		expect(store.lastError).toBe('Skipped 1 unreadable sync record');
		expect(await idb.getSyncState(TEST_WORKSPACE, syncControlKeys(account.accountId).cursor)).toBe(
			1
		);
	});

	it('adopts an identifiable unreadable slot so the upload replaces it', async () => {
		const { store, account, requests } = createHarness((request, index) => {
			if (index === 0) {
				return {
					success: true,
					data: emptyData({
						cursor: 1,
						envelopes: [
							{
								seq: 1,
								id: 'poison',
								slot: poisonedSlot,
								ciphertext: 'not-decryptable'
							}
						]
					})
				};
			}
			if (request.envelopes[0]?.expectedId === 'poison') {
				return { success: true, data: emptyData({ cursor: 2, writesAccepted: true }) };
			}
			return { success: true, data: emptyData({ cursor: 1 }) };
		});
		const local = note('note-1', { title: 'local replacement' });
		const poisonedSlot = await sha256(`${account.syncKey}\u0000note:note-1`);
		await idb.markSyncOutbox(TEST_WORKSPACE, ['note:note-1']);

		const synced = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);
		expect(synced.success, synced.error).toBe(true);
		expect(store.lastError).toBe('Skipped 1 unreadable sync record');
		const upload = requests.at(-1)?.envelopes[0];
		expect(upload?.expectedId).toBe('poison');
		expect(decryptSyncPayload(account.syncKey, upload!.ciphertext, upload!.slot)).toMatchObject({
			kind: 'note',
			value: { title: 'local replacement' }
		});
	});

	it('does not steal the recorded id when an unrelated slot is unreadable', async () => {
		const local = note('note-1');
		const { store, account } = createHarness(() => ({
			success: true,
			data: emptyData({
				cursor: 1,
				envelopes: [{ seq: 1, id: 'poison', slot: 'f'.repeat(64), ciphertext: 'not-decryptable' }]
			})
		}));
		await seedControl(account.accountId, {
			cursor: 0,
			baseline: { 'note:note-1': 'fp' },
			recordIds: { 'note:note-1': 'tracked-id' }
		});

		const result = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(
			await idb.getSyncState(TEST_WORKSPACE, syncControlKeys(account.accountId).recordIds)
		).toEqual({
			'note:note-1': 'tracked-id'
		});
	});

	it('overwrites an undecryptable slot after adopting the conflict id', async () => {
		const local = note();
		const { store, account, requests } = createHarness((request, index) => {
			if (index === 0) return { success: true, data: emptyData({ cursor: 1 }) };
			if (request.envelopes.length === 0) return { success: true, data: emptyData({ cursor: 1 }) };
			if (request.envelopes[0]?.expectedId === 'current-id') {
				return { success: true, data: emptyData({ cursor: 2, writesAccepted: true }) };
			}
			return {
				success: true,
				data: emptyData({
					cursor: 1,
					writesAccepted: false,
					conflicts: [
						{
							seq: 1,
							id: 'current-id',
							slot: request.envelopes[0]?.slot ?? 'f'.repeat(64),
							ciphertext: 'not-decryptable'
						}
					]
				})
			};
		});
		await seedControl(account.accountId, {
			cursor: 1,
			baseline: { 'note:note-1': 'old-fingerprint' },
			recordIds: { 'note:note-1': 'old-id' },
			outbox: ['note:note-1']
		});

		const result = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(requests.map((request) => request.envelopes[0]?.expectedId)).toEqual([
			undefined,
			'old-id',
			undefined,
			'current-id'
		]);
		expect(
			await idb.getSyncState(TEST_WORKSPACE, syncControlKeys(account.accountId).recordIds)
		).toEqual({
			'note:note-1': requests[3].envelopes[0].id
		});
	});

	it('does not abort when writes are deferred for unread envelopes', async () => {
		const local = note();
		const { store, account, requests } = createHarness((_request, index) => {
			if (index === 0) return { success: true, data: emptyData({ cursor: 1 }) };
			if (index < 4) {
				return {
					success: true,
					data: emptyData({
						cursor: index,
						writesAccepted: false,
						envelopes: [
							envelope(account, `remote-${index}`, index, {
								kind: 'note',
								value: note(`remote-${index}`, { updatedAt: index, fieldTimes: { title: index } })
							})
						]
					})
				};
			}
			return { success: true, data: emptyData({ cursor: 4, writesAccepted: true }) };
		});
		await seedControl(account.accountId, {
			cursor: 1,
			baseline: { 'note:note-1': 'old-fingerprint' },
			recordIds: { 'note:note-1': 'old-id' },
			outbox: ['note:note-1']
		});

		const result = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(requests.length).toBeGreaterThanOrEqual(5);
		expect(result.error).toBeUndefined();
	});

	it('stops after repeated undecryptable write conflicts instead of looping forever', async () => {
		const local = note();
		const { store, account, requests } = createHarness((_request, index) => {
			if (index === 0) return { success: true, data: emptyData({ cursor: 1 }) };
			if (_request.envelopes.length === 0) return { success: true, data: emptyData({ cursor: 1 }) };
			return {
				success: true,
				data: emptyData({
					cursor: 1,
					writesAccepted: false,
					conflicts: [
						{ seq: 1, id: 'current-id', slot: 'f'.repeat(64), ciphertext: 'not-decryptable' }
					]
				})
			};
		});
		await seedControl(account.accountId, {
			cursor: 1,
			baseline: { 'note:note-1': 'old-fingerprint' },
			recordIds: { 'note:note-1': 'old-id' },
			outbox: ['note:note-1']
		});

		const result = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/repeated conflicts/);
		expect(requests.length).toBeLessThan(10);
	});

	it('uploads notes and other photos when one attachment exceeds quota', async () => {
		const local = note('note-1', {}, [attachment('ok'), attachment('huge')]);
		const { store, account, requests } = createHarness((request) => {
			const carriesHuge = request.envelopes.some((item) => {
				const payload = decryptSyncPayload(account.syncKey, item.ciphertext, item.slot) as {
					kind: string;
					value?: { id?: string };
				};
				return payload.kind === 'attachment' && payload.value?.id === 'huge';
			});
			if (carriesHuge)
				return { success: false, status: 507, error: 'Sync account storage quota exceeded' };
			return { success: true, data: emptyData({ cursor: 1, writesAccepted: true }) };
		});

		const result = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);
		const uploaded = requests.flatMap((request) =>
			request.envelopes.map((item) => {
				const payload = decryptSyncPayload(account.syncKey, item.ciphertext, item.slot) as {
					kind: string;
					value?: { id?: string };
				};
				return payload.kind === 'attachment' ? `attachment:${payload.value?.id}` : payload.kind;
			})
		);

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/quota/);
		expect(uploaded).toContain('note');
		expect(uploaded).toContain('attachment:ok');
		expect(store.lastError).toMatch(/quota/);
		// The note stays queued with its photo: the relay's copy lists only what it holds.
		expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['attachment:huge', 'note:note-1']);
	});

	it('returns to batched uploads after an oversized record is isolated', async () => {
		const local = note('note-1', {}, [attachment('huge'), attachment('ok-a'), attachment('ok-b')]);
		const { store, account, requests } = createHarness((request) => {
			const kinds = request.envelopes.map((item) => {
				const payload = decryptSyncPayload(account.syncKey, item.ciphertext, item.slot) as {
					kind: string;
					value?: { id?: string };
				};
				return payload.kind === 'attachment' ? payload.value?.id : payload.kind;
			});
			if (kinds.includes('huge')) {
				return { success: false, status: 507, error: 'Sync account storage quota exceeded' };
			}
			return { success: true, data: emptyData({ cursor: 1, writesAccepted: true }) };
		});

		const result = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/quota/);

		const attachmentsIn = (request: RequestPayload) =>
			request.envelopes.flatMap((item) => {
				const payload = decryptSyncPayload(account.syncKey, item.ciphertext, item.slot) as {
					kind?: string;
					value?: { id?: string };
				};
				return payload.kind === 'attachment' ? [payload.value?.id] : [];
			});
		// The oversized photo is tried on its own, with only the note that lists it.
		const hugeAlone = requests.findIndex((request) => attachmentsIn(request).join() === 'huge');
		expect(hugeAlone).toBeGreaterThan(0);
		expect(requests.slice(hugeAlone + 1).some((request) => attachmentsIn(request).length > 1)).toBe(
			true
		);
	});

	it('stops cleanly when the workspace is unlinked mid-sync', async () => {
		const { store, account } = createHarness((_request, index) => {
			if (index === 0) {
				store.profiles = store.profiles.map((entry) => ({ ...entry, syncKey: '' }));
				store.activateLocalWorkspace(TEST_WORKSPACE);
				return { success: true, data: emptyData({ cursor: 1, hasMore: true }) };
			}
			return { success: true, data: emptyData({ cursor: 2 }) };
		});
		const keys = syncControlKeys(account.accountId);
		await seedControl(account.accountId, { cursor: 0 });

		const result = await syncOpen(store, syncSnapshot(), passthrough);

		expect(result).toEqual({ success: false, error: 'Sync was cancelled' });
		expect(store.lastError).toBeNull();
		expect(await idb.getSyncState(TEST_WORKSPACE, keys.cursor)).toBe(0);
	});

	it('stops after repeated relay reset requests instead of looping forever', async () => {
		const local = note();
		const { store, requests } = createHarness(() => ({
			success: true,
			data: emptyData({ cursor: 0, reset: true, writesAccepted: false })
		}));

		const result = await syncOpen(store, syncSnapshot({ notes: [local] }), passthrough);

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/reset/);
		expect(requests.length).toBeLessThanOrEqual(5);
	});

	it('reports incomplete sync after isolating records rejected with 507', async () => {
		const notes = Array.from({ length: 4 }, (_, index) => note(`note-${index}`));
		let rejectWrites = true;
		const { store, account, requests } = createHarness((request) =>
			!rejectWrites || request.envelopes.length === 0
				? { success: true, data: emptyData({ cursor: 1 }) }
				: { success: false, status: 507, error: 'Sync account storage quota exceeded' }
		);

		const result = await syncOpen(store, syncSnapshot({ notes: notes }), passthrough);

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/quota/i);
		const isolatedIds = requests
			.filter((request) => request.envelopes.length === 1)
			.map((request) => {
				const payload = decryptSyncPayload(
					account.syncKey,
					request.envelopes[0].ciphertext,
					request.envelopes[0].slot
				) as {
					value: { id: string };
				};
				return payload.value.id;
			});
		expect(isolatedIds).toEqual(notes.map(({ id }) => id));
		expect(requests).toHaveLength(9);
		expect(requests.at(-1)?.envelopes).toEqual([]);
		expect(store.lastSync).toBe(0);
		expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(
			notes.map(({ id }) => `note:${id}`)
		);

		rejectWrites = false;
		const retry = await syncOpen(store, syncSnapshot({ notes: notes }), passthrough);

		expect(retry.success, retry.error).toBe(true);
		expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
		expect(store.lastSync).toBeGreaterThan(0);
	});
	it('clears outbox keys properly for custom profile using profile generation', async () => {
		const pid = 'custom-profile-1';
		const { store, account } = createHarness(() => ({
			success: true,
			data: emptyData({ cursor: 1, writesAccepted: true })
		}));
		await store.ensureProfilesLoaded();
		const profile = {
			id: pid,
			name: 'Custom',
			syncKey: account.syncKey,
			createdAt: Date.now()
		};
		await store.addKeyringEntry(profile);
		store.activateProfile(profile);
		await idb.markSyncOutbox(pid, ['note:custom-1']);
		expect(await idb.getSyncOutboxKeys(pid)).toEqual(['note:custom-1']);

		const result = await syncOpen(store, syncSnapshot({ notes: [note('custom-1')] }), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(await idb.getSyncOutboxKeys(pid)).toEqual([]);
	});

	it('ignores a cursor load that finishes after another profile is activated', async () => {
		let resolveA!: (value: number | undefined) => void;
		let resolveB!: (value: number | undefined) => void;
		const cursorA = new Promise<number | undefined>((resolve) => {
			resolveA = resolve;
		});
		const cursorB = new Promise<number | undefined>((resolve) => {
			resolveB = resolve;
		});
		vi.spyOn(idb, 'getSyncState').mockImplementation(((pid: string) => {
			if (pid === 'cursor-a') return cursorA;
			if (pid === 'cursor-b') return cursorB;
			return Promise.resolve(undefined);
		}) as typeof idb.getSyncState);
		const store = new SyncStore();
		// Let boot settle first, so its own activation cannot land between the two below.
		await store.ensureProfilesLoaded();
		const profileA = {
			id: 'cursor-a',
			name: 'A',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 1
		};
		const profileB = {
			id: 'cursor-b',
			name: 'B',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 2
		};
		store.profiles = [profileA, profileB];

		store.activateProfile(profileA);
		store.activateProfile(profileB);
		resolveB(7);
		await Promise.resolve();
		expect(store.syncedCursor).toBe(7);

		resolveA(99);
		await Promise.resolve();
		expect(store.syncedCursor).toBe(7);
	});

	it('prunes orphan outbox records when catch-up downloads drain', async () => {
		const pid = 'custom-profile-2';
		const { store, account } = createHarness(() => ({
			success: true,
			data: emptyData({ cursor: 1, writesAccepted: true })
		}));
		await store.ensureProfilesLoaded();
		const profile = {
			id: pid,
			name: 'Custom 2',
			syncKey: account.syncKey,
			createdAt: Date.now()
		};
		await store.addKeyringEntry(profile);
		store.activateProfile(profile);
		await idb.markSyncOutbox(pid, ['attachment:non-existent']);
		expect(await idb.getSyncOutboxKeys(pid)).toEqual(['attachment:non-existent']);

		const result = await syncOpen(store, syncSnapshot(), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(await idb.getSyncOutboxKeys(pid)).toEqual([]);
	});

	it('does not create or resurrect any sync accounts on hard refresh or unlinking', async () => {
		localStorage.clear();
		const store1 = new SyncStore();
		await store1.ensureProfilesLoaded();
		// A fresh device starts with one private workspace, like any other, and no sync key.
		expect(store1.profiles.map(({ id, syncKey }) => [id, syncKey])).toEqual([
			[expect.any(String), '']
		]);
		expect(store1.activeProfile).toEqual(store1.profiles[0]);
		expect(store1.isLoggedIn).toBe(false);

		// Create a profile
		const p1 = {
			id: 'test-p1',
			name: 'Test Profile',
			syncKey: createSyncIdentity().syncKey,
			createdAt: Date.now()
		};
		await store1.addKeyringEntry(p1);
		store1.activateProfile(p1);
		expect(store1.isLoggedIn).toBe(true);

		// Simulate hard refresh while logged in
		const store2 = new SyncStore();
		await store2.ensureProfilesLoaded();
		expect(store2.profiles.length).toBe(2);
		expect(store2.activeProfile?.id).toBe('test-p1');

		// Unlink device: the workspace stays, as a private one
		await store2.unlinkProfile(store2.activeProfile!);
		expect(store2.isLoggedIn).toBe(false);
		expect(store2.profiles).toContainEqual({ ...p1, syncKey: '' });

		// Simulate hard refresh after unlink: must NOT resurrect the sync key
		const store3 = new SyncStore();
		await store3.ensureProfilesLoaded();
		expect(store3.profiles.filter((profile) => profile.syncKey)).toEqual([]);
		expect(store3.isLoggedIn).toBe(false);
		expect(store3.activeProfile).toEqual({ ...p1, syncKey: '' });
	});

	it('marks reachable synced workspaces as MCP-ready', async () => {
		localStorage.clear();
		const pending = createSyncIdentity();
		const ready = createSyncIdentity();
		const unavailable = createSyncIdentity();
		const store = new SyncStore();
		await store.ensureProfilesLoaded();
		await store.addKeyringEntry({
			id: 'pending-mcp',
			name: 'Pending',
			syncKey: pending.syncKey,
			createdAt: 1
		});
		await store.addKeyringEntry({
			id: 'ready-mcp',
			name: 'Ready',
			syncKey: ready.syncKey,
			createdAt: 2
		});
		await store.addKeyringEntry({
			id: 'unavailable-mcp',
			name: 'Unavailable',
			syncKey: unavailable.syncKey,
			createdAt: 3
		});
		await idb.markSyncOutbox('pending-mcp', ['note:pending-upload']);
		localStorage.setItem(
			'scrapscache-sync-status:ready-mcp',
			JSON.stringify({ lastSync: Date.now() })
		);
		localStorage.setItem(
			'scrapscache-sync-status:unavailable-mcp',
			JSON.stringify({ lastSync: Date.now() })
		);

		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const path = new URL(String(input), 'http://localhost').pathname;
				if (path.endsWith('/auth/challenge')) {
					const body = JSON.parse(String(init?.body)) as { accountId: string };
					if (body.accountId === unavailable.accountId)
						return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
					return new Response(JSON.stringify({ challengeId: 'challenge', challenge: 'value' }), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					});
				}
				return new Response(
					JSON.stringify({ accessToken: 'token', expiresAt: Date.now() + 60_000 }),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			})
		);

		const statuses = await mcpWorkspaceStatuses(store.profiles);

		expect(statuses['pending-mcp']).toEqual({ state: 'ready' });
		expect(statuses['ready-mcp']).toEqual({ state: 'ready' });
		expect(statuses['unavailable-mcp']).toEqual({ state: 'unavailable' });
		const local = store.profiles.find((profile) => !profile.syncKey)!;
		expect(statuses[local.id]).toEqual({ state: 'local' });
	});

	it('clears a queued record the relay already holds as it is', async () => {
		// Pinning and unpinning before the sync, for one, queues a record that ends up
		// unchanged. Left queued, it made every note close run a sync for nothing.
		const local = note('note-1', { body: 'unchanged' });
		const [record] = await buildSyncRecords(syncSnapshot({ notes: [local] }));
		const { store, account, requests } = createHarness(() => ({
			success: true,
			data: emptyData({ cursor: 1 })
		}));
		await seedControl(account.accountId, {
			cursor: 1,
			baseline: { 'note:note-1': record.fingerprint },
			recordIds: { 'note:note-1': 'cloud-id' },
			outbox: ['note:note-1']
		});

		const result = await syncOpen(store, syncSnapshot({ notes: [local] }));

		expect(result.success, result.error).toBe(true);
		expect(requests.flatMap((request) => request.envelopes)).toEqual([]);
		expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
	});

	it('waits out a throttled round and sends it again instead of failing the sync', async () => {
		const sentAt: number[] = [];
		const { store, account, requests } = createHarness((_request, index) => {
			sentAt.push(performance.now());
			return index === 0
				? ({
						success: false,
						status: 429,
						error: 'Too many requests',
						retryAfterSeconds: 0.2
					} as unknown as RequestResult)
				: { success: true, data: emptyData({ cursor: 1 }) };
		});
		await seedControl(account.accountId, {
			cursor: 1,
			baseline: { 'note:note-1': 'saved' },
			recordIds: { 'note:note-1': 'saved-id' },
			outbox: ['note:note-1']
		});

		const result = await syncOpen(
			store,
			syncSnapshot({ notes: [note('note-1', { body: 'edited' })] })
		);

		expect(result.success, result.error).toBe(true);
		// The throttled catch-up round goes again after the wait, then the edit uploads.
		expect(requests.map((request) => request.envelopes.length)).toEqual([0, 0, 1]);
		expect(sentAt[1] - sentAt[0]).toBeGreaterThanOrEqual(190);
	});

	it('continues one version while a note is open in the editor', async () => {
		const { store, account, requests } = createHarness(() => ({
			success: true,
			data: emptyData({ cursor: 1 })
		}));
		await seedControl(account.accountId, {
			cursor: 1,
			baseline: { 'note:note-1': 'saved' },
			recordIds: { 'note:note-1': 'before-open' }
		});
		const save = async (body: string) => {
			await idb.markSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
			const result = await syncOpen(store, syncSnapshot({ notes: [note('note-1', { body })] }));
			expect(result.success, result.error).toBe(true);
			return requests.at(-1)!.envelopes[0] as RequestPayload['envelopes'][number] & {
				continues?: boolean;
			};
		};

		const endSession = syncParts(store).engine.beginEditSession('note-1');
		const first = await save('draft');
		// The version saved before the note opened stays in the history.
		expect(first).toMatchObject({ expectedId: 'before-open' });
		expect(first.continues).toBeUndefined();
		const second = await save('more');
		expect(second).toMatchObject({ expectedId: first.id, continues: true });
		endSession();
		const later = await save('after closing');
		expect(later).toMatchObject({ expectedId: second.id });
		expect(later.continues).toBeUndefined();
	});
});

describe('a photo kept for note history', () => {
	beforeEach(() => {
		localStorage.clear();
		seedTestKeyring();
		vi.restoreAllMocks();
	});

	const photo = attachment('photo');
	/** The live note no longer shows the photo; its earlier versions may. */
	const live = (updatedAt = 5) =>
		note('note-1', { updatedAt, imageTombstones: { photo: 4 } } as Partial<Note>);

	/** Answers history reads with the given versions of note-1, and counts them. */
	function serveHistory(account: SyncIdentity, versions: () => Note[] | null) {
		return vi.spyOn(relay, 'authorizedFetch').mockImplementation(async (input) => {
			if (!String(input).startsWith('/api/sync/history')) throw new Error(`unexpected ${input}`);
			const current = versions();
			if (!current) return new Response('', { status: 503 });
			const slot = await sha256(`${account.syncKey}\u0000note:note-1`);
			const payloads = await Promise.all(
				current.map(async (version) => {
					const records = await buildSyncRecords(syncSnapshot({ notes: [version] }));
					return records.find((record) => record.key === 'note:note-1')!.payload;
				})
			);
			return Response.json({
				versions: payloads.map((payload, index) => ({
					historyId: payloads.length - index,
					savedAt: index,
					id: `version-${index}`,
					ciphertext: encryptSyncPayload(account.syncKey, payload, slot)
				}))
			});
		});
	}

	/** A relay with nothing new; a sync that keeps asking fails rather than hanging. */
	function quietRelay() {
		return createHarness((_request, index) =>
			index > 20
				? { success: false, error: 'sync never settled' }
				: { success: true, data: emptyData({ cursor: 3 }) }
		);
	}

	async function seedSyncedPhoto(accountId: string, local: Note) {
		const records = await buildSyncRecords(syncSnapshot({ notes: [local] }));
		await seedControl(accountId, {
			cursor: 3,
			baseline: Object.fromEntries(records.map((record) => [record.key, record.fingerprint])),
			recordIds: { 'note:note-1': 'note-id', 'attachment:photo': 'photo-id' }
		});
	}

	const recordIds = (accountId: string) =>
		idb.getSyncState<Record<string, string>>(TEST_WORKSPACE, syncControlKeys(accountId).recordIds);

	it('ends the round and keeps the photo and its relay id while history needs it', async () => {
		const { store, account, requests } = quietRelay();
		const history = serveHistory(account, () => [note('note-1', { updatedAt: 3 }, [photo])]);
		await seedSyncedPhoto(account.accountId, live());

		const result = await syncOpen(store, syncSnapshot({ notes: [live()] }), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(requests).toHaveLength(1);
		expect(requests.flatMap((request) => request.deleteSlots)).toEqual([]);
		expect(await recordIds(account.accountId)).toMatchObject({ 'attachment:photo': 'photo-id' });
		expect(history).toHaveBeenCalledOnce();
	});

	it('keeps the photo and still ends the round when history cannot be read', async () => {
		const { store, account, requests } = quietRelay();
		const history = serveHistory(account, () => null);
		await seedSyncedPhoto(account.accountId, live());

		const result = await syncOpen(store, syncSnapshot({ notes: [live()] }), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(requests).toHaveLength(1);
		expect(requests.flatMap((request) => request.deleteSlots)).toEqual([]);
		expect(await recordIds(account.accountId)).toMatchObject({ 'attachment:photo': 'photo-id' });
		// A failed lookup is not repeated within the sync.
		expect(history).toHaveBeenCalledOnce();
	});

	it('deletes the photo once a newer note version has pruned the one that listed it', async () => {
		const { store, account, requests } = quietRelay();
		let versions = [note('note-1', { updatedAt: 3 }, [photo])];
		serveHistory(account, () => versions);
		await seedSyncedPhoto(account.accountId, live());
		await syncOpen(store, syncSnapshot({ notes: [live()] }), passthrough);

		versions = [note('note-1', { updatedAt: 6 })];
		const result = await syncOpen(store, syncSnapshot({ notes: [live(6)] }), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(requests.at(-1)!.deleteSlots).toEqual([expect.objectContaining({ id: 'photo-id' })]);
		expect(await recordIds(account.accountId)).not.toHaveProperty('attachment:photo');
	});

	it('looks again after an hour, as the relay may have evicted history without the note changing', async () => {
		const { store, account, requests } = quietRelay();
		let versions = [note('note-1', { updatedAt: 3 }, [photo])];
		const history = serveHistory(account, () => versions);
		await seedSyncedPhoto(account.accountId, live());
		await syncOpen(store, syncSnapshot({ notes: [live()] }), passthrough);
		// Within the hour the cached answer stands, even though the relay has moved on.
		versions = [];
		await syncOpen(store, syncSnapshot({ notes: [live()] }), passthrough);
		expect(history).toHaveBeenCalledOnce();
		expect(requests.flatMap((request) => request.deleteSlots)).toEqual([]);

		const now = Date.now();
		vi.spyOn(Date, 'now').mockReturnValue(now + HISTORY_RECHECK_MS);
		const result = await syncOpen(store, syncSnapshot({ notes: [live()] }), passthrough);

		expect(result.success, result.error).toBe(true);
		expect(history).toHaveBeenCalledTimes(2);
		expect(requests.at(-1)!.deleteSlots).toEqual([expect.objectContaining({ id: 'photo-id' })]);
		expect(await recordIds(account.accountId)).not.toHaveProperty('attachment:photo');
	});
});

describe('envelopes not bound to the slot they arrive in', () => {
	beforeEach(() => {
		localStorage.clear();
		seedTestKeyring();
		vi.restoreAllMocks();
	});

	/** Pulls a single envelope at `slot` and reports what the sync applied and queued. */
	async function pullOne(ciphertextFor: (account: SyncIdentity) => string) {
		const slot = 'a'.repeat(64);
		const { store, account } = createHarness((_request, index) =>
			index === 0
				? {
						success: true,
						data: emptyData({
							cursor: 1,
							envelopes: [{ seq: 1, id: 'remote-id', slot, ciphertext: ciphertextFor(account) }]
						})
					}
				: { success: true, data: emptyData({ cursor: 1, writesAccepted: true }) }
		);
		const applied: SyncSnapshot[] = [];
		const result = await syncOpen(store, syncSnapshot(), async (snapshot) => {
			applied.push(snapshot);
			return snapshot;
		});
		return {
			result,
			error: store.lastError,
			notes: applied.flatMap((snapshot) => snapshot.notes),
			queued: await idb.getSyncOutboxKeys(TEST_WORKSPACE)
		};
	}

	const pulled = { kind: 'note', value: note('note-1', { title: 'pulled' }) };

	it('applies a record sealed for the slot it arrives in', async () => {
		const { notes, queued } = await pullOne((account) =>
			encryptSyncPayload(account.syncKey, pulled, 'a'.repeat(64))
		);
		expect(notes.map((entry) => entry.id)).toEqual(['note-1']);
		expect(queued).not.toContain('note:note-1');
	});

	it('rejects a pre-slot-binding envelope as unreadable', async () => {
		const { result, error, notes, queued } = await pullOne((account) =>
			unboundSyncEnvelope(account.syncKey, pulled)
		);
		expect(result.success, result.error).toBe(true);
		expect(notes).toEqual([]);
		expect(error).toBe('Skipped 1 unreadable sync record');
		expect(queued).not.toContain('note:note-1');
	});

	it('rejects a record the relay moved from another slot', async () => {
		const { error, notes } = await pullOne((account) =>
			encryptSyncPayload(account.syncKey, pulled, 'b'.repeat(64))
		);
		expect(notes).toEqual([]);
		expect(error).toBe('Skipped 1 unreadable sync record');
	});
});
