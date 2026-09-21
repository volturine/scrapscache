import { McpApp } from './app.js';
import { TokenStore } from './tokenStore.js';
import { OAuthManager } from './oauth.js';

export interface Env {
	SCRAPSCACHE_URL?: string;
	SCRAPSCACHE_SYNC_KEY?: string;
	MCP_BEARER_TOKEN?: string;
	MCP_FRIENDS_TOKENS?: string;
	MCP_SECRET?: string;
}

let cachedApp: McpApp | null = null;
let lastSyncKey: string | undefined = undefined;

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const syncKey = env.SCRAPSCACHE_SYNC_KEY;
		if (!cachedApp || lastSyncKey !== syncKey) {
			const secret = env.MCP_SECRET || env.SCRAPSCACHE_SYNC_KEY || env.MCP_BEARER_TOKEN;
			const oauthManager = new OAuthManager(secret);
			const tokenStore = new TokenStore(oauthManager, {
				defaultSyncKey: syncKey,
				bearerToken: env.MCP_BEARER_TOKEN,
				friendsTokensJson: env.MCP_FRIENDS_TOKENS
			});

			cachedApp = new McpApp({
				scrapscacheUrl: env.SCRAPSCACHE_URL || 'https://scrapscache.com',
				defaultSyncKey: syncKey,
				tokenStore
			});
			lastSyncKey = syncKey;
		}

		return cachedApp.handleRequest(request);
	}
};
