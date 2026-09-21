import { identityFromSyncKey } from './crypto.js';
import { OAuthManager } from './oauth.js';

export type ResolvedAccount = {
	accountId: string;
	syncKey: string;
};

export class TokenStore {
	private readonly staticTokens = new Map<string, ResolvedAccount>();
	private readonly oauthManager: OAuthManager;

	constructor(
		oauthManager: OAuthManager,
		config?: {
			defaultSyncKey?: string;
			bearerToken?: string;
			friendsTokensJson?: string;
			friendsTokensPairs?: string;
		}
	) {
		this.oauthManager = oauthManager;

		// 1. Single-user static token
		if (config?.bearerToken && config?.defaultSyncKey) {
			const accountId = identityFromSyncKey(config.defaultSyncKey).accountId;
			this.staticTokens.set(config.bearerToken.trim(), {
				accountId,
				syncKey: config.defaultSyncKey.trim()
			});
		}

		// 2. Friends tokens from JSON format: '{"tokenA": "syncKeyA", "tokenB": "syncKeyB"}'
		if (config?.friendsTokensJson) {
			try {
				const map = JSON.parse(config.friendsTokensJson) as Record<string, string>;
				for (const [tok, key] of Object.entries(map)) {
					const cleanKey = key.trim();
					const accountId = identityFromSyncKey(cleanKey).accountId;
					this.staticTokens.set(tok.trim(), { accountId, syncKey: cleanKey });
				}
			} catch {
				console.error('[TokenStore] Failed to parse friendsTokensJson');
			}
		}

		// 3. Friends tokens from pair string format: 'token1:syncKey1,token2:syncKey2'
		if (config?.friendsTokensPairs) {
			for (const pair of config.friendsTokensPairs.split(',')) {
				const [tok, key] = pair.split(':');
				if (tok && key) {
					const cleanKey = key.trim();
					const accountId = identityFromSyncKey(cleanKey).accountId;
					this.staticTokens.set(tok.trim(), { accountId, syncKey: cleanKey });
				}
			}
		}
	}

	getOAuthManager(): OAuthManager {
		return this.oauthManager;
	}

	resolveToken(token: string): ResolvedAccount | null {
		const clean = token.trim();
		// Check static tokens first
		const staticAccount = this.staticTokens.get(clean);
		if (staticAccount) return staticAccount;

		// Check OAuth tokens
		return this.oauthManager.resolveToken(clean);
	}
}
