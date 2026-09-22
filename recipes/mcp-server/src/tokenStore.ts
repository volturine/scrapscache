import { identityFromSyncKey, isValidSyncKey } from './crypto.js';
import { OAuthManager } from './oauth.js';
import type { GrantedWorkspace } from './grant.js';

export type ResolvedAccount = {
	accountId: string;
	syncKey: string;
	workspaces?: GrantedWorkspace[];
};

export class TokenStore {
	private readonly staticTokens = new Map<string, ResolvedAccount>();
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
			this.staticTokens.set(config.bearerToken.trim(), {
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
					this.staticTokens.set(tok.trim(), { accountId, syncKey: cleanKey });
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
					this.staticTokens.set(tok.trim(), { accountId, syncKey: cleanKey });
				}
			}
		}
	}

	getOAuthManager(): OAuthManager {
		return this.oauthManager;
	}

	async resolveToken(token: string): Promise<ResolvedAccount | null> {
		const clean = token.trim();
		// Check static tokens first
		const staticAccount = this.staticTokens.get(clean);
		if (staticAccount) return staticAccount;

		// Check OAuth tokens
		return this.oauthManager.resolveToken(clean);
	}
}
