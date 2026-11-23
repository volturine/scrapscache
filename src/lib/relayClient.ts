// Sign-ins and requests to the relay, for any account on this device. A sign-in
// belongs to its account: it is good whichever workspace a window shows, and one
// workspace starting over leaves every other's alone.

import { observeRelayTime } from '#lib/editContext.js';
import { uid } from '#lib/model/index.js';
import {
	SYNC_DELTA_PATH,
	SYNC_PROTOCOL_HEADER,
	SYNC_PROTOCOL_VERSION
} from '#lib/model/protocol.js';
import { serverUrl } from '#lib/serverOrigin.svelte.js';
import { createSyncIdentity, signSyncChallenge, signSyncRegistration } from '#lib/syncPairing.js';
import {
	RELAY_SILENCE_MS,
	SYNC_TIMED_OUT,
	retryTransient,
	transientRetry,
	untilAborted,
	withinTime
} from '#lib/syncRetry.js';

export interface SyncAccount {
	syncKey: string;
	accountId: string;
	authPublicKey: string;
	pairingCode: string;
}

/** A protocol refusal cannot tell whether the app or the relay needs updating. */
export const SYNC_VERSION_MISMATCH_MESSAGE =
	'This app and the sync server use different versions. Save and close any open editors, then reload the app. If sync still fails, update the sync server.';

export interface SyncProgress {
	phase: 'upload' | 'download';
	loadedBytes: number;
	totalBytes: number | null;
}

/** How the relay answered one sync request, or why it did not. */
export type RelayAnswer = {
	success: boolean;
	data?: Record<string, unknown>;
	error?: string;
	/** HTTP status of a failed request; lets callers react to codes, not message text. */
	status?: number;
	/** How long a throttled or busy relay asked the client to wait before trying again. */
	retryAfterSeconds?: number;
	/** The relay was not reached or could not serve the request; sending it again is safe. */
	transient?: boolean;
	/** The relay was not reached, or did not answer: nothing here is wrong. */
	unreachable?: boolean;
	/** The relay would not sign this key in, though the key is one it still knows. */
	signInRefused?: boolean;
};

/** A request that never got an answer, as `fetch` and the time limit report it. */
export function relayNotReached(error: unknown): boolean {
	return error instanceof TypeError || (error instanceof Error && error.message === SYNC_TIMED_OUT);
}

/** A sign-in the relay answered with a no: `status` is what it answered. */
export class SignInRefused extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

export class RelayClient {
	private sessions = new Map<string, { accessToken: string; expiresAt: number }>();
	private pendingSessions = new Map<string, Promise<string>>();
	private authenticationGeneration = 0;
	private clientIds = new Map<string, string>();

	/** The relay said this account's key was deleted for good. */
	onRetired: ((account: SyncAccount) => void) | null = null;

	/**
	 * What this window calls itself to one account, so the relay does not send its
	 * own changes back to it. Each account gets a name of its own: the relay is not
	 * to learn from it that two accounts sit in the same browser.
	 */
	clientId(accountId: string): string {
		let id = this.clientIds.get(accountId);
		if (!id) this.clientIds.set(accountId, (id = uid()));
		return id;
	}

	/** The app's server setting moved: every sign-in was the old server's. */
	serverChanged(): void {
		this.authenticationGeneration += 1;
		this.pendingSessions.clear();
		this.sessions.clear();
	}

	private retired(account: SyncAccount): Error {
		this.onRetired?.(account);
		return new SignInRefused(
			'This sync key was deleted from the cloud. Create a new key to keep syncing.',
			410
		);
	}

	/** A sign-in for the account: the one it has while that is good, a new one otherwise. */
	async accessToken(account: SyncAccount): Promise<string> {
		const session = this.sessions.get(account.accountId);
		if (session && session.expiresAt - Date.now() > 5_000) return session.accessToken;
		const pendingSession = this.pendingSessions.get(account.accountId);
		if (pendingSession) return pendingSession;
		const generation = this.authenticationGeneration;
		// Every sync starts here, so a sign-in the relay never answers is given up too.
		const sessionRequest = withinTime(RELAY_SILENCE_MS, null, async (signal) => {
			const challengeResponse = await fetch(serverUrl('/api/sync/auth/challenge'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ accountId: account.accountId }),
				signal
			});
			const challenge = (await challengeResponse.json().catch(() => ({}))) as {
				challengeId?: unknown;
				challenge?: unknown;
				retired?: unknown;
			};
			if (challengeResponse.status === 410 && challenge.retired === true) {
				throw this.retired(account);
			}
			if (
				!challengeResponse.ok ||
				typeof challenge.challengeId !== 'string' ||
				typeof challenge.challenge !== 'string'
			) {
				throw new SignInRefused('Could not start sync authentication', challengeResponse.status);
			}
			const sessionResponse = await fetch(serverUrl('/api/sync/auth/session'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					accountId: account.accountId,
					challengeId: challenge.challengeId,
					signature: signSyncChallenge(account.syncKey, account.accountId, challenge.challenge)
				}),
				signal
			});
			return this.acceptIssuedSession(account, sessionResponse, generation);
		});
		this.pendingSessions.set(account.accountId, sessionRequest);
		try {
			return await sessionRequest;
		} finally {
			if (this.pendingSessions.get(account.accountId) === sessionRequest)
				this.pendingSessions.delete(account.accountId);
		}
	}

	private async acceptIssuedSession(
		account: SyncAccount,
		response: Response,
		generation: number
	): Promise<string> {
		const issued = (await response.json().catch(() => ({}))) as {
			accessToken?: unknown;
			expiresAt?: unknown;
		};
		if (
			!response.ok ||
			typeof issued.accessToken !== 'string' ||
			typeof issued.expiresAt !== 'number'
		) {
			throw new SignInRefused('Sync authentication failed', response.status);
		}
		// A sign-in that the server before the setting moved answered is not kept.
		if (generation !== this.authenticationGeneration)
			throw new Error('Sync authentication was cancelled');
		this.sessions.set(account.accountId, {
			accessToken: issued.accessToken,
			expiresAt: issued.expiresAt
		});
		return issued.accessToken;
	}

	/** A token for the live change socket, which cannot send the `Authorization` header. */
	async connectionToken(account: SyncAccount): Promise<{ token: string; refused(): void }> {
		const token = await this.accessToken(account);
		return { token, refused: () => this.invalidateSession(account.accountId, token) };
	}

	private invalidateSession(accountId: string, accessToken: string): void {
		if (this.sessions.get(accountId)?.accessToken === accessToken) this.sessions.delete(accountId);
	}

	async authorizedFetch(
		input: RequestInfo | URL,
		init: RequestInit = {},
		account: SyncAccount
	): Promise<Response> {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			// The caller's signal covers the whole call, the sign-in before the request included.
			const accessToken = await untilAborted(this.accessToken(account), init.signal);
			const headers = new Headers(init.headers);
			headers.set('authorization', `Bearer ${accessToken}`);
			headers.set('x-sync-client-id', this.clientId(account.accountId));
			headers.set(SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL_VERSION);
			const response = await fetch(typeof input === 'string' ? serverUrl(input) : input, {
				...init,
				headers
			});
			if (response.status !== 401 || attempt === 1) return response;
			this.invalidateSession(account.accountId, accessToken);
		}
		throw new Error('Sync authentication failed');
	}

	/**
	 * One sync request for an account, signed in first and again when the sign-in
	 * ran out. `cancelled` is asked before anything is sent: a sync already given up
	 * asks nothing more of the relay.
	 */
	async sendSyncRequest(
		path: string,
		payload: string,
		uploadBytes: number,
		progress: (progress: SyncProgress) => void,
		account: SyncAccount,
		signal?: AbortSignal,
		cancelled: () => boolean = () => signal?.aborted === true
	): Promise<RelayAnswer> {
		const live = () => !cancelled();
		for (let attempt = 0; attempt < 2; attempt += 1) {
			// Nothing is asked of the relay, a sign-in included, for a sync already given up.
			if (!live()) return { success: false, error: 'Sync was cancelled' };
			let accessToken: string;
			try {
				accessToken = await untilAborted(this.accessToken(account), signal);
			} catch (error) {
				// A sign-in is judged as a sync request is: what the relay refuses stands
				// until something changes, and a relay that could not serve is only not reached.
				const status = error instanceof SignInRefused ? error.status : undefined;
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Authentication failed',
					...(status !== undefined ? { status } : {}),
					...(relayNotReached(error) || (status !== undefined && status >= 500)
						? { unreachable: true }
						: {}),
					// A key deleted for good is its own case: nothing signs it in again.
					...(status !== undefined && status < 500 && status !== 410 ? { signInRefused: true } : {})
				};
			}
			// A delta round is idempotent: an upload the relay already stored carries
			// the same envelope id when it is sent again, which is not a conflict.
			const result = await retryTransient(
				() =>
					live()
						? this.sendSyncRequestWithToken(
								path,
								payload,
								uploadBytes,
								progress,
								accessToken,
								this.clientId(account.accountId),
								signal
							)
						: Promise.resolve({ success: false, error: 'Sync was cancelled' }),
				(response) => response.transient === true && live(),
				transientRetry,
				signal
			);
			if (result.status !== 401 || attempt === 1) return result;
			this.invalidateSession(account.accountId, accessToken);
		}
		return { success: false, error: 'Sync authentication failed' };
	}

	private sendSyncRequestWithToken(
		path: string,
		payload: string,
		uploadBytes: number,
		/** Told how far a large transfer has come. */
		progress: (progress: SyncProgress) => void,
		accessToken: string,
		clientId: string,
		signal?: AbortSignal
	): Promise<RelayAnswer> {
		return new Promise((resolve) => {
			const xhr = new XMLHttpRequest();
			// A sync that gives up its round drops the request instead of waiting it out.
			const dropped = () => xhr.abort();
			signal?.addEventListener('abort', dropped, { once: true });
			xhr.onloadend = () => signal?.removeEventListener('abort', dropped);
			// A connection that is up in name only neither answers nor fails. A request
			// with no byte moving either way for this long is given up. That is the only
			// limit: one that is slow but moving is left to finish, however long a photo
			// takes on a weak signal, since given up it would start again from nothing.
			// What it carried is still queued.
			let silence: ReturnType<typeof setTimeout> | undefined;
			let stalled = false;
			const moving = () => {
				clearTimeout(silence);
				silence = setTimeout(() => {
					stalled = true;
					xhr.abort();
				}, RELAY_SILENCE_MS);
			};
			const settle = (result: RelayAnswer) => {
				clearTimeout(silence);
				resolve(result);
			};
			xhr.onreadystatechange = moving;
			xhr.open('POST', serverUrl(path));
			xhr.setRequestHeader('Content-Type', 'application/json');
			xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
			xhr.setRequestHeader('x-sync-client-id', clientId);
			xhr.setRequestHeader(SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL_VERSION);

			const large = uploadBytes >= 32 * 1024;
			if (large) progress({ phase: 'upload', loadedBytes: 0, totalBytes: uploadBytes });
			xhr.upload.onprogress = (event) => {
				moving();
				if (!large) return;
				progress({
					phase: 'upload',
					loadedBytes: event.loaded,
					totalBytes: event.lengthComputable ? event.total : uploadBytes
				});
			};
			xhr.onprogress = (event) => {
				moving();
				if (!event.lengthComputable || event.total < 32 * 1024) return;
				progress({ phase: 'download', loadedBytes: event.loaded, totalBytes: event.total });
			};

			let sentAt = 0;
			xhr.onload = () => {
				const receivedAt = Date.now();
				let data: Record<string, unknown> = {};
				try {
					data = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>;
				} catch {
					/* handled below */
				}
				if (xhr.status < 200 || xhr.status >= 300) {
					const header = xhr.getResponseHeader('retry-after');
					const retryAfter = header === null ? NaN : Number(header);
					const throttled =
						(xhr.status === 429 || xhr.status === 503) &&
						Number.isFinite(retryAfter) &&
						retryAfter >= 0;
					// Background sync can finish while text or a canvas is still unsaved.
					// Keep the document open: reloading also cannot fix an older relay or
					// guarantee a different build from the service worker's cached shell.
					const versionMismatch =
						xhr.status === 409 &&
						typeof data.requiredVersion === 'string' &&
						data.requiredVersion !== SYNC_PROTOCOL_VERSION;
					settle({
						success: false,
						status: xhr.status,
						error: versionMismatch
							? SYNC_VERSION_MISMATCH_MESSAGE
							: xhr.status === 404 && path === SYNC_DELTA_PATH
								? 'The sync server needs an update to support this app version.'
								: typeof data.error === 'string'
									? data.error
									: `Sync request failed (${xhr.status})`,
						...(throttled ? { retryAfterSeconds: retryAfter } : {}),
						// A relay that asks for a wait is waited for by the sync loop instead.
						...(!throttled && xhr.status >= 502 && xhr.status <= 504 ? { transient: true } : {}),
						...(xhr.status >= 500 ? { unreachable: true } : {})
					});
					return;
				}
				// Only the relay's own answer sets the clock; an error page is anyone's.
				observeRelayTime(data.serverTime, sentAt, receivedAt);
				settle({ success: true, data });
			};
			xhr.onerror = () =>
				settle({ success: false, error: 'Sync network error', transient: true, unreachable: true });
			xhr.onabort = () =>
				settle(
					stalled
						? { success: false, error: SYNC_TIMED_OUT, unreachable: true }
						: { success: false, error: 'Sync was cancelled' }
				);
			sentAt = Date.now();
			moving();
			xhr.send(payload);
		});
	}

	/**
	 * Sign an account in afresh, recreating it on the relay when it is missing.
	 * Aborting `signal` gives it up, and so does a relay that goes silent: what runs
	 * it holds the workspace's sync lock meanwhile.
	 */
	async reauthenticate(
		account: SyncAccount,
		turnstileToken?: string,
		signal?: AbortSignal
	): Promise<void> {
		// Only this account starts over: a sign-in under way for another workspace is its own.
		this.sessions.delete(account.accountId);
		this.pendingSessions.delete(account.accountId);
		try {
			await untilAborted(this.accessToken(account), signal);
			return;
		} catch (error) {
			if (signal?.aborted) throw error;
			// A missing relay account can only be recreated during explicit recovery.
		}
		// Explicit recovery may recreate a missing relay account with the same signed identity.
		const response = await withinTime(RELAY_SILENCE_MS, signal ?? null, (limited) =>
			fetch(serverUrl('/api/sync/register'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					accountId: account.accountId,
					authPublicKey: account.authPublicKey,
					signature: signSyncRegistration(
						account.syncKey,
						account.accountId,
						account.authPublicKey
					),
					turnstileToken
				}),
				signal: limited
			})
		);
		if (!response.ok && response.status !== 409) {
			const data = await response.json().catch(() => ({}));
			if (response.status === 410 && data.retired === true) throw this.retired(account);
			throw new Error(
				typeof data.error === 'string' ? data.error : 'Could not recover sync authentication'
			);
		}
		await untilAborted(this.accessToken(account), signal);
	}

	/**
	 * Register a new, empty account with the relay, for a workspace about to get a
	 * new key. Only the relay is asked: nothing on this device changes until
	 * `assignKey`, so this is done without holding anything a workspace change waits for.
	 */
	async registerAccount(
		turnstileToken?: string
	): Promise<{ success: boolean; account?: SyncAccount; error?: string }> {
		const account = createSyncIdentity();
		try {
			const res = await withinTime(RELAY_SILENCE_MS, null, (signal) =>
				fetch(serverUrl('/api/sync/register'), {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						accountId: account.accountId,
						authPublicKey: account.authPublicKey,
						signature: signSyncRegistration(
							account.syncKey,
							account.accountId,
							account.authPublicKey
						),
						turnstileToken
					}),
					signal
				})
			);
			const data = await res.json().catch(() => ({}));
			if (!res.ok)
				return {
					success: false,
					error: typeof data.error === 'string' ? data.error : 'Registration failed'
				};
			return { success: true, account };
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : 'Network error' };
		}
	}

	/**
	 * Delete an account from the relay. Only the relay is asked: its workspace is
	 * unlinked on this device afterwards, so nothing a workspace change
	 * waits for is held while the relay takes its time.
	 */
	async deleteAccount(account: SyncAccount): Promise<{ success: boolean; error?: string }> {
		try {
			const response = await withinTime(RELAY_SILENCE_MS, null, (signal) =>
				this.authorizedFetch(
					'/api/sync/account',
					// Typed, so SvelteKit's form-CSRF check never depends on how a proxy names the host.
					{ method: 'DELETE', headers: { 'content-type': 'application/json' }, signal },
					account
				)
			);
			if (!response.ok) {
				const data = (await response.json().catch(() => ({}))) as { error?: unknown };
				return {
					success: false,
					error: typeof data.error === 'string' ? data.error : 'Could not remove from the cloud'
				};
			}
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Network error'
			};
		}
	}
}

export const relay = new RelayClient();
