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
	/**
	 * Callbacks that cannot be written as fixed strings: a per-connection id in
	 * the path (ChatGPT) or an ephemeral loopback port (CLI clients). Patterns
	 * live on the client record so redirect matching never depends on the
	 * client_id, which a dynamically registered client replaces with its own.
	 */
	redirectPatterns?: RegExp[];
	clientSecret?: string;
};

const CLAUDE_REDIRECT_RE = /^https:\/\/claude\.(?:ai|com)\/api\/mcp\/auth_callback$/;
const CHATGPT_REDIRECT_RE =
	/^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]+)$/;
const GROK_REDIRECT_RE =
	/^https:\/\/(?:[a-z0-9-]+\.)?grok\.com\/connectors-oauth-exchange-code\/?$/;
const PERPLEXITY_REDIRECT_RE =
	/^https:\/\/(?:[a-z0-9-]+\.)?perplexity\.(?:ai|com)\/rest\/connections\/oauth_callback$/;
// RFC 8252 §7.3: a native client binds a fresh loopback port on every run, so
// the port carries no identity and must not be part of the comparison.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const LOOPBACK_REDIRECT_RE =
	/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):[1-9][0-9]{0,4}\/callback$/;

export const WELL_KNOWN_CLIENTS: OAuthClientInfo[] = [
	{
		id: 'claude',
		name: 'Claude',
		redirectUris: [
			'https://claude.ai/api/mcp/auth_callback',
			'https://claude.com/api/mcp/auth_callback'
		],
		redirectPatterns: [CLAUDE_REDIRECT_RE]
	},
	{
		id: 'chatgpt',
		name: 'ChatGPT',
		redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
		redirectPatterns: [CHATGPT_REDIRECT_RE]
	},
	{
		id: 'grok',
		name: 'Grok',
		redirectUris: ['https://grok.com/connectors-oauth-exchange-code'],
		redirectPatterns: [GROK_REDIRECT_RE]
	},
	{
		id: 'perplexity',
		name: 'Perplexity',
		redirectUris: ['https://www.perplexity.ai/rest/connections/oauth_callback'],
		redirectPatterns: [PERPLEXITY_REDIRECT_RE]
	},
	{
		id: 'hermes',
		name: 'Hermes Agent',
		redirectUris: ['http://localhost:8080/callback', 'http://127.0.0.1:8080/callback'],
		redirectPatterns: [LOOPBACK_REDIRECT_RE]
	}
];

function parseRedirectUri(uri: string): URL | null {
	try {
		return new URL(uri);
	} catch {
		return null;
	}
}

function samePath(a: URL, b: URL): boolean {
	const trim = (path: string) => (path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path);
	return trim(a.pathname) === trim(b.pathname) && a.search === b.search && a.hash === b.hash;
}

function redirectUriMatches(registered: string, candidate: URL): boolean {
	const expected = parseRedirectUri(registered);
	if (!expected) return false;
	if (expected.username || expected.password || candidate.username || candidate.password)
		return false;
	if (expected.protocol !== candidate.protocol) return false;
	if (!samePath(expected, candidate)) return false;
	if (LOOPBACK_HOSTS.has(expected.hostname) && LOOPBACK_HOSTS.has(candidate.hostname)) {
		return Boolean(expected.port && candidate.port);
	}
	return expected.hostname === candidate.hostname && expected.port === candidate.port;
}

export function isRedirectAllowed(client: OAuthClientInfo, uri: string): boolean {
	if (!uri) return false;
	if (client.redirectUris.includes(uri)) return true;

	const candidate = parseRedirectUri(uri);
	if (!candidate || candidate.username || candidate.password) return false;
	if (client.redirectUris.some((registered) => redirectUriMatches(registered, candidate))) {
		return true;
	}
	return (client.redirectPatterns ?? []).some((pattern) => pattern.test(uri));
}

export function findWellKnownClientByRedirect(redirectUri: string): OAuthClientInfo | null {
	return WELL_KNOWN_CLIENTS.find((client) => isRedirectAllowed(client, redirectUri)) ?? null;
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
		if (!clientId) return null;

		// A client's own registration wins over the well-known list. Providers
		// register a per-connection callback (ChatGPT) or an ephemeral loopback
		// port (CLI clients), and matching those against a well-known template
		// that merely shares their host rejects the redirect they registered.
		const byId = clientId
			? WELL_KNOWN_CLIENTS.find((client) => client.id === clientId.toLowerCase())
			: undefined;
		if (byId) return byId;

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

		// Some hosted clients send a generated client_id that is not the value
		// returned by this server's registration endpoint. Their fixed provider
		// callback is still an explicit allowlist entry, so recover the provider
		// identity from that callback. PKCE continues to bind the authorization
		// code to the client that initiated the request.
		const provider =
			clientId.startsWith('client_') && redirectUri
				? findWellKnownClientByRedirect(redirectUri)
				: null;
		if (provider) return { ...provider, id: clientId };

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
