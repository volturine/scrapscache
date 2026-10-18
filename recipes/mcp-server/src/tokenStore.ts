import { identityFromSyncKey, isValidSyncKey, sha256 } from './crypto.js';
import { OAuthManager } from './oauth.js';
import type { GrantedWorkspace } from './grant.js';

export type ResolvedAccount = {
	accountId: string;
	syncKey: string;
	workspaces?: GrantedWorkspace[];
};

type StaticTokenEntry = {
	tokenDigest: Uint8Array;
	account: ResolvedAccount;
};

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	let diff = 0;
	for (let i = 0; i < a.byteLength; i += 1) {
		diff |= a[i] ^ b[i];
	}
	return diff === 0;
}

export class TokenStore {
	private readonly staticTokens: StaticTokenEntry[] = [];
	private readonly oauthManager: OAuthManager;

	constructor(
		oauthManager: OAuthManager,
		config?: {
			syncKey?: string;
			bearerToken?: string;
			friendsTokensJson?: string;
			friendsTokensPairs?: string;
		}
	) {
		this.oauthManager = oauthManager;

		// 1. Single-user static token
		if (config?.bearerToken && config?.syncKey) {
			const syncKey = config.syncKey.trim();
			if (!isValidSyncKey(syncKey)) throw new Error('Invalid MCP sync key configuration');
			const accountId = identityFromSyncKey(syncKey).accountId;
			this.setStaticToken(config.bearerToken.trim(), {
				accountId,
				syncKey
			});
		}

		// 2. Friends tokens from JSON format: '{"tokenA": "syncKeyA", "tokenB": "syncKeyB"}'
		if (config?.friendsTokensJson) {
			try {
				const map = JSON.parse(config.friendsTokensJson) as Record<string, string>;
				for (const [tok, key] of Object.entries(map)) {
					const cleanKey = key.trim();
					if (!tok.trim() || !isValidSyncKey(cleanKey)) throw new Error('Invalid sync key');
					const accountId = identityFromSyncKey(cleanKey).accountId;
					this.setStaticToken(tok.trim(), { accountId, syncKey: cleanKey });
				}
			} catch {
				throw new Error('Invalid MCP_FRIENDS_TOKENS configuration');
			}
		}

		// 3. Friends tokens from pair string format: 'token1:syncKey1,token2:syncKey2'
		if (config?.friendsTokensPairs) {
			for (const pair of config.friendsTokensPairs.split(',')) {
				const [tok, key] = pair.split(':');
				if (tok && key) {
					const cleanKey = key.trim();
					if (!isValidSyncKey(cleanKey)) throw new Error('Invalid sync key');
					const accountId = identityFromSyncKey(cleanKey).accountId;
					this.setStaticToken(tok.trim(), { accountId, syncKey: cleanKey });
				}
			}
		}
	}

	private setStaticToken(token: string, account: ResolvedAccount): void {
		const tokenDigest = sha256(token);
		const existing = this.staticTokens.find((entry) =>
			constantTimeEqual(entry.tokenDigest, tokenDigest)
		);
		if (existing) {
			existing.account = account;
			return;
		}
		this.staticTokens.push({ tokenDigest, account });
	}

	getOAuthManager(): OAuthManager {
		return this.oauthManager;
	}

	async resolveToken(token: string): Promise<ResolvedAccount | null> {
		const clean = token.trim();
		// Check static tokens first using constant-time digest comparison
		if (this.staticTokens.length > 0) {
			const candidateDigest = sha256(clean);
			let matched: ResolvedAccount | null = null;
			for (const entry of this.staticTokens) {
				if (constantTimeEqual(entry.tokenDigest, candidateDigest)) {
					matched = entry.account;
				}
			}
			if (matched) return matched;
		}

		// Check OAuth tokens
		return this.oauthManager.resolveToken(clean);
	}
}
