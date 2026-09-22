import http from 'node:http';
import { MAX_HTTP_BODY_BYTES, McpApp } from './app.js';
import { TokenStore } from './tokenStore.js';
import { OAuthManager } from './oauth.js';
import { InMemoryOAuthStateStore } from './oauthState.js';
import { requireRuntimeSecrets } from './config.js';

const SCRAPSCACHE_URL = process.env.SCRAPSCACHE_URL || 'https://scrapscache.com';
const SCRAPSCACHE_SYNC_KEY = process.env.SCRAPSCACHE_SYNC_KEY;
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
const MCP_FRIENDS_TOKENS = process.env.MCP_FRIENDS_TOKENS;
const MCP_SECRET = requireRuntimeSecrets(process.env);
const PORT = Number(process.env.MCP_PORT || process.env.PORT || 3001);
const BIND_ADDRESS = process.env.MCP_BIND_ADDRESS || '127.0.0.1';

const oauthManager = new OAuthManager(MCP_SECRET, new InMemoryOAuthStateStore());
const tokenStore = new TokenStore(oauthManager, {
	syncKey: SCRAPSCACHE_SYNC_KEY,
	bearerToken: MCP_BEARER_TOKEN,
	friendsTokensJson: MCP_FRIENDS_TOKENS
});

const app = new McpApp({
	scrapscacheUrl: SCRAPSCACHE_URL,
	tokenStore,
	publicOrigin: process.env.MCP_PUBLIC_ORIGIN
});

const server = http.createServer(
	async (nodeReq: http.IncomingMessage, nodeRes: http.ServerResponse) => {
		try {
			const host = nodeReq.headers.host || `localhost:${PORT}`;
			const protocol = nodeReq.headers['x-forwarded-proto'] || 'http';
			const configuredOrigin = process.env.MCP_PUBLIC_ORIGIN?.trim().replace(/\/$/, '');
			const url = `${configuredOrigin || `${protocol}://${host}`}${nodeReq.url || '/'}`;

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
				const declaredLength = Number(nodeReq.headers['content-length'] || 0);
				if (declaredLength > MAX_HTTP_BODY_BYTES) {
					nodeReq.resume();
					nodeRes.statusCode = 413;
					nodeRes.setHeader('Content-Type', 'application/json');
					nodeRes.end(JSON.stringify({ error: 'Request body is too large' }));
					return;
				}
				const chunks: Buffer[] = [];
				let total = 0;
				for await (const chunk of nodeReq) {
					const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
					total += buffer.byteLength;
					if (total > MAX_HTTP_BODY_BYTES) {
						nodeReq.resume();
						nodeRes.statusCode = 413;
						nodeRes.setHeader('Content-Type', 'application/json');
						nodeRes.end(JSON.stringify({ error: 'Request body is too large' }));
						return;
					}
					chunks.push(buffer);
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
			const cancelResponse = () => {
				reader.cancel().catch(() => {});
			};
			nodeReq.on('close', cancelResponse);
			nodeRes.on('close', cancelResponse);

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

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, BIND_ADDRESS, () => {
	console.log(`[McpServer] Self-hosted MCP server running on ${BIND_ADDRESS}:${PORT}`);
	console.log(`[McpServer] Upstream Scraps Cache relay: ${SCRAPSCACHE_URL}`);
	if (MCP_BEARER_TOKEN) {
		console.log('[McpServer] Static Bearer token enabled.');
	}
});
