import http from 'node:http';
import { McpApp } from './app.js';
import { TokenStore } from './tokenStore.js';
import { OAuthManager } from './oauth.js';

const SCRAPSCACHE_URL = process.env.SCRAPSCACHE_URL || 'https://scrapscache.com';
const SCRAPSCACHE_SYNC_KEY = process.env.SCRAPSCACHE_SYNC_KEY;
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
const MCP_FRIENDS_TOKENS = process.env.MCP_FRIENDS_TOKENS;
const PORT = Number(process.env.MCP_PORT || process.env.PORT || 3001);

const oauthManager = new OAuthManager();
const tokenStore = new TokenStore(oauthManager, {
	defaultSyncKey: SCRAPSCACHE_SYNC_KEY,
	bearerToken: MCP_BEARER_TOKEN,
	friendsTokensJson: MCP_FRIENDS_TOKENS
});

const app = new McpApp({
	scrapscacheUrl: SCRAPSCACHE_URL,
	defaultSyncKey: SCRAPSCACHE_SYNC_KEY,
	tokenStore
});

const server = http.createServer(
	async (nodeReq: http.IncomingMessage, nodeRes: http.ServerResponse) => {
		try {
			const host = nodeReq.headers.host || `localhost:${PORT}`;
			const protocol = nodeReq.headers['x-forwarded-proto'] || 'http';
			const url = `${protocol}://${host}${nodeReq.url}`;

			const headers = new Headers();
			for (const [key, value] of Object.entries(nodeReq.headers)) {
				if (Array.isArray(value)) {
					for (const item of value) headers.append(key, item);
				} else if (value !== undefined) {
					headers.set(key, String(value));
				}
			}

			let body: Uint8Array | undefined;
			if (nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD') {
				const chunks: Buffer[] = [];
				for await (const chunk of nodeReq) {
					chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
				}
				body = Buffer.concat(chunks);
			}

			const request = new Request(url, {
				method: nodeReq.method,
				headers,
				body: body ? (body as unknown as BodyInit) : undefined
			});

			const response = await app.handleRequest(request);

			nodeRes.statusCode = response.status;
			response.headers.forEach((val, key) => {
				nodeRes.setHeader(key, val);
			});

			if (!response.body) {
				nodeRes.end();
				return;
			}

			const reader = response.body.getReader();
			nodeReq.on('close', () => {
				reader.cancel().catch(() => {});
			});

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				nodeRes.write(value);
			}
			nodeRes.end();
		} catch (err) {
			console.error('[McpServer] Error handling request:', err);
			if (!nodeRes.headersSent) {
				nodeRes.statusCode = 500;
				nodeRes.setHeader('Content-Type', 'application/json');
				nodeRes.end(JSON.stringify({ error: 'Internal Server Error' }));
			}
		}
	}
);

server.listen(PORT, () => {
	console.log(`[McpServer] Self-hosted MCP server running on port ${PORT}`);
	console.log(`[McpServer] Upstream Scraps Cache relay: ${SCRAPSCACHE_URL}`);
	if (SCRAPSCACHE_SYNC_KEY) {
		console.log('[McpServer] Default sync key loaded for single-tenant / self access.');
	}
	if (MCP_BEARER_TOKEN) {
		console.log('[McpServer] Static Bearer token enabled.');
	}
});
