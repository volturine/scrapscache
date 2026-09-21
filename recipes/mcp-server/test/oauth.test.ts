import { describe, expect, it } from 'vitest';
import { OAuthManager, WELL_KNOWN_CLIENTS, isRedirectAllowed, verifyPkce } from '../src/oauth.js';
import { sha256Base64Url, randomOpaqueId } from '../src/crypto.js';

describe('MCP OAuth 2.1 manager', () => {
	const manager = new OAuthManager();

	it('contains pre-configured clients with strict redirect matching', () => {
		const claude = manager.getClient('claude');
		expect(claude).not.toBeNull();
		expect(isRedirectAllowed(claude!, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
		expect(isRedirectAllowed(claude!, 'https://evil.example.com')).toBe(false);

		const chatgpt = manager.getClient('chatgpt');
		expect(chatgpt).not.toBeNull();
		expect(
			isRedirectAllowed(chatgpt!, 'https://chatgpt.com/connector_platform_oauth_redirect')
		).toBe(true);
		expect(
			isRedirectAllowed(chatgpt!, 'https://chatgpt.com/connector/oauth/custom_action_123')
		).toBe(true);

		const hermes = manager.getClient('hermes');
		expect(hermes).not.toBeNull();
		expect(isRedirectAllowed(hermes!, 'http://localhost:8080/callback')).toBe(true);

		// Grok matches by id or redirect uri
		const grok = manager.getClient('grok');
		expect(grok).not.toBeNull();
		expect(isRedirectAllowed(grok!, 'https://grok.com/connectors-oauth-exchange-code/')).toBe(true);
		expect(isRedirectAllowed(grok!, 'https://grok.com/connectors-oauth-exchange-code')).toBe(true);
	});

	it('identifies Grok by redirect_uri even with dynamic client_id', () => {
		const grokUri = 'https://grok.com/connectors-oauth-exchange-code/';
		const client = manager.getClient('client_E11z-0dUQT9u', grokUri);
		expect(client).not.toBeNull();
		expect(client!.name).toBe('Grok');
		expect(isRedirectAllowed(client!, grokUri)).toBe(true);
	});

	it('verifies PKCE challenges accurately', () => {
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
		const challenge = sha256Base64Url(verifier);

		expect(verifyPkce(verifier, challenge)).toBe(true);
		expect(verifyPkce('wrong-verifier-value-which-does-not-match-challenge', challenge)).toBe(
			false
		);
	});

	it('supports dynamic client registration', () => {
		const newClient = manager.registerClient({
			client_name: 'Custom AI Assistant',
			redirect_uris: ['https://assistant.example.com/oauth/callback']
		});

		expect(newClient.id).toMatch(/^client_/);
		expect(newClient.name).toBe('Custom AI Assistant');
		expect(manager.getClient(newClient.id)).toEqual(newClient);
	});

	it('works statelessly across isolated instances with shared secret', () => {
		const sharedSecret = 'test-cluster-shared-secret';
		const isolateA = new OAuthManager(sharedSecret);
		const isolateB = new OAuthManager(sharedSecret);

		// 1. Dynamic client registered on isolate A is recognized on isolate B
		const registered = isolateA.registerClient({
			client_name: 'Isolate Client',
			redirect_uris: ['https://isolate.example.com/callback']
		});
		const retrievedOnB = isolateB.getClient(registered.id);
		expect(retrievedOnB).not.toBeNull();
		expect(retrievedOnB!.name).toBe('Isolate Client');
		expect(isRedirectAllowed(retrievedOnB!, 'https://isolate.example.com/callback')).toBe(true);

		// 2. Auth session created on isolate A is consumed on isolate B
		const sessionA = isolateA.createAuthSession({
			clientId: registered.id,
			redirectUri: 'https://isolate.example.com/callback',
			state: 'test-state-1',
			codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
			codeChallengeMethod: 'S256'
		});
		const sessionB = isolateB.consumeAuthSession(sessionA.sessionId);
		expect(sessionB).not.toBeNull();
		expect(sessionB!.clientId).toBe(registered.id);
		expect(sessionB!.mcpPublicKey).toBe(sessionA.mcpPublicKey);

		// 3. Authorization code created on isolate A is exchanged on isolate B
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
		const challenge = sha256Base64Url(verifier);
		const syncKey = '3i7W-s8rafDgu4HT8HD5xQ';
		const accountId = 'acc_isolate_99';

		const codeA = isolateA.createAuthorizationCode({
			clientId: registered.id,
			redirectUri: 'https://isolate.example.com/callback',
			codeChallenge: challenge,
			syncKey,
			accountId
		});

		const tokenB = isolateB.exchangeCode({
			code: codeA,
			clientId: registered.id,
			redirectUri: 'https://isolate.example.com/callback',
			codeVerifier: verifier
		});
		expect(tokenB).not.toBeNull();
		expect(tokenB!.accessToken).toMatch(/^sc_mcp_/);

		// 4. Token issued on isolate B is resolved on isolate A
		const resolvedOnA = isolateA.resolveToken(tokenB!.accessToken);
		expect(resolvedOnA).toMatchObject({ accountId, syncKey });

		// 5. Token refreshed on isolate A is valid on isolate B
		const refreshedOnA = isolateA.refreshAccessToken(tokenB!.refreshToken);
		expect(refreshedOnA).not.toBeNull();
		const resolvedRefreshedOnB = isolateB.resolveToken(refreshedOnA!.accessToken);
		expect(resolvedRefreshedOnB).toMatchObject({ accountId, syncKey });
	});

	it('runs through full authorization code and token exchange flow', () => {
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
		const challenge = sha256Base64Url(verifier);

		const syncKey = randomOpaqueId();
		const accountId = 'acc_12345';

		const code = manager.createAuthorizationCode({
			clientId: 'claude',
			redirectUri: 'https://claude.ai/api/mcp/auth_callback',
			codeChallenge: challenge,
			syncKey,
			accountId
		});

		expect(code).toMatch(/^code_/);

		// Exchange with wrong verifier -> fails
		const badExchange = manager.exchangeCode({
			code,
			clientId: 'claude',
			redirectUri: 'https://claude.ai/api/mcp/auth_callback',
			codeVerifier: 'incorrect-verifier-123456789012345678901234567890'
		});
		expect(badExchange).toBeNull();

		// Re-create code to test valid exchange
		const validCode = manager.createAuthorizationCode({
			clientId: 'claude',
			redirectUri: 'https://claude.ai/api/mcp/auth_callback',
			codeChallenge: challenge,
			syncKey,
			accountId
		});

		const token = manager.exchangeCode({
			code: validCode,
			clientId: 'claude',
			redirectUri: 'https://claude.ai/api/mcp/auth_callback',
			codeVerifier: verifier
		});

		expect(token).not.toBeNull();
		expect(token!.accessToken).toMatch(/^sc_mcp_/);
		expect(token!.refreshToken).toMatch(/^sc_ref_/);
		expect(token!.syncKey).toBe(syncKey);
		expect(token!.accountId).toBe(accountId);

		// Resolve token
		const resolved = manager.resolveToken(token!.accessToken);
		expect(resolved).toMatchObject({ accountId, syncKey });

		// Refresh token
		const refreshed = manager.refreshAccessToken(token!.refreshToken);
		expect(refreshed).not.toBeNull();
		expect(refreshed!.accessToken).not.toBe(token!.accessToken);
		expect(manager.resolveToken(refreshed!.accessToken)).toMatchObject({ accountId, syncKey });
		// Old access token is now invalid
		expect(manager.resolveToken(token!.accessToken)).toBeNull();
	});
});
