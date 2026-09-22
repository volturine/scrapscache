import { TokenStore } from './tokenStore.js';
import { ScrapscacheSyncClient } from './syncClient.js';
import { McpSession } from './engine.js';
import { handleJsonRpcMessage } from './protocol.js';
import { isRedirectAllowed, isPkceChallenge, MCP_TOKEN_TTL_MS } from './oauth.js';
import { decryptHandshakePayload } from './crypto.js';
import { parseHandshakeGrant, type GrantedWorkspace } from './grant.js';
import { VaultSession } from './vaults.js';

export const MAX_HTTP_BODY_BYTES = 2 * 1024 * 1024;
const MAX_OAUTH_BODY_BYTES = 128 * 1024;
const MCP_SESSION_IDLE_TTL_MS = 15 * 60 * 1000;
const MAX_MCP_SESSIONS = 256;

export class RequestBodyTooLargeError extends Error {}

async function readBodyText(req: Request, maxBytes: number): Promise<string> {
	const contentLength = req.headers.get('Content-Length');
	if (contentLength) {
		const length = Number(contentLength);
		if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
			throw new RequestBodyTooLargeError('Request body exceeds the configured limit');
		}
	}

	if (!req.body) return '';
	const reader = req.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				throw new RequestBodyTooLargeError('Request body exceeds the configured limit');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

async function readJson<T>(req: Request, maxBytes = MAX_HTTP_BODY_BYTES): Promise<T> {
	return JSON.parse(await readBodyText(req, maxBytes)) as T;
}

async function readOAuthParams(req: Request): Promise<Record<string, string>> {
	const body = await readBodyText(req, MAX_OAUTH_BODY_BYTES);
	const contentType = req.headers.get('Content-Type') || '';
	if (contentType.includes('application/x-www-form-urlencoded')) {
		return Object.fromEntries(new URLSearchParams(body).entries());
	}
	const parsed = JSON.parse(body) as unknown;
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
		throw new Error('Invalid body');
	return Object.fromEntries(
		Object.entries(parsed).map(([key, value]) => [
			key,
			typeof value === 'string' ? value : String(value)
		])
	);
}

function bodyErrorResponse(error: unknown, corsHeaders: Record<string, string>): Response {
	const tooLarge = error instanceof RequestBodyTooLargeError;
	return new Response(
		JSON.stringify({
			error: tooLarge ? 'request_entity_too_large' : 'invalid_request',
			error_description: tooLarge ? 'Request body is too large' : 'Invalid request body'
		}),
		{
			status: tooLarge ? 413 : 400,
			headers: { 'Content-Type': 'application/json', ...corsHeaders }
		}
	);
}

const NO_STORE_HEADERS = {
	'Cache-Control': 'no-store',
	Pragma: 'no-cache'
};

function noStoreRedirect(location: string): Response {
	return new Response(null, {
		status: 302,
		headers: { Location: location, ...NO_STORE_HEADERS }
	});
}

export type AppConfig = {
	scrapscacheUrl: string;
	tokenStore?: TokenStore;
	publicOrigin?: string;
};

export class McpApp {
	private readonly config: AppConfig;
	private readonly sessions = new Map<string, McpSession | VaultSession>();

	constructor(config: AppConfig) {
		const configuredOrigin = config.publicOrigin?.trim();
		if (configuredOrigin) {
			const parsed = new URL(configuredOrigin);
			if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
				throw new Error('MCP_PUBLIC_ORIGIN must be an HTTP(S) origin');
			}
			this.config = { ...config, publicOrigin: parsed.origin };
		} else {
			this.config = config;
		}
	}

	dispose(): void {
		for (const session of this.sessions.values()) session.dispose();
		this.sessions.clear();
	}

	private publicOrigin(req: Request): string {
		return this.config.publicOrigin || new URL(req.url).origin;
	}

	private pruneSessions(protectedKey?: string): void {
		const now = Date.now();
		for (const [key, session] of this.sessions) {
			if (now - session.getLastActiveAt() > MCP_SESSION_IDLE_TTL_MS) {
				session.dispose();
				this.sessions.delete(key);
			}
		}
		while (this.sessions.size >= MAX_MCP_SESSIONS) {
			const oldest = [...this.sessions.entries()]
				.filter(([key]) => key !== protectedKey)
				.sort(([, a], [, b]) => a.getLastActiveAt() - b.getLastActiveAt())[0];
			if (!oldest) break;
			oldest[1].dispose();
			this.sessions.delete(oldest[0]);
		}
	}

	private getSession(
		accountId: string,
		syncKey: string,
		workspaces?: GrantedWorkspace[]
	): McpSession | VaultSession {
		const granted =
			workspaces && workspaces.length > 0
				? workspaces
				: [{ name: 'Workspace', syncKey, accountId }];
		const cacheKey = granted
			.map((workspace) => `${workspace.accountId}:${workspace.name}`)
			.join('\n');
		this.pruneSessions(cacheKey);
		let session = this.sessions.get(cacheKey);
		if (!session) {
			session =
				granted.length > 1
					? new VaultSession(this.config.scrapscacheUrl, granted)
					: new McpSession(
							new ScrapscacheSyncClient(this.config.scrapscacheUrl, granted[0].syncKey),
							granted[0].name
						);
			this.sessions.set(cacheKey, session);
		}
		session.touch();
		return session;
	}

	private async authenticate(
		req: Request,
		tokenStore: TokenStore
	): Promise<{ accountId: string; syncKey: string; workspaces?: GrantedWorkspace[] } | null> {
		const authHeader = req.headers.get('Authorization') || '';
		const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

		if (!token) return null;
		return tokenStore.resolveToken(token);
	}

	async handleRequest(req: Request, tokenStore?: TokenStore): Promise<Response> {
		return this.fetch(req, tokenStore);
	}

	async fetch(req: Request, requestTokenStore?: TokenStore): Promise<Response> {
		const tokenStore = requestTokenStore ?? this.config.tokenStore;
		if (!tokenStore) throw new Error('MCP token store is not configured');
		const url = new URL(req.url);
		const pathname = url.pathname;

		// CORS preflight
		const corsHeaders: Record<string, string> = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
			'Access-Control-Expose-Headers': 'Mcp-Session-Id'
		};

		if (req.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders });
		}

		// 1. Health check
		if (pathname === '/health') {
			return new Response(JSON.stringify({ status: 'healthy', version: '1.0.0' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json', ...corsHeaders }
			});
		}

		// 2. OAuth Authorization Server Metadata (RFC 8414)
		if (pathname === '/.well-known/oauth-authorization-server') {
			const baseUrl = this.publicOrigin(req);
			return new Response(
				JSON.stringify({
					issuer: baseUrl,
					authorization_endpoint: `${baseUrl}/oauth/authorize`,
					token_endpoint: `${baseUrl}/oauth/token`,
					registration_endpoint: `${baseUrl}/oauth/register`,
					response_types_supported: ['code'],
					grant_types_supported: ['authorization_code', 'refresh_token'],
					code_challenge_methods_supported: ['S256'],
					scopes_supported: ['mcp'],
					token_endpoint_auth_methods_supported: ['none']
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
			);
		}

		// 3. MCP OAuth Protected Resource Metadata
		if (pathname === '/.well-known/oauth-protected-resource') {
			const baseUrl = this.publicOrigin(req);
			return new Response(
				JSON.stringify({
					resource: baseUrl,
					authorization_servers: [baseUrl],
					scopes_supported: ['mcp'],
					bearer_methods_supported: ['header']
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
			);
		}

		// 4. Dynamic Client Registration (RFC 7591)
		if (pathname === '/oauth/register' && req.method === 'POST') {
			try {
				const body = await readJson<{ client_name?: string; redirect_uris?: string[] }>(
					req,
					MAX_OAUTH_BODY_BYTES
				);
				const client = tokenStore.getOAuthManager().registerClient(body);
				return new Response(
					JSON.stringify({
						client_id: client.id,
						client_name: client.name,
						redirect_uris: client.redirectUris
					}),
					{
						status: 201,
						headers: { 'Content-Type': 'application/json', ...corsHeaders }
					}
				);
			} catch (error) {
				if (error instanceof RequestBodyTooLargeError) {
					return bodyErrorResponse(error, corsHeaders);
				}
				return new Response(
					JSON.stringify({
						error: 'invalid_request',
						error_description: 'Invalid client registration payload'
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json', ...corsHeaders }
					}
				);
			}
		}

		// 5. OAuth Authorize: always use the authenticated Scraps Cache handshake.
		if (pathname === '/oauth/authorize') {
			const oauth = tokenStore.getOAuthManager();

			if (req.method === 'GET') {
				const clientId = url.searchParams.get('client_id') || '';
				const redirectUri = url.searchParams.get('redirect_uri') || '';
				const state = url.searchParams.get('state') || '';
				const codeChallenge = url.searchParams.get('code_challenge') || '';
				const codeChallengeMethod = url.searchParams.get('code_challenge_method') || '';
				if (
					clientId.length > 256 ||
					redirectUri.length > 2048 ||
					state.length > 1024 ||
					codeChallenge.length > 128
				) {
					return new Response('Invalid authorization request', { status: 400 });
				}

				const client = oauth.getClient(clientId, redirectUri);
				if (!client || !isRedirectAllowed(client, redirectUri)) {
					return new Response('Invalid client_id or unauthorized redirect_uri', { status: 400 });
				}
				if (codeChallengeMethod !== 'S256' || !isPkceChallenge(codeChallenge)) {
					return new Response('Invalid PKCE parameters: S256 required', { status: 400 });
				}

				const session = await oauth.createAuthSession({
					clientId,
					redirectUri,
					state,
					codeChallenge,
					codeChallengeMethod
				});
				const callbackUrl = `${this.publicOrigin(req)}/oauth/callback`;
				const scrapscacheUrl = this.config.scrapscacheUrl || 'https://scrapscache.com';
				const authorizeUrl = new URL('/mcp/authorize', scrapscacheUrl);
				authorizeUrl.searchParams.set('session_id', session.sessionId);
				authorizeUrl.searchParams.set('mcp_public_key', session.mcpPublicKey);
				authorizeUrl.searchParams.set('mcp_callback', callbackUrl);
				authorizeUrl.searchParams.set('client_name', client.name);
				return noStoreRedirect(authorizeUrl.toString());
			}

			return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
		}

		// 6. OAuth Handshake Callback from Scraps Cache
		if (pathname === '/oauth/callback') {
			const oauth = tokenStore.getOAuthManager();

			if (req.method === 'GET') {
				const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connecting to AI Assistant · Scraps Cache MCP</title>
  <style>
    :root { --bg: #0f172a; --card: #1e293b; --text: #f8fafc; --muted: #94a3b8; --border: #334155; }
    @media (prefers-color-scheme: light) { :root { --bg: #f8fafc; --card: #ffffff; --text: #0f172a; --muted: #64748b; --border: #e2e8f0; } }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; max-width: 400px; width: 100%; padding: 2rem; text-align: center; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.2); }
    h2 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { font-size: 0.9rem; color: var(--muted); line-height: 1.5; }
    .spinner { display: inline-block; width: 32px; height: 32px; border: 3px solid var(--border); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 1rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card" id="status-card">
    <div class="spinner"></div>
    <h2>Connecting...</h2>
    <p>Finalizing encrypted handshake with your AI assistant.</p>
  </div>
  <script>
    (async () => {
      const card = document.getElementById('status-card');
      try {
        const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
        const params = new URLSearchParams(hash);
        const sessionId = params.get('session_id') || '';
        const clientPublicKey = params.get('client_public_key') || '';
        const ciphertext = params.get('ciphertext') || '';
        const nonce = params.get('nonce') || '';
        const error = params.get('error') || '';

        if (error) {
          card.innerHTML = '<h2 style="color: #ef4444;">Authorization Cancelled</h2><p>You cancelled the authorization request.</p>';
          return;
        }

        if (!sessionId || !clientPublicKey || !ciphertext || !nonce) {
          throw new Error('Incomplete handshake parameters received in fragment.');
        }

        const res = await fetch('/oauth/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, clientPublicKey, ciphertext, nonce })
        });
        const data = await res.json();
        if (!res.ok || !data.redirectTo) {
          throw new Error(data.error || 'Handshake failed on MCP server.');
        }
        window.location.replace(data.redirectTo);
      } catch (err) {
        card.innerHTML = '<h2 style="color: #ef4444;">Connection Failed</h2><p></p>';
        card.querySelector('p').textContent = err instanceof Error ? err.message : 'Unknown error';
      }
    })();
  </script>
</body>
</html>`;
				return new Response(html, {
					status: 200,
					headers: { 'Content-Type': 'text/html; charset=utf-8' }
				});
			}

			if (req.method === 'POST') {
				try {
					const body = await readJson<{
						sessionId?: string;
						clientPublicKey?: string;
						ciphertext?: string;
						nonce?: string;
						error?: string;
					}>(req, MAX_OAUTH_BODY_BYTES);

					const session = await oauth.consumeAuthSession(body.sessionId || '');
					if (!session) {
						return new Response(
							JSON.stringify({ error: 'Session expired or invalid authorization session' }),
							{
								status: 400,
								headers: { 'Content-Type': 'application/json', ...corsHeaders, ...NO_STORE_HEADERS }
							}
						);
					}

					const redirectTarget = new URL(session.redirectUri);
					if (session.state) redirectTarget.searchParams.set('state', session.state);

					if (body.error) {
						redirectTarget.searchParams.set('error', body.error);
						return new Response(JSON.stringify({ redirectTo: redirectTarget.toString() }), {
							status: 200,
							headers: { 'Content-Type': 'application/json', ...corsHeaders, ...NO_STORE_HEADERS }
						});
					}

					if (!body.clientPublicKey || !body.ciphertext || !body.nonce) {
						return new Response(JSON.stringify({ error: 'Missing encrypted handshake payload' }), {
							status: 400,
							headers: { 'Content-Type': 'application/json', ...corsHeaders, ...NO_STORE_HEADERS }
						});
					}

					let plaintext = '';
					try {
						plaintext = decryptHandshakePayload({
							mcpPrivateKey: session.mcpPrivateKey,
							clientPublicKey: body.clientPublicKey,
							ciphertext: body.ciphertext,
							nonce: body.nonce
						});
					} catch {
						return new Response(JSON.stringify({ error: 'Failed to decrypt handshake payload' }), {
							status: 400,
							headers: { 'Content-Type': 'application/json', ...corsHeaders, ...NO_STORE_HEADERS }
						});
					}

					let granted: GrantedWorkspace[] = [];
					try {
						granted = parseHandshakeGrant(plaintext);
					} catch {
						return new Response(
							JSON.stringify({ error: 'Invalid sync key in decrypted payload' }),
							{
								status: 400,
								headers: { 'Content-Type': 'application/json', ...corsHeaders, ...NO_STORE_HEADERS }
							}
						);
					}

					const code = await oauth.createAuthorizationCode({
						clientId: session.clientId,
						redirectUri: session.redirectUri,
						codeChallenge: session.codeChallenge,
						syncKey: granted[0].syncKey,
						accountId: granted[0].accountId,
						workspaces: granted
					});

					redirectTarget.searchParams.set('code', code);
					return new Response(JSON.stringify({ redirectTo: redirectTarget.toString() }), {
						status: 200,
						headers: { 'Content-Type': 'application/json', ...corsHeaders, ...NO_STORE_HEADERS }
					});
				} catch (error) {
					if (error instanceof RequestBodyTooLargeError) {
						return bodyErrorResponse(error, corsHeaders);
					}
					return new Response(
						JSON.stringify({ error: 'Internal error processing handshake callback' }),
						{
							status: 500,
							headers: { 'Content-Type': 'application/json', ...corsHeaders, ...NO_STORE_HEADERS }
						}
					);
				}
			}
		}

		// 7. OAuth Token Exchange
		if (pathname === '/oauth/token' && req.method === 'POST') {
			const oauth = tokenStore.getOAuthManager();
			let params: Record<string, string>;
			try {
				params = await readOAuthParams(req);
			} catch (error) {
				return bodyErrorResponse(error, { ...corsHeaders, ...NO_STORE_HEADERS });
			}

			const grantType = params.grant_type;
			if (grantType === 'authorization_code') {
				const code = params.code || '';
				const clientId = params.client_id || '';
				const redirectUri = params.redirect_uri || '';
				const codeVerifier = params.code_verifier || '';

				const token = await oauth.exchangeCode({
					code,
					clientId,
					redirectUri,
					codeVerifier
				});

				if (!token) {
					return new Response(
						JSON.stringify({
							error: 'invalid_grant',
							error_description: 'Invalid or expired authorization code'
						}),
						{
							status: 400,
							headers: { 'Content-Type': 'application/json', ...corsHeaders, ...NO_STORE_HEADERS }
						}
					);
				}

				return new Response(
					JSON.stringify({
						access_token: token.accessToken,
						token_type: 'Bearer',
						expires_in: Math.floor(MCP_TOKEN_TTL_MS / 1000),
						refresh_token: token.refreshToken,
						scope: 'mcp'
					}),
					{
						status: 200,
						headers: { 'Content-Type': 'application/json', ...corsHeaders, ...NO_STORE_HEADERS }
					}
				);
			} else if (grantType === 'refresh_token') {
				const refreshToken = params.refresh_token || '';
				const token = await oauth.refreshAccessToken(refreshToken);
				if (!token) {
					return new Response(
						JSON.stringify({
							error: 'invalid_grant',
							error_description: 'Invalid or expired refresh token'
						}),
						{
							status: 400,
							headers: { 'Content-Type': 'application/json', ...corsHeaders, ...NO_STORE_HEADERS }
						}
					);
				}
				return new Response(
					JSON.stringify({
						access_token: token.accessToken,
						token_type: 'Bearer',
						expires_in: Math.floor(MCP_TOKEN_TTL_MS / 1000),
						refresh_token: token.refreshToken,
						scope: 'mcp'
					}),
					{
						status: 200,
						headers: { 'Content-Type': 'application/json', ...corsHeaders, ...NO_STORE_HEADERS }
					}
				);
			}

			return new Response(JSON.stringify({ error: 'unsupported_grant_type' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json', ...corsHeaders, ...NO_STORE_HEADERS }
			});
		}

		// 8. MCP Authentication Check for /mcp, /sse, /messages
		const isMcpRoute =
			pathname === '/mcp' ||
			pathname === '/api/mcp' ||
			pathname === '/' ||
			pathname === '/sse' ||
			pathname === '/messages';

		if (isMcpRoute) {
			let auth: Awaited<ReturnType<McpApp['authenticate']>>;
			try {
				auth = await this.authenticate(req, tokenStore);
			} catch {
				return new Response(JSON.stringify({ error: 'Authentication service unavailable' }), {
					status: 503,
					headers: { 'Content-Type': 'application/json', ...corsHeaders }
				});
			}
			if (!auth) {
				return new Response(
					JSON.stringify({ error: 'Unauthorized: missing or invalid Bearer token' }),
					{
						status: 401,
						headers: {
							'Content-Type': 'application/json',
							'WWW-Authenticate': 'Bearer error="invalid_token"',
							...corsHeaders
						}
					}
				);
			}

			const session = this.getSession(auth.accountId, auth.syncKey, auth.workspaces);

			// Streamable HTTP: POST /mcp or /api/mcp or /
			if (
				req.method === 'POST' &&
				(pathname === '/mcp' ||
					pathname === '/api/mcp' ||
					pathname === '/' ||
					pathname === '/messages')
			) {
				try {
					const jsonRpcBody = await readJson(req);
					const response = await handleJsonRpcMessage(session, jsonRpcBody);
					if (response === null) {
						return new Response(null, { status: 204, headers: corsHeaders });
					}
					return new Response(JSON.stringify(response), {
						status: 200,
						headers: { 'Content-Type': 'application/json', ...corsHeaders }
					});
				} catch (error) {
					if (error instanceof RequestBodyTooLargeError) {
						return bodyErrorResponse(error, corsHeaders);
					}
					return new Response(
						JSON.stringify({
							jsonrpc: '2.0',
							id: null,
							error: { code: -32700, message: 'Parse error: invalid JSON payload' }
						}),
						{ status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
					);
				}
			}

			// SSE Transport: GET /sse or GET /mcp
			if (req.method === 'GET' && (pathname === '/sse' || pathname === '/mcp')) {
				const encoder = new TextEncoder();
				const publicOrigin = this.publicOrigin(req);
				let cleanup = () => {};
				const stream = new ReadableStream({
					start(controller) {
						let closed = false;
						let timer: ReturnType<typeof setInterval> | undefined;
						let unsubscribe = () => {};
						cleanup = () => {
							if (closed) return;
							closed = true;
							if (timer) clearInterval(timer);
							unsubscribe();
						};
						const enqueue = (value: Uint8Array) => {
							if (closed) return;
							try {
								controller.enqueue(value);
							} catch {
								cleanup();
							}
						};
						if (pathname === '/sse') {
							enqueue(encoder.encode(`event: endpoint\ndata: ${publicOrigin}/messages\n\n`));
						}
						if (closed) return;
						unsubscribe = session.addSseListener((event, data) => {
							enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
							if (event === 'close') cleanup();
						});
						timer = setInterval(() => {
							session.touch();
							enqueue(encoder.encode(': ping\n\n'));
						}, 15000);
					},
					cancel() {
						cleanup();
					}
				});

				return new Response(stream, {
					status: 200,
					headers: {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache, no-transform',
						Connection: 'keep-alive',
						...corsHeaders
					}
				});
			}
		}

		return new Response('Not Found', { status: 404, headers: corsHeaders });
	}
}
