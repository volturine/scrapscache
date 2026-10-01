import { identityFromSyncKey, signSyncChallenge, randomOpaqueId } from './crypto.js';
import type { ReminderWake } from '../../../src/lib/model/index.js';

export type SyncEnvelope = {
	id: string;
	slot: string;
	ciphertext: string;
	expectedId?: string | null;
	seq?: number;
};

export type SyncResult = {
	cursor: number;
	envelopes: SyncEnvelope[];
	conflicts: SyncEnvelope[];
	hasMore: boolean;
	reset: boolean;
	writesAccepted: boolean;
	/** The relay's clock when it answered, for stamping edits on its timeline. */
	serverTime?: number;
};

export class ScrapscacheSyncClient {
	private readonly baseUrl: string;
	private readonly syncKey: string;
	private readonly accountId: string;
	private readonly clientId: string;
	private token: { accessToken: string; expiresAt: number } | null = null;
	private authPromise: Promise<string> | null = null;

	constructor(baseUrl: string, syncKey: string, clientId?: string) {
		this.baseUrl = baseUrl.replace(/\/+$/, '');
		this.syncKey = syncKey;
		this.accountId = identityFromSyncKey(syncKey).accountId;
		this.clientId = clientId ?? `mcp-${randomOpaqueId().slice(0, 8)}`;
	}

	getAccountId(): string {
		return this.accountId;
	}

	getSyncKey(): string {
		return this.syncKey;
	}

	private async getAccessToken(): Promise<string> {
		const now = Date.now();
		if (this.token && this.token.expiresAt > now + 30_000) {
			return this.token.accessToken;
		}

		if (this.authPromise) {
			return this.authPromise;
		}

		this.authPromise = (async () => {
			try {
				const challengeUrl = `${this.baseUrl}/api/sync/auth/challenge`;
				const challengeRes = await fetch(challengeUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
					body: JSON.stringify({ accountId: this.accountId })
				});
				if (!challengeRes.ok) {
					throw new Error(
						`Challenge request failed with status ${challengeRes.status}: ${await challengeRes.text()}`
					);
				}
				const challengeData = (await challengeRes.json()) as {
					challengeId: string;
					challenge: string;
				};

				const signature = signSyncChallenge(this.syncKey, this.accountId, challengeData.challenge);

				const sessionUrl = `${this.baseUrl}/api/sync/auth/session`;
				const sessionRes = await fetch(sessionUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
					body: JSON.stringify({
						accountId: this.accountId,
						challengeId: challengeData.challengeId,
						signature
					})
				});
				if (!sessionRes.ok) {
					throw new Error(
						`Session authentication failed with status ${sessionRes.status}: ${await sessionRes.text()}`
					);
				}
				const sessionData = (await sessionRes.json()) as {
					accessToken: string;
					expiresAt: number;
				};

				this.token = {
					accessToken: sessionData.accessToken,
					expiresAt: sessionData.expiresAt
				};
				return sessionData.accessToken;
			} finally {
				this.authPromise = null;
			}
		})();

		return this.authPromise;
	}

	/** A JSON request under the sync session, re-authenticating once if the relay expired it. */
	private async authorizedRequest(path: string, method: string, body: unknown): Promise<Response> {
		const send = async (authToken: string) =>
			fetch(`${this.baseUrl}${path}`, {
				method,
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
					Authorization: `Bearer ${authToken}`,
					'x-sync-client-id': this.clientId
				},
				body: JSON.stringify(body)
			});
		const res = await send(await this.getAccessToken());
		if (res.status !== 401) return res;
		// Token might have expired on server side; clear and re-authenticate
		this.token = null;
		return send(await this.getAccessToken());
	}

	async syncDelta(
		cursor: number,
		uploads: SyncEnvelope[] = [],
		deleteSlots: string[] = [],
		limit = 100
	): Promise<SyncResult> {
		const res = await this.authorizedRequest('/api/sync/delta', 'POST', {
			cursor,
			limit,
			envelopes: uploads,
			deleteSlots
		});
		if (!res.ok) {
			throw new Error(`Sync delta failed with status ${res.status}: ${await res.text()}`);
		}

		const data = (await res.json()) as {
			cursor: number;
			envelopes?: SyncEnvelope[];
			conflicts?: SyncEnvelope[];
			hasMore?: boolean;
			reset?: boolean;
			writesAccepted?: boolean;
			serverTime?: number;
		};

		return {
			cursor: data.cursor ?? cursor,
			envelopes: data.envelopes ?? [],
			conflicts: data.conflicts ?? [],
			hasMore: data.hasMore ?? false,
			reset: data.reset ?? false,
			writesAccepted: data.writesAccepted ?? true,
			...(typeof data.serverTime === 'number' ? { serverTime: data.serverTime } : {})
		};
	}

	/**
	 * Replace the account's reminder wakes (opaque ids and due times) as of `revision`.
	 * False when the relay already holds a snapshot from a newer revision.
	 */
	async putReminderWakes(revision: number, wakes: ReminderWake[]): Promise<boolean> {
		const res = await this.authorizedRequest('/api/sync/push/wakes', 'PUT', { revision, wakes });
		if (res.status === 409) return false;
		if (!res.ok) throw new Error(`Reminder wake publish failed with status ${res.status}`);
		return true;
	}
}
