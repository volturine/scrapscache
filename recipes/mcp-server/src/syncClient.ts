import { identityFromSyncKey, signSyncChallenge, randomOpaqueId } from './crypto.js';

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

	async syncDelta(
		cursor: number,
		uploads: SyncEnvelope[] = [],
		deleteSlots: string[] = [],
		limit = 100
	): Promise<SyncResult> {
		let token = await this.getAccessToken();

		const doRequest = async (authToken: string) => {
			const url = `${this.baseUrl}/api/sync/delta`;
			return fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
					Authorization: `Bearer ${authToken}`,
					'x-sync-client-id': this.clientId
				},
				body: JSON.stringify({
					cursor,
					limit,
					envelopes: uploads,
					deleteSlots
				})
			});
		};

		let res = await doRequest(token);
		if (res.status === 401) {
			// Token might have expired on server side; clear and re-authenticate
			this.token = null;
			token = await this.getAccessToken();
			res = await doRequest(token);
		}

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
}
