import { describe, expect, it } from 'vitest';
import { McpApp } from '../src/app.js';
import { TokenStore } from '../src/tokenStore.js';
import { OAuthManager } from '../src/oauth.js';
import {
	bytesToBase64Url,
	randomBytes,
	sha256Base64Url,
	base64UrlToBytes,
	sha256
} from '../src/crypto.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

describe('Scraps Cache automated OAuth handshake (zero manual token / sync key)', () => {
	it('completes end-to-end zero-configuration onboarding via Scraps Cache handshake', async () => {
		const oauthManager = new OAuthManager('test-mcp-secret-012345678901234567890123456789');
		// Server configured with NO default sync key and NO static bearer token
		const tokenStore = new TokenStore(oauthManager);
		const app = new McpApp({
			scrapscacheUrl: 'https://scrapscache.com',
			tokenStore
		});

		const userSyncKey = bytesToBase64Url(randomBytes(32));
		const verifier = 'my-pkce-verifier-123456789012345678901234567890';
		const challenge = sha256Base64Url(verifier);

		// 1. Claude AI client initiates OAuth request to MCP server
		const initReq = new Request(
			`http://localhost:3001/oauth/authorize?client_id=claude&redirect_uri=https://claude.ai/api/mcp/auth_callback&response_type=code&state=client-state-123&code_challenge=${challenge}&code_challenge_method=S256`
		);
		const initRes = await app.handleRequest(initReq);

		// Must redirect directly to Scraps Cache authorization page
		expect(initRes.status).toBe(302);
		const redirectLocation = initRes.headers.get('Location') || '';
		expect(redirectLocation).toContain('https://scrapscache.com/mcp/authorize');

		const authorizeUrl = new URL(redirectLocation);
		const sessionId = authorizeUrl.searchParams.get('session_id')!;
		const mcpPublicKey = authorizeUrl.searchParams.get('mcp_public_key')!;
		const mcpCallback = authorizeUrl.searchParams.get('mcp_callback')!;
		expect(sessionId).toBeTruthy();
		expect(mcpPublicKey).toBeTruthy();
		expect(mcpCallback).toBe('http://localhost:3001/oauth/callback');

		// 2. User approves in Scraps Cache (simulating client-side encryption in browser)
		const clientPrivateKey = randomBytes(32);
		const clientPublicKey = bytesToBase64Url(x25519.getPublicKey(clientPrivateKey));
		const sharedSecret = x25519.getSharedSecret(clientPrivateKey, base64UrlToBytes(mcpPublicKey));
		const key = sha256(
			new TextEncoder().encode(`scrapscache-mcp-handshake:v1:${bytesToBase64Url(sharedSecret)}`)
		);
		const nonce = randomBytes(24);
		const grant = JSON.stringify({
			v: 1,
			workspaces: [{ name: 'Personal', syncKey: userSyncKey }]
		});
		const ciphertext = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(grant));

		// 3. Browser returns to MCP server callback
		const callbackBody = JSON.stringify({
			sessionId,
			clientPublicKey,
			ciphertext: bytesToBase64Url(ciphertext),
			nonce: bytesToBase64Url(nonce)
		});
		const callbackPostReq = new Request('http://localhost:3001/oauth/callback', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: callbackBody
		});
		const callbackRes = await app.handleRequest(callbackPostReq);
		expect(callbackRes.status).toBe(200);
		expect(callbackRes.headers.get('Cache-Control')).toBe('no-store');
		expect(
			(
				await app.handleRequest(
					new Request('http://localhost:3001/oauth/callback', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: callbackBody
					})
				)
			).status
		).toBe(400);

		const callbackData = (await callbackRes.json()) as { redirectTo: string };
		expect(callbackData.redirectTo).toContain('https://claude.ai/api/mcp/auth_callback');

		const clientCallbackUrl = new URL(callbackData.redirectTo);
		const code = clientCallbackUrl.searchParams.get('code')!;
		expect(code).toBeTruthy();
		expect(clientCallbackUrl.searchParams.get('state')).toBe('client-state-123');

		// 4. Claude AI client exchanges authorization code for access token
		const tokenReq = new Request('http://localhost:3001/oauth/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: 'claude',
				redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
				code,
				code_verifier: verifier
			})
		});
		const tokenRes = await app.handleRequest(tokenReq);
		expect(tokenRes.status).toBe(200);
		expect(tokenRes.headers.get('Cache-Control')).toBe('no-store');

		const tokenData = (await tokenRes.json()) as { access_token: string };
		expect(tokenData.access_token).toMatch(/^sc_mcp_/);

		// 5. Claude AI client makes authenticated JSON-RPC requests to /mcp
		const rpcReq = new Request('http://localhost:3001/mcp', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${tokenData.access_token}`
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list'
			})
		});
		const rpcRes = await app.handleRequest(rpcReq);
		expect(rpcRes.status).toBe(200);
		const rpcData = (await rpcRes.json()) as { result: { tools: unknown[] } };
		expect(rpcData.result.tools.length).toBeGreaterThan(0);

		const workspaceRes = await app.handleRequest(
			new Request('http://localhost:3001/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${tokenData.access_token}`
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/call',
					params: { name: 'list_workspaces', arguments: {} }
				})
			})
		);
		const workspaceData = (await workspaceRes.json()) as {
			result: { content: Array<{ text: string }> };
		};
		expect(JSON.parse(workspaceData.result.content[0].text)).toEqual({
			workspaces: [{ workspace: 'Personal' }]
		});
	});
});
