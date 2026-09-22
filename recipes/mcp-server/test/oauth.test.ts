import { describe, expect, it } from 'vitest';
import { OAuthManager, WELL_KNOWN_CLIENTS, isRedirectAllowed, verifyPkce } from '../src/oauth.js';
import { bytesToBase64Url, randomBytes, sha256Base64Url } from '../src/crypto.js';
import { InMemoryOAuthStateStore } from '../src/oauthState.js';

describe('MCP OAuth 2.1 manager', () => {
	const manager = new OAuthManager('test-mcp-secret-012345678901234567890123456789');

	it('fails closed without an OAuth sealing secret', () => {
		expect(() => new OAuthManager('')).toThrow('MCP_SECRET must be configured');
	});

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
		expect(isRedirectAllowed(chatgpt!, 'https://chatgpt.com/connector/oauth/EqqY7q3ydpMT')).toBe(
			true
		);
		expect(isRedirectAllowed(chatgpt!, 'https://chatgpt.com/connector/oauth/')).toBe(false);
		expect(
			isRedirectAllowed(
				chatgpt!,
				'https://chatgpt.com/connector/oauth/EqqY7q3ydpMT?next=https://evil.example.com'
			)
		).toBe(false);
		expect(
			isRedirectAllowed(chatgpt!, 'https://evil.chatgpt.com/connector/oauth/EqqY7q3ydpMT')
		).toBe(false);

		const hermes = manager.getClient('hermes');
		expect(hermes).not.toBeNull();
		expect(isRedirectAllowed(hermes!, 'http://localhost:8080/callback')).toBe(true);
		expect(isRedirectAllowed(hermes!, 'http://127.0.0.1:43123/callback')).toBe(true);
		expect(isRedirectAllowed(hermes!, 'http://localhost:65536/callback')).toBe(false);
		expect(isRedirectAllowed(hermes!, 'http://localhost:43123/other')).toBe(false);

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

	it.each([
		['Claude', 'https://claude.com/api/mcp/auth_callback'],
		['ChatGPT', 'https://chatgpt.com/connector/oauth/EqqY7q3ydpMT'],
		['Grok', 'https://staging.grok.com/connectors-oauth-exchange-code/'],
		['Perplexity', 'https://enterprise.perplexity.com/rest/connections/oauth_callback'],
		['Hermes Agent', 'http://[::1]:43123/callback']
	])('maps a generated client_id to the %s callback', (name, redirectUri) => {
		const client = manager.getClient('client_generated_by_provider', redirectUri);

		expect(client).toMatchObject({ id: 'client_generated_by_provider', name });
		expect(isRedirectAllowed(client!, redirectUri)).toBe(true);
	});

	it('reconstructs a registered ChatGPT callback on another isolate', () => {
		const redirectUri = 'https://chatgpt.com/connector/oauth/EqqY7q3ydpMT';
		const registered = new OAuthManager('shared-secret').registerClient({
			client_name: 'ChatGPT',
			redirect_uris: [redirectUri]
		});
		const otherIsolate = new OAuthManager('shared-secret');

		expect(otherIsolate.getClient(registered.id, redirectUri)).toEqual(registered);
	});

	it('does not infer a provider for an arbitrary callback', () => {
		expect(
			manager.getClient(
				'client_generated_by_provider',
				'https://assistant.example.com/oauth/callback'
			)
		).toBeNull();
		expect(
			manager.getClient('unregistered-client', 'https://grok.com/connectors-oauth-exchange-code/')
		).toBeNull();
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

	it('shares one-time OAuth state through a shared state store', async () => {
		const sharedSecret = 'test-cluster-shared-secret';
		const stateStore = new InMemoryOAuthStateStore();
		const isolateA = new OAuthManager(sharedSecret, stateStore);
		const isolateB = new OAuthManager(sharedSecret, stateStore);

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
		const sessionA = await isolateA.createAuthSession({
			clientId: registered.id,
			redirectUri: 'https://isolate.example.com/callback',
			state: 'test-state-1',
			codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
			codeChallengeMethod: 'S256'
		});
		const sessionB = await isolateB.consumeAuthSession(sessionA.sessionId);
		expect(sessionB).not.toBeNull();
		expect(sessionB!.clientId).toBe(registered.id);
		expect(sessionB!.mcpPublicKey).toBe(sessionA.mcpPublicKey);

		// 3. Authorization code created on isolate A is exchanged on isolate B
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
		const challenge = sha256Base64Url(verifier);
		const syncKey = bytesToBase64Url(randomBytes(32));
		const accountId = 'acc_isolate_99';

		const codeA = await isolateA.createAuthorizationCode({
			clientId: registered.id,
			redirectUri: 'https://isolate.example.com/callback',
			codeChallenge: challenge,
			syncKey,
			accountId
		});

		const tokenB = await isolateB.exchangeCode({
			code: codeA,
			clientId: registered.id,
			redirectUri: 'https://isolate.example.com/callback',
			codeVerifier: verifier
		});
		expect(tokenB).not.toBeNull();
		expect(tokenB!.accessToken).toMatch(/^sc_mcp_/);

		// 4. Token issued on isolate B is resolved on isolate A
		const resolvedOnA = await isolateA.resolveToken(tokenB!.accessToken);
		expect(resolvedOnA).toMatchObject({ accountId, syncKey });

		// 5. Token refreshed on isolate A is valid on isolate B
		const refreshedOnA = await isolateA.refreshAccessToken(tokenB!.refreshToken);
		expect(refreshedOnA).not.toBeNull();
		const resolvedRefreshedOnB = await isolateB.resolveToken(refreshedOnA!.accessToken);
		expect(resolvedRefreshedOnB).toMatchObject({ accountId, syncKey });
		expect(
			await isolateB.exchangeCode({
				code: codeA,
				clientId: registered.id,
				redirectUri: 'https://isolate.example.com/callback',
				codeVerifier: verifier
			})
		).toBeNull();
	});

	it('runs through full authorization code and token exchange flow', async () => {
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
		const challenge = sha256Base64Url(verifier);

		const syncKey = bytesToBase64Url(randomBytes(32));
		const accountId = 'acc_12345';

		const code = await manager.createAuthorizationCode({
			clientId: 'claude',
			redirectUri: 'https://claude.ai/api/mcp/auth_callback',
			codeChallenge: challenge,
			syncKey,
			accountId
		});

		expect(code).toMatch(/^code_/);

		// Exchange with wrong verifier -> fails
		const badExchange = await manager.exchangeCode({
			code,
			clientId: 'claude',
			redirectUri: 'https://claude.ai/api/mcp/auth_callback',
			codeVerifier: 'incorrect-verifier-123456789012345678901234567890'
		});
		expect(badExchange).toBeNull();

		// Re-create code to test valid exchange
		const validCode = await manager.createAuthorizationCode({
			clientId: 'claude',
			redirectUri: 'https://claude.ai/api/mcp/auth_callback',
			codeChallenge: challenge,
			syncKey,
			accountId
		});

		const token = await manager.exchangeCode({
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
		const resolved = await manager.resolveToken(token!.accessToken);
		expect(resolved).toMatchObject({ accountId, syncKey });

		// Refresh token
		const refreshed = await manager.refreshAccessToken(token!.refreshToken);
		expect(refreshed).not.toBeNull();
		expect(refreshed!.accessToken).not.toBe(token!.accessToken);
		expect(await manager.resolveToken(refreshed!.accessToken)).toMatchObject({
			accountId,
			syncKey
		});
		// Old access token is now invalid
		expect(await manager.resolveToken(token!.accessToken)).toBeNull();
		expect(await manager.refreshAccessToken(token!.refreshToken)).toBeNull();
	});

	it('allows only one concurrent exchange of an authorization code', async () => {
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
		const code = await manager.createAuthorizationCode({
			clientId: 'claude',
			redirectUri: 'https://claude.ai/api/mcp/auth_callback',
			codeChallenge: sha256Base64Url(verifier),
			syncKey: bytesToBase64Url(randomBytes(32)),
			accountId: 'acc_concurrent'
		});
		const request = {
			code,
			clientId: 'claude',
			redirectUri: 'https://claude.ai/api/mcp/auth_callback',
			codeVerifier: verifier
		};

		const results = await Promise.all([
			manager.exchangeCode(request),
			manager.exchangeCode(request)
		]);
		expect(results.filter(Boolean)).toHaveLength(1);
	});
});
