import { McpApp } from './app.js';
import { TokenStore } from './tokenStore.js';
import { OAuthManager } from './oauth.js';
import { DurableOAuthStateStore, McpOAuthState } from './oauthState.js';
import { validateRuntimeSecrets } from './config.js';

export interface Env {
	SCRAPSCACHE_URL?: string;
	SCRAPSCACHE_SYNC_KEY?: string;
	MCP_BEARER_TOKEN?: string;
	MCP_FRIENDS_TOKENS?: string;
	MCP_SECRET?: string;
	MCP_PUBLIC_ORIGIN?: string;
	OAUTH_STATE?: DurableObjectNamespaceLike;
}

interface DurableObjectNamespaceLike {
	idFromName(name: string): { toString(): string };
	get(id: { toString(): string }): {
		fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
	};
}

let cachedApp: McpApp | null = null;
let lastConfigFingerprint: string | undefined;

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (validateRuntimeSecrets(env)) {
			return new Response(JSON.stringify({ error: 'MCP server is not configured' }), {
				status: 503,
				headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
			});
		}
		if (!env.OAUTH_STATE) {
			return new Response(JSON.stringify({ error: 'MCP OAuth state store is not configured' }), {
				status: 503,
				headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
			});
		}

		const syncKey = env.SCRAPSCACHE_SYNC_KEY;
		const fingerprint = [
			env.SCRAPSCACHE_URL || 'https://scrapscache.com',
			env.SCRAPSCACHE_SYNC_KEY || '',
			env.MCP_BEARER_TOKEN || '',
			env.MCP_FRIENDS_TOKENS || '',
			env.MCP_SECRET,
			env.MCP_PUBLIC_ORIGIN || ''
		].join('\0');
		if (!cachedApp || lastConfigFingerprint !== fingerprint) {
			cachedApp?.dispose();
			cachedApp = new McpApp({
				scrapscacheUrl: env.SCRAPSCACHE_URL || 'https://scrapscache.com',
				publicOrigin: env.MCP_PUBLIC_ORIGIN
			});
			lastConfigFingerprint = fingerprint;
		}

		// Durable Object stubs belong to the request that created them. Never keep
		// one in the cached app across OAuth redirects or later MCP requests.
		const stateId = env.OAUTH_STATE.idFromName('global-oauth-state-v1');
		const stateStore = new DurableOAuthStateStore(env.OAUTH_STATE.get(stateId));
		const oauthManager = new OAuthManager(env.MCP_SECRET!, stateStore);
		const tokenStore = new TokenStore(oauthManager, {
			syncKey,
			bearerToken: env.MCP_BEARER_TOKEN,
			friendsTokensJson: env.MCP_FRIENDS_TOKENS
		});
		return cachedApp.handleRequest(request, tokenStore);
	}
};

export { McpOAuthState };
