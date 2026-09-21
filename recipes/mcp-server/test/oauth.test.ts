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
		expect(resolved).toEqual({ accountId, syncKey });

		// Refresh token
		const refreshed = manager.refreshAccessToken(token!.refreshToken);
		expect(refreshed).not.toBeNull();
		expect(refreshed!.accessToken).not.toBe(token!.accessToken);
		expect(manager.resolveToken(refreshed!.accessToken)).toEqual({ accountId, syncKey });
		// Old access token is now invalid
		expect(manager.resolveToken(token!.accessToken)).toBeNull();
	});
});
