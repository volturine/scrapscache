import { describe, expect, it } from 'vitest';
import { McpApp } from '../src/app.js';
import { TokenStore } from '../src/tokenStore.js';
import { OAuthManager } from '../src/oauth.js';
import { bytesToBase64Url, randomBytes, sha256Base64Url } from '../src/crypto.js';

describe('MCP App HTTP endpoints and JSON-RPC dispatch', () => {
	const syncKey = bytesToBase64Url(randomBytes(32));
	const bearerToken = 'test-static-bearer-token';

	const oauthManager = new OAuthManager();
	const tokenStore = new TokenStore(oauthManager, {
		defaultSyncKey: syncKey,
		bearerToken
	});

	const app = new McpApp({
		scrapscacheUrl: 'https://scrapscache.com',
		defaultSyncKey: syncKey,
		tokenStore
	});

	it('responds to CORS preflight options request', async () => {
		const req = new Request('http://localhost:3001/mcp', {
			method: 'OPTIONS'
		});
		const res = await app.handleRequest(req);
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
	});

	it('responds to /health check', async () => {
		const req = new Request('http://localhost:3001/health');
		const res = await app.handleRequest(req);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { status: string };
		expect(data.status).toBe('healthy');
	});

	it('serves RFC 8414 OAuth authorization server metadata', async () => {
		const req = new Request('http://localhost:3001/.well-known/oauth-authorization-server');
		const res = await app.handleRequest(req);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { issuer: string; token_endpoint: string };
		expect(data.issuer).toBe('http://localhost:3001');
		expect(data.token_endpoint).toBe('http://localhost:3001/oauth/token');
	});

	it('rejects unauthenticated MCP requests with 401', async () => {
		const req = new Request('http://localhost:3001/mcp', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
		});
		const res = await app.handleRequest(req);
		expect(res.status).toBe(401);
		expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
	});

	it('accepts authenticated MCP requests via Bearer token and responds to JSON-RPC', async () => {
		// Test initialize
		const initReq = new Request('http://localhost:3001/mcp', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${bearerToken}`
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: { protocolVersion: '2025-11-25' }
			})
		});
		const initRes = await app.handleRequest(initReq);
		expect(initRes.status).toBe(200);
		const initData = (await initRes.json()) as {
			result: { serverInfo: { name: string }; capabilities: { tools: object } };
		};
		expect(initData.result.serverInfo.name).toBe('scrapscache-mcp-selfhosted');
		expect(initData.result.capabilities.tools).toBeDefined();

		// Test tools/list
		const toolsReq = new Request('http://localhost:3001/mcp', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${bearerToken}`
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/list'
			})
		});
		const toolsRes = await app.handleRequest(toolsReq);
		expect(toolsRes.status).toBe(200);
		const toolsData = (await toolsRes.json()) as {
			result: { tools: Array<{ name: string }> };
		};
		const toolNames = toolsData.result.tools.map((t) => t.name);
		expect(toolNames).toContain('search_notes');
		expect(toolNames).toContain('create_note');
		expect(toolNames).toContain('read_note');
		expect(toolNames).toContain('update_note');
		expect(toolNames).toContain('list_labels');
	});

	it('serves HTML consent page on GET /oauth/authorize', async () => {
		const verifier = 'my-verifier-12345678901234567890123456789012345';
		const challenge = sha256Base64Url(verifier);

		const req = new Request(
			`http://localhost:3001/oauth/authorize?client_id=claude&redirect_uri=https://claude.ai/api/mcp/auth_callback&response_type=code&state=xyz&code_challenge=${challenge}&code_challenge_method=S256`
		);
		const res = await app.handleRequest(req);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('Connect Claude');
		expect(html).toContain('Authorize Claude');
	});
});

describe('OAuth authorize across isolated workers', () => {
	const secret = 'grok-dev-worker-secret';
	const grokRedirect = 'https://grok.com/connectors-oauth-exchange-code/';
	const challenge = 'm2LSleqpoW4pmF1gZSzdRMXkDhRkoIfc_ITJDrFi_SY';

	function isolatedApp(oauthSecret: string) {
		return new McpApp({
			scrapscacheUrl: 'https://dev.scrapscache.com',
			tokenStore: new TokenStore(new OAuthManager(oauthSecret))
		});
	}

	it('accepts Grok’s cached dynamic client_id on an isolate that never registered it', async () => {
		const url = new URL('http://localhost:3001/oauth/authorize');
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('client_id', 'client_E11z-0dUQT9u');
		url.searchParams.set('redirect_uri', grokRedirect);
		url.searchParams.set(
			'state',
			'264db41a296be048f39b0bc6405abf4c95714ca3846a567494fd3293e825b37b'
		);
		url.searchParams.set('code_challenge', challenge);
		url.searchParams.set('code_challenge_method', 'S256');

		const res = await isolatedApp(secret).handleRequest(new Request(url));
		expect(res.status).toBe(302);
		expect(res.headers.get('Location') || '').toContain(
			'https://dev.scrapscache.com/mcp/authorize'
		);
	});

	it('authorizes a client registered on a different instance that shares MCP_SECRET', async () => {
		const registrar = isolatedApp(secret);
		const authorizer = isolatedApp(secret);
		const reg = await registrar.handleRequest(
			new Request('http://localhost:3001/oauth/register', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					client_name: 'Cursor',
					redirect_uris: ['https://cursor.com/oauth/callback']
				})
			})
		);
		expect(reg.status).toBe(201);
		const body = (await reg.json()) as { client_id: string };

		const url = new URL('http://localhost:3001/oauth/authorize');
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('client_id', body.client_id);
		url.searchParams.set('redirect_uri', 'https://cursor.com/oauth/callback');
		url.searchParams.set('state', 'abc');
		url.searchParams.set('code_challenge', challenge);
		url.searchParams.set('code_challenge_method', 'S256');

		const res = await authorizer.handleRequest(new Request(url));
		expect(res.status).toBe(302);
		expect(res.headers.get('Location') || '').toContain(
			'https://dev.scrapscache.com/mcp/authorize'
		);
	});
});
