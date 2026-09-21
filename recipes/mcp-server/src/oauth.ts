import {
	sha256Base64Url,
	randomOpaqueId,
	createHandshakeKeyPair,
	sealPayload,
	unsealPayload,
	bytesToBase64Url,
	base64UrlToBytes
} from './crypto.js';
import { grantedWorkspaces, type GrantedWorkspace } from './grant.js';

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
const GROK_CONNECTOR_RE =
	/^https:\/\/(?:[a-z0-9-]+\.)?grok\.com\/connectors-oauth-exchange-code\/?$/;
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
		redirectUris: [
			'https://grok.com/connectors-oauth-exchange-code/',
			'https://grok.com/connectors-oauth-exchange-code'
		]
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
	if ((client.id === 'grok' || client.name.toLowerCase() === 'grok') && GROK_CONNECTOR_RE.test(uri))
		return true;
	if (client.id === 'hermes') {
		const match = HERMES_LOOPBACK_RE.exec(uri);
		if (match && Number(match[1]) <= 65535) return true;
	}
	if (
		client.redirectUris.some(
			(u) =>
				u === uri ||
				(u.endsWith('/') && uri === u.slice(0, -1)) ||
				(!u.endsWith('/') && uri === `${u}/`)
		)
	) {
		return true;
	}
	return false;
}

export function findWellKnownClient(
	clientId?: string,
	redirectUri?: string
): OAuthClientInfo | null {
	if (clientId) {
		const byId = WELL_KNOWN_CLIENTS.find((c) => c.id === clientId.toLowerCase());
		if (byId) return byId;
	}
	if (redirectUri) {
		for (const client of WELL_KNOWN_CLIENTS) {
			if (isRedirectAllowed(client, redirectUri)) return client;
		}
	}
	return null;
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
	workspaces?: GrantedWorkspace[];
	expiresAt: number;
};

export type StoredOAuthToken = {
	accessToken: string;
	refreshToken: string;
	clientId: string;
	syncKey: string;
	accountId: string;
	workspaces?: GrantedWorkspace[];
	expiresAt: number;
};

export type ResolvedOAuthToken = {
	accountId: string;
	syncKey: string;
	workspaces: GrantedWorkspace[];
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
	private readonly secret: string;
	private readonly clients = new Map<string, OAuthClientInfo>();
	private readonly codes = new Map<string, StoredOAuthCode>();
	private readonly tokens = new Map<string, StoredOAuthToken>();
	private readonly refreshTokens = new Map<string, string>(); // refreshToken -> accessToken
	private readonly authSessions = new Map<string, EphemeralAuthSession>();
	private readonly revokedTokens = new Set<string>();

	constructor(secret?: string) {
		// A shared secret seals clients, sessions, codes, and tokens so another
		// isolate can read them. Without one, grants live only in this process.
		this.secret = secret || randomOpaqueId();
		for (const client of WELL_KNOWN_CLIENTS) {
			this.clients.set(client.id, client);
		}
	}

	registerClient(registration: {
		client_name?: string;
		redirect_uris?: string[];
	}): OAuthClientInfo {
		const name = registration.client_name || 'AI Assistant';
		const redirectUris = registration.redirect_uris || [];
		const sealed = sealPayload({ name, redirectUris }, this.secret);
		const id = `client_${sealed}`;
		const client: OAuthClientInfo = {
			id,
			name,
			redirectUris
		};
		this.clients.set(id, client);
		return client;
	}

	getClient(clientId: string, redirectUri?: string): OAuthClientInfo | null {
		const wellKnown = findWellKnownClient(clientId, redirectUri);
		if (wellKnown) {
			return {
				...wellKnown,
				id: clientId || wellKnown.id
			};
		}
		const inMemory = this.clients.get(clientId);
		if (inMemory) return inMemory;

		if (clientId.startsWith('client_')) {
			const data = unsealPayload<{ name?: string; redirectUris?: string[] }>(
				clientId.slice(7),
				this.secret
			);
			if (data) {
				const client: OAuthClientInfo = {
					id: clientId,
					name: data.name || 'AI Assistant',
					redirectUris: data.redirectUris || []
				};
				this.clients.set(clientId, client);
				return client;
			}
		}
		return null;
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
		const { privateKey, publicKey } = createHandshakeKeyPair();
		const sessionData = {
			clientId: params.clientId,
			redirectUri: params.redirectUri,
			state: params.state,
			codeChallenge: params.codeChallenge,
			codeChallengeMethod: params.codeChallengeMethod,
			mcpPrivateKey: bytesToBase64Url(privateKey),
			mcpPublicKey: publicKey,
			expiresAt: now + (params.ttlMs ?? 10 * 60 * 1000)
		};
		const sessionId = `sess_${sealPayload(sessionData, this.secret)}`;
		const session: EphemeralAuthSession = {
			sessionId,
			clientId: params.clientId,
			redirectUri: params.redirectUri,
			state: params.state,
			codeChallenge: params.codeChallenge,
			codeChallengeMethod: params.codeChallengeMethod,
			mcpPrivateKey: privateKey,
			mcpPublicKey: publicKey,
			expiresAt: sessionData.expiresAt
		};
		this.authSessions.set(sessionId, session);
		return session;
	}

	getAuthSession(sessionId: string, now = Date.now()): EphemeralAuthSession | null {
		const session = this.authSessions.get(sessionId);
		if (session) {
			if (session.expiresAt <= now) {
				this.authSessions.delete(sessionId);
				return null;
			}
			return session;
		}

		if (sessionId.startsWith('sess_')) {
			const data = unsealPayload<{
				clientId: string;
				redirectUri: string;
				state: string;
				codeChallenge: string;
				codeChallengeMethod: string;
				mcpPrivateKey: string;
				mcpPublicKey: string;
				expiresAt: number;
			}>(sessionId.slice(5), this.secret);
			if (data && data.expiresAt > now) {
				return {
					sessionId,
					clientId: data.clientId,
					redirectUri: data.redirectUri,
					state: data.state,
					codeChallenge: data.codeChallenge,
					codeChallengeMethod: data.codeChallengeMethod,
					mcpPrivateKey: base64UrlToBytes(data.mcpPrivateKey),
					mcpPublicKey: data.mcpPublicKey,
					expiresAt: data.expiresAt
				};
			}
		}
		return null;
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
		workspaces?: GrantedWorkspace[];
		now?: number;
	}): string {
		const now = params.now ?? Date.now();
		const codeData = {
			clientId: params.clientId,
			redirectUri: params.redirectUri,
			codeChallenge: params.codeChallenge,
			syncKey: params.syncKey,
			accountId: params.accountId,
			...(params.workspaces?.length ? { workspaces: params.workspaces } : {}),
			expiresAt: now + MCP_OAUTH_CODE_TTL_MS
		};
		const code = `code_${sealPayload(codeData, this.secret)}`;
		this.codes.set(code, {
			code,
			...codeData
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
		let storedCode = this.codes.get(params.code);
		if (storedCode) {
			this.codes.delete(params.code);
		} else if (params.code.startsWith('code_')) {
			const data = unsealPayload<{
				clientId: string;
				redirectUri: string;
				codeChallenge: string;
				syncKey: string;
				accountId: string;
				workspaces?: GrantedWorkspace[];
				expiresAt: number;
			}>(params.code.slice(5), this.secret);
			if (data) {
				storedCode = {
					code: params.code,
					...data
				};
			}
		}

		if (!storedCode) return null;
		if (storedCode.expiresAt <= now) return null;
		if (storedCode.redirectUri !== params.redirectUri) return null;
		if (storedCode.clientId !== params.clientId) {
			const clientA = this.getClient(storedCode.clientId, storedCode.redirectUri);
			const clientB = this.getClient(params.clientId, params.redirectUri);
			if (!clientA || !clientB || clientA.name !== clientB.name) {
				return null;
			}
		}
		if (!verifyPkce(params.codeVerifier, storedCode.codeChallenge)) return null;

		const tokenData = {
			clientId: params.clientId,
			syncKey: storedCode.syncKey,
			accountId: storedCode.accountId,
			...(storedCode.workspaces?.length ? { workspaces: storedCode.workspaces } : {}),
			expiresAt: now + MCP_TOKEN_TTL_MS
		};
		const accessToken = `sc_mcp_${sealPayload(tokenData, this.secret)}`;
		const refreshToken = `sc_ref_${sealPayload(tokenData, this.secret)}`;
		const storedToken: StoredOAuthToken = {
			accessToken,
			refreshToken,
			...tokenData
		};

		this.tokens.set(accessToken, storedToken);
		this.refreshTokens.set(refreshToken, accessToken);
		return storedToken;
	}

	resolveToken(token: string, now = Date.now()): ResolvedOAuthToken | null {
		if (this.revokedTokens.has(token)) return null;
		const inMemory = this.tokens.get(token);
		if (inMemory && inMemory.expiresAt > now) {
			return {
				accountId: inMemory.accountId,
				syncKey: inMemory.syncKey,
				workspaces: grantedWorkspaces(inMemory.syncKey, inMemory.accountId, inMemory.workspaces)
			};
		}
		if (token.startsWith('sc_mcp_')) {
			const data = unsealPayload<{
				syncKey: string;
				accountId: string;
				workspaces?: GrantedWorkspace[];
				expiresAt: number;
			}>(token.slice(7), this.secret);
			if (data && data.expiresAt > now) {
				return {
					accountId: data.accountId,
					syncKey: data.syncKey,
					workspaces: grantedWorkspaces(data.syncKey, data.accountId, data.workspaces)
				};
			}
		}
		return null;
	}

	refreshAccessToken(refreshToken: string, now = Date.now()): StoredOAuthToken | null {
		let syncKey = '';
		let accountId = '';
		let clientId = 'mcp-client';
		let workspaces: GrantedWorkspace[] | undefined;

		const oldAccessToken = this.refreshTokens.get(refreshToken);
		if (oldAccessToken) {
			this.revokedTokens.add(oldAccessToken);
			const oldToken = this.tokens.get(oldAccessToken);
			if (oldToken) {
				this.tokens.delete(oldAccessToken);
				this.refreshTokens.delete(refreshToken);
				syncKey = oldToken.syncKey;
				accountId = oldToken.accountId;
				clientId = oldToken.clientId;
				workspaces = oldToken.workspaces;
			}
		}
		if (!syncKey && refreshToken.startsWith('sc_ref_')) {
			const data = unsealPayload<{
				clientId: string;
				syncKey: string;
				accountId: string;
				workspaces?: GrantedWorkspace[];
				expiresAt: number;
			}>(refreshToken.slice(7), this.secret);
			if (data && data.expiresAt > now) {
				syncKey = data.syncKey;
				accountId = data.accountId;
				clientId = data.clientId;
				workspaces = data.workspaces;
			}
		}

		if (!syncKey) return null;

		const tokenData = {
			clientId,
			syncKey,
			accountId,
			...(workspaces?.length ? { workspaces } : {}),
			expiresAt: now + MCP_TOKEN_TTL_MS
		};
		const newAccessToken = `sc_mcp_${sealPayload(tokenData, this.secret)}`;
		const newRefreshToken = `sc_ref_${sealPayload(tokenData, this.secret)}`;
		const newToken: StoredOAuthToken = {
			accessToken: newAccessToken,
			refreshToken: newRefreshToken,
			...tokenData
		};

		this.tokens.set(newAccessToken, newToken);
		this.refreshTokens.set(newRefreshToken, newAccessToken);
		return newToken;
	}
}
