import { TokenStore } from './tokenStore.js';
import { ScrapscacheSyncClient } from './syncClient.js';
import { McpSession } from './engine.js';
import { handleJsonRpcMessage } from './protocol.js';
import { isRedirectAllowed, isPkceChallenge } from './oauth.js';
import { renderConsentHtml } from './consentPage.js';
import { identityFromSyncKey } from './crypto.js';

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
		const url = new URL(req.url);
		const pathname = url.pathname;

		// 1. CORS preflight
		if (req.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version',
					'Access-Control-Max-Age': '86400'
				}
			});
		}

		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version'
		};

		// 2. Health check
		if (pathname === '/health') {
			return new Response(
				JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json', ...corsHeaders }
				}
			);
		}

		// 3. OAuth Metadata
		if (
			pathname === '/.well-known/oauth-authorization-server' ||
			pathname === '/.well-known/oauth-protected-resource'
		) {
			const origin = url.origin;
			return new Response(
				JSON.stringify({
					issuer: origin,
					authorization_endpoint: `${origin}/oauth/authorize`,
					token_endpoint: `${origin}/oauth/token`,
					registration_endpoint: `${origin}/oauth/register`,
					response_types_supported: ['code'],
					grant_types_supported: ['authorization_code', 'refresh_token'],
					code_challenge_methods_supported: ['S256'],
					scopes_supported: ['mcp'],
					token_endpoint_auth_methods_supported: ['none'],
					resource: `${origin}/mcp`
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json', ...corsHeaders }
				}
			);
		}

		// 4. OAuth Dynamic Client Registration
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

		// 5. OAuth Authorize (GET: Consent screen, POST: Grant)
		if (pathname === '/oauth/authorize') {
			const oauth = this.config.tokenStore.getOAuthManager();

			if (req.method === 'GET') {
				const clientId = url.searchParams.get('client_id') || '';
				const redirectUri = url.searchParams.get('redirect_uri') || '';
				const state = url.searchParams.get('state') || '';
				const codeChallenge = url.searchParams.get('code_challenge') || '';
				const codeChallengeMethod = url.searchParams.get('code_challenge_method') || '';

				const client = oauth.getClient(clientId);
				if (!client || !isRedirectAllowed(client, redirectUri)) {
					return new Response('Invalid client_id or unauthorized redirect_uri', { status: 400 });
				}
				if (codeChallengeMethod !== 'S256' || !isPkceChallenge(codeChallenge)) {
					return new Response('Invalid PKCE parameters: S256 required', { status: 400 });
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

		// 6. OAuth Token Exchange
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

		// 7. MCP Authentication Check for /mcp, /sse, /messages
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
						// Send endpoint notification if legacy SSE
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
						// Keepalive ping every 15s
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
