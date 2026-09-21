import { TokenStore } from './tokenStore.js';
import { ScrapscacheSyncClient } from './syncClient.js';
import { McpSession } from './engine.js';
import { handleJsonRpcMessage } from './protocol.js';
import { isRedirectAllowed, isPkceChallenge } from './oauth.js';
import { renderConsentHtml } from './consentPage.js';
import { identityFromSyncKey, decryptHandshakePayload } from './crypto.js';

export type AppConfig = {
	scrapscacheUrl: string;
	defaultSyncKey?: string;
	tokenStore: TokenStore;
};

export class McpApp {
	private readonly config: AppConfig;
	private readonly sessions = new Map<string, McpSession>();

	constructor(config: AppConfig) {
		this.config = config;
	}

	private getSession(accountId: string, syncKey: string): McpSession {
		let session = this.sessions.get(accountId);
		if (!session) {
			const client = new ScrapscacheSyncClient(this.config.scrapscacheUrl, syncKey);
			session = new McpSession(client);
			this.sessions.set(accountId, session);
		}
		return session;
	}

	private authenticate(req: Request): { accountId: string; syncKey: string } | null {
		const authHeader = req.headers.get('Authorization') || '';
		let token = '';
		if (authHeader.startsWith('Bearer ')) {
			token = authHeader.slice(7).trim();
		} else {
			const url = new URL(req.url);
			token = url.searchParams.get('token') || '';
		}

		if (!token) return null;
		return this.config.tokenStore.resolveToken(token);
	}

	async handleRequest(req: Request): Promise<Response> {
		return this.fetch(req);
	}

	async fetch(req: Request): Promise<Response> {
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
			const baseUrl = url.origin;
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
			const baseUrl = url.origin;
			return new Response(
				JSON.stringify({
					resource: baseUrl,
					authorization_servers: [baseUrl],
					scopes_supported: ['mcp'],
					bearer_methods_supported: ['header', 'query']
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
			);
		}

		// 4. Dynamic Client Registration (RFC 7591)
		if (pathname === '/oauth/register' && req.method === 'POST') {
			try {
				const body = (await req.json()) as { client_name?: string; redirect_uris?: string[] };
				const client = this.config.tokenStore.getOAuthManager().registerClient(body);
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
			} catch {
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

		// 5. OAuth Authorize (GET: Consent screen or Handshake redirect, POST: Grant)
		if (pathname === '/oauth/authorize') {
			const oauth = this.config.tokenStore.getOAuthManager();

			if (req.method === 'GET') {
				const clientId = url.searchParams.get('client_id') || '';
				const redirectUri = url.searchParams.get('redirect_uri') || '';
				const state = url.searchParams.get('state') || '';
				const codeChallenge = url.searchParams.get('code_challenge') || '';
				const codeChallengeMethod = url.searchParams.get('code_challenge_method') || '';
				const manual = url.searchParams.get('manual') === 'true';

				const client = oauth.getClient(clientId);
				if (!client || !isRedirectAllowed(client, redirectUri)) {
					return new Response('Invalid client_id or unauthorized redirect_uri', { status: 400 });
				}
				if (codeChallengeMethod !== 'S256' || !isPkceChallenge(codeChallenge)) {
					return new Response('Invalid PKCE parameters: S256 required', { status: 400 });
				}

				const hasDefault = Boolean(this.config.defaultSyncKey);
				const shouldHandshake =
					url.searchParams.get('mode') === 'handshake' || (!hasDefault && !manual);

				if (shouldHandshake) {
					const session = oauth.createAuthSession({
						clientId,
						redirectUri,
						state,
						codeChallenge,
						codeChallengeMethod
					});
					const callbackUrl = `${url.origin}/oauth/callback`;
					const scrapscacheUrl = this.config.scrapscacheUrl || 'https://scrapscache.com';
					const authorizeUrl = new URL('/mcp/authorize', scrapscacheUrl);
					authorizeUrl.searchParams.set('session_id', session.sessionId);
					authorizeUrl.searchParams.set('mcp_public_key', session.mcpPublicKey);
					authorizeUrl.searchParams.set('mcp_callback', callbackUrl);
					authorizeUrl.searchParams.set('client_name', client.name);
					return Response.redirect(authorizeUrl.toString(), 302);
				}

				const html = renderConsentHtml({
					clientName: client.name,
					clientId,
					redirectUri,
					state,
					codeChallenge,
					codeChallengeMethod,
					hasDefaultSyncKey: !!this.config.defaultSyncKey
				});
				return new Response(html, {
					status: 200,
					headers: { 'Content-Type': 'text/html; charset=utf-8' }
				});
			}

			if (req.method === 'POST') {
				const formData = await req.formData();
				const action = formData.get('action');
				const clientId = String(formData.get('client_id') || '');
				const redirectUri = String(formData.get('redirect_uri') || '');
				const state = String(formData.get('state') || '');
				const codeChallenge = String(formData.get('code_challenge') || '');
				const customSyncKey = String(formData.get('custom_sync_key') || '').trim();

				const client = oauth.getClient(clientId);
				if (!client || !isRedirectAllowed(client, redirectUri)) {
					return new Response('Invalid client_id or unauthorized redirect_uri', { status: 400 });
				}

				const redirectTarget = new URL(redirectUri);
				if (state) redirectTarget.searchParams.set('state', state);

				if (action === 'deny') {
					redirectTarget.searchParams.set('error', 'access_denied');
					return Response.redirect(redirectTarget.toString(), 302);
				}

				let syncKey = customSyncKey || this.config.defaultSyncKey || '';
				if (!syncKey) {
					const html = renderConsentHtml({
						clientName: client.name,
						clientId,
						redirectUri,
						state,
						codeChallenge,
						codeChallengeMethod: 'S256',
						hasDefaultSyncKey: !!this.config.defaultSyncKey,
						errorMessage: 'A valid Scraps Cache sync key is required to authorize access.'
					});
					return new Response(html, {
						status: 400,
						headers: { 'Content-Type': 'text/html; charset=utf-8' }
					});
				}

				let accountId = '';
				try {
					accountId = identityFromSyncKey(syncKey).accountId;
				} catch {
					const html = renderConsentHtml({
						clientName: client.name,
						clientId,
						redirectUri,
						state,
						codeChallenge,
						codeChallengeMethod: 'S256',
						hasDefaultSyncKey: !!this.config.defaultSyncKey,
						errorMessage: 'The provided sync key is invalid.'
					});
					return new Response(html, {
						status: 400,
						headers: { 'Content-Type': 'text/html; charset=utf-8' }
					});
				}

				const code = oauth.createAuthorizationCode({
					clientId,
					redirectUri,
					codeChallenge,
					syncKey,
					accountId
				});

				redirectTarget.searchParams.set('code', code);
				return Response.redirect(redirectTarget.toString(), 302);
			}
		}

		// 6. OAuth Handshake Callback from Scraps Cache
		if (pathname === '/oauth/callback') {
			const oauth = this.config.tokenStore.getOAuthManager();

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
        card.innerHTML = '<h2 style="color: #ef4444;">Connection Failed</h2><p>' + (err.message || 'Unknown error') + '</p>';
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
					const body = (await req.json()) as {
						sessionId?: string;
						clientPublicKey?: string;
						ciphertext?: string;
						nonce?: string;
						error?: string;
					};

					const session = oauth.consumeAuthSession(body.sessionId || '');
					if (!session) {
						return new Response(
							JSON.stringify({ error: 'Session expired or invalid authorization session' }),
							{ status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
						);
					}

					const redirectTarget = new URL(session.redirectUri);
					if (session.state) redirectTarget.searchParams.set('state', session.state);

					if (body.error) {
						redirectTarget.searchParams.set('error', body.error);
						return new Response(JSON.stringify({ redirectTo: redirectTarget.toString() }), {
							status: 200,
							headers: { 'Content-Type': 'application/json', ...corsHeaders }
						});
					}

					if (!body.clientPublicKey || !body.ciphertext || !body.nonce) {
						return new Response(JSON.stringify({ error: 'Missing encrypted handshake payload' }), {
							status: 400,
							headers: { 'Content-Type': 'application/json', ...corsHeaders }
						});
					}

					let syncKey = '';
					try {
						syncKey = decryptHandshakePayload({
							mcpPrivateKey: session.mcpPrivateKey,
							clientPublicKey: body.clientPublicKey,
							ciphertext: body.ciphertext,
							nonce: body.nonce
						});
					} catch {
						return new Response(JSON.stringify({ error: 'Failed to decrypt handshake payload' }), {
							status: 400,
							headers: { 'Content-Type': 'application/json', ...corsHeaders }
						});
					}

					let accountId = '';
					try {
						accountId = identityFromSyncKey(syncKey).accountId;
					} catch {
						return new Response(
							JSON.stringify({ error: 'Invalid sync key in decrypted payload' }),
							{ status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
						);
					}

					const code = oauth.createAuthorizationCode({
						clientId: session.clientId,
						redirectUri: session.redirectUri,
						codeChallenge: session.codeChallenge,
						syncKey,
						accountId
					});

					redirectTarget.searchParams.set('code', code);
					return new Response(JSON.stringify({ redirectTo: redirectTarget.toString() }), {
						status: 200,
						headers: { 'Content-Type': 'application/json', ...corsHeaders }
					});
				} catch {
					return new Response(
						JSON.stringify({ error: 'Internal error processing handshake callback' }),
						{ status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
					);
				}
			}
		}

		// 7. OAuth Token Exchange
		if (pathname === '/oauth/token' && req.method === 'POST') {
			const oauth = this.config.tokenStore.getOAuthManager();
			let params: Record<string, string> = {};

			const contentType = req.headers.get('Content-Type') || '';
			if (contentType.includes('application/x-www-form-urlencoded')) {
				const form = await req.formData();
				form.forEach((v, k) => {
					params[k] = String(v);
				});
			} else {
				params = (await req.json()) as Record<string, string>;
			}

			const grantType = params.grant_type;
			if (grantType === 'authorization_code') {
				const code = params.code || '';
				const clientId = params.client_id || '';
				const redirectUri = params.redirect_uri || '';
				const codeVerifier = params.code_verifier || '';

				const token = oauth.exchangeCode({
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
						{ status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
					);
				}

				return new Response(
					JSON.stringify({
						access_token: token.accessToken,
						token_type: 'Bearer',
						expires_in: 2592000,
						refresh_token: token.refreshToken,
						scope: 'mcp'
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
				);
			} else if (grantType === 'refresh_token') {
				const refreshToken = params.refresh_token || '';
				const token = oauth.refreshAccessToken(refreshToken);
				if (!token) {
					return new Response(
						JSON.stringify({
							error: 'invalid_grant',
							error_description: 'Invalid or expired refresh token'
						}),
						{ status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
					);
				}
				return new Response(
					JSON.stringify({
						access_token: token.accessToken,
						token_type: 'Bearer',
						expires_in: 2592000,
						refresh_token: token.refreshToken,
						scope: 'mcp'
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
				);
			}

			return new Response(JSON.stringify({ error: 'unsupported_grant_type' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json', ...corsHeaders }
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
			const auth = this.authenticate(req);
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

			const session = this.getSession(auth.accountId, auth.syncKey);

			// Streamable HTTP: POST /mcp or /api/mcp or /
			if (
				req.method === 'POST' &&
				(pathname === '/mcp' ||
					pathname === '/api/mcp' ||
					pathname === '/' ||
					pathname === '/messages')
			) {
				try {
					const jsonRpcBody = await req.json();
					const response = await handleJsonRpcMessage(session, jsonRpcBody);
					if (response === null) {
						return new Response(null, { status: 204, headers: corsHeaders });
					}
					return new Response(JSON.stringify(response), {
						status: 200,
						headers: { 'Content-Type': 'application/json', ...corsHeaders }
					});
				} catch {
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
				const stream = new ReadableStream({
					start(controller) {
						if (pathname === '/sse') {
							controller.enqueue(
								encoder.encode(`event: endpoint\ndata: ${url.origin}/messages\n\n`)
							);
						}
						const unsubscribe = session.addSseListener((event, data) => {
							controller.enqueue(
								encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
							);
						});
						const timer = setInterval(() => {
							try {
								controller.enqueue(encoder.encode(': ping\n\n'));
							} catch {
								clearInterval(timer);
							}
						}, 15000);
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
