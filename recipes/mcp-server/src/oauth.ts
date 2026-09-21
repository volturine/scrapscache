import { sha256Base64Url, randomOpaqueId, createHandshakeKeyPair } from './crypto.js';

export const MCP_OAUTH_SCOPE = 'mcp';
export const MCP_OAUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MCP_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type OAuthClientInfo = {
	id: string;
	name: string;
	redirectUris: string[];
	clientSecret?: string;
};

const CHATGPT_CONNECTOR_RE = /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]+$/;
const HERMES_LOOPBACK_RE = /^http:\/\/(?:127\.0\.0\.1|localhost):([1-9][0-9]{0,4})\/callback$/;

export const WELL_KNOWN_CLIENTS: OAuthClientInfo[] = [
	{
		id: 'claude',
		name: 'Claude',
		redirectUris: ['https://claude.ai/api/mcp/auth_callback']
	},
	{
		id: 'chatgpt',
		name: 'ChatGPT',
		redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect']
	},
	{
		id: 'grok',
		name: 'Grok',
		redirectUris: ['https://grok.com/connectors-oauth-exchange-code/']
	},
	{
		id: 'perplexity',
		name: 'Perplexity',
		redirectUris: [
			'https://www.perplexity.ai/rest/connections/oauth_callback',
			'https://www.perplexity.com/rest/connections/oauth_callback',
			'https://enterprise.perplexity.ai/rest/connections/oauth_callback',
			'https://enterprise.perplexity.com/rest/connections/oauth_callback',
			'https://staging.perplexity.ai/rest/connections/oauth_callback'
		]
	},
	{
		id: 'hermes',
		name: 'Hermes Agent',
		redirectUris: ['http://localhost:8080/callback', 'http://127.0.0.1:8080/callback']
	}
];

export function isRedirectAllowed(client: OAuthClientInfo, uri: string): boolean {
	if (client.redirectUris.includes(uri)) return true;
	if (client.id === 'chatgpt' && CHATGPT_CONNECTOR_RE.test(uri)) return true;
	if (client.id === 'hermes') {
		const match = HERMES_LOOPBACK_RE.exec(uri);
		if (match && Number(match[1]) <= 65535) return true;
	}
	return false;
}

export function isPkceChallenge(value: string): boolean {
	return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function isPkceVerifier(value: string): boolean {
	return /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

export function verifyPkce(verifier: string, challenge: string): boolean {
	if (!isPkceVerifier(verifier) || !isPkceChallenge(challenge)) return false;
	const computed = sha256Base64Url(verifier);
	return computed === challenge;
}

export type StoredOAuthCode = {
	code: string;
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	syncKey: string;
	accountId: string;
	expiresAt: number;
};

export type StoredOAuthToken = {
	accessToken: string;
	refreshToken: string;
	clientId: string;
	syncKey: string;
	accountId: string;
	expiresAt: number;
};

export type EphemeralAuthSession = {
	sessionId: string;
	clientId: string;
	redirectUri: string;
	state: string;
	codeChallenge: string;
	codeChallengeMethod: string;
	mcpPrivateKey: Uint8Array;
	mcpPublicKey: string;
	expiresAt: number;
};

export class OAuthManager {
	private readonly clients = new Map<string, OAuthClientInfo>();
	private readonly codes = new Map<string, StoredOAuthCode>();
	private readonly tokens = new Map<string, StoredOAuthToken>();
	private readonly refreshTokens = new Map<string, string>(); // refreshToken -> accessToken
	private readonly authSessions = new Map<string, EphemeralAuthSession>();

	constructor() {
		for (const client of WELL_KNOWN_CLIENTS) {
			this.clients.set(client.id, client);
		}
	}

	registerClient(registration: {
		client_name?: string;
		redirect_uris?: string[];
	}): OAuthClientInfo {
		const id = `client_${randomOpaqueId().slice(0, 12)}`;
		const client: OAuthClientInfo = {
			id,
			name: registration.client_name || 'AI Assistant',
			redirectUris: registration.redirect_uris || []
		};
		this.clients.set(id, client);
		return client;
	}

	getClient(clientId: string): OAuthClientInfo | null {
		return this.clients.get(clientId) ?? null;
	}

	createAuthSession(params: {
		clientId: string;
		redirectUri: string;
		state: string;
		codeChallenge: string;
		codeChallengeMethod: string;
		now?: number;
		ttlMs?: number;
	}): EphemeralAuthSession {
		const now = params.now ?? Date.now();
		const sessionId = `auth_${randomOpaqueId()}`;
		const { privateKey, publicKey } = createHandshakeKeyPair();
		const session: EphemeralAuthSession = {
			sessionId,
			clientId: params.clientId,
			redirectUri: params.redirectUri,
			state: params.state,
			codeChallenge: params.codeChallenge,
			codeChallengeMethod: params.codeChallengeMethod,
			mcpPrivateKey: privateKey,
			mcpPublicKey: publicKey,
			expiresAt: now + (params.ttlMs ?? 10 * 60 * 1000)
		};
		this.authSessions.set(sessionId, session);
		return session;
	}

	getAuthSession(sessionId: string, now = Date.now()): EphemeralAuthSession | null {
		const session = this.authSessions.get(sessionId);
		if (!session) return null;
		if (session.expiresAt <= now) {
			this.authSessions.delete(sessionId);
			return null;
		}
		return session;
	}

	consumeAuthSession(sessionId: string, now = Date.now()): EphemeralAuthSession | null {
		const session = this.getAuthSession(sessionId, now);
		if (session) {
			this.authSessions.delete(sessionId);
		}
		return session;
	}

	createAuthorizationCode(params: {
		clientId: string;
		redirectUri: string;
		codeChallenge: string;
		syncKey: string;
		accountId: string;
		now?: number;
	}): string {
		const now = params.now ?? Date.now();
		const code = `code_${randomOpaqueId()}`;
		this.codes.set(code, {
			code,
			clientId: params.clientId,
			redirectUri: params.redirectUri,
			codeChallenge: params.codeChallenge,
			syncKey: params.syncKey,
			accountId: params.accountId,
			expiresAt: now + MCP_OAUTH_CODE_TTL_MS
		});
		return code;
	}

	exchangeCode(params: {
		code: string;
		clientId: string;
		redirectUri: string;
		codeVerifier: string;
		now?: number;
	}): StoredOAuthToken | null {
		const now = params.now ?? Date.now();
		const storedCode = this.codes.get(params.code);
		if (!storedCode) return null;
		this.codes.delete(params.code);

		if (storedCode.expiresAt <= now) return null;
		if (storedCode.clientId !== params.clientId) return null;
		if (storedCode.redirectUri !== params.redirectUri) return null;
		if (!verifyPkce(params.codeVerifier, storedCode.codeChallenge)) return null;

		const accessToken = `sc_mcp_${randomOpaqueId()}`;
		const refreshToken = `sc_ref_${randomOpaqueId()}`;
		const storedToken: StoredOAuthToken = {
			accessToken,
			refreshToken,
			clientId: storedCode.clientId,
			syncKey: storedCode.syncKey,
			accountId: storedCode.accountId,
			expiresAt: now + MCP_TOKEN_TTL_MS
		};

		this.tokens.set(accessToken, storedToken);
		this.refreshTokens.set(refreshToken, accessToken);
		return storedToken;
	}

	refreshAccessToken(refreshToken: string, now = Date.now()): StoredOAuthToken | null {
		const oldAccessToken = this.refreshTokens.get(refreshToken);
		if (!oldAccessToken) return null;

		const oldToken = this.tokens.get(oldAccessToken);
		if (!oldToken) return null;

		this.tokens.delete(oldAccessToken);
		this.refreshTokens.delete(refreshToken);

		const newAccessToken = `sc_mcp_${randomOpaqueId()}`;
		const newRefreshToken = `sc_ref_${randomOpaqueId()}`;
		const newToken: StoredOAuthToken = {
			accessToken: newAccessToken,
			refreshToken: newRefreshToken,
			clientId: oldToken.clientId,
			syncKey: oldToken.syncKey,
			accountId: oldToken.accountId,
			expiresAt: now + MCP_TOKEN_TTL_MS
		};

		this.tokens.set(newAccessToken, newToken);
		this.refreshTokens.set(newRefreshToken, newAccessToken);
		return newToken;
	}

	getToken(accessToken: string, now = Date.now()): StoredOAuthToken | null {
		const token = this.tokens.get(accessToken);
		if (!token) return null;
		if (token.expiresAt <= now) {
			this.tokens.delete(accessToken);
			return null;
		}
		return token;
	}

	resolveToken(
		accessToken: string,
		now = Date.now()
	): { accountId: string; syncKey: string } | null {
		const token = this.getToken(accessToken, now);
		if (!token) return null;
		return { accountId: token.accountId, syncKey: token.syncKey };
	}
}
