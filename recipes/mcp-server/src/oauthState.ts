import { sha256Base64Url } from './crypto.js';

export const MAX_OAUTH_STATE_ENTRIES = 10_000;

export interface OAuthStateStore {
	registerSession(sessionId: string, expiresAt: number): Promise<void>;
	consumeSession(sessionId: string, now: number): Promise<boolean>;
	registerCode(code: string, expiresAt: number): Promise<void>;
	consumeCode(code: string, now: number): Promise<boolean>;
	registerAccessToken(accessToken: string, expiresAt: number): Promise<void>;
	hasAccessToken(accessToken: string, now: number): Promise<boolean>;
	revokeAccessToken(accessToken: string): Promise<void>;
	registerRefreshToken(refreshToken: string, accessToken: string, expiresAt: number): Promise<void>;
	consumeRefreshToken(refreshToken: string, now: number): Promise<string | null>;
}

type ExpiringEntry = { expiresAt: number };
type RefreshEntry = ExpiringEntry & { accessToken: string };

function pruneMap<T extends ExpiringEntry>(entries: Map<string, T>, now: number): void {
	for (const [key, entry] of entries) {
		if (entry.expiresAt <= now) entries.delete(key);
	}
	while (entries.size > MAX_OAUTH_STATE_ENTRIES) {
		const oldest = entries.keys().next().value;
		if (typeof oldest !== 'string') break;
		entries.delete(oldest);
	}
}

/** Single-process state for the Node recipe. A restart invalidates OAuth state. */
export class InMemoryOAuthStateStore implements OAuthStateStore {
	private readonly sessions = new Map<string, ExpiringEntry>();
	private readonly codes = new Map<string, ExpiringEntry>();
	private readonly accessTokens = new Map<string, ExpiringEntry>();
	private readonly refreshTokens = new Map<string, RefreshEntry>();

	private prune(now: number): void {
		pruneMap(this.sessions, now);
		pruneMap(this.codes, now);
		pruneMap(this.accessTokens, now);
		pruneMap(this.refreshTokens, now);
	}

	private put(entries: Map<string, ExpiringEntry>, key: string, expiresAt: number): void {
		this.prune(Date.now());
		entries.delete(key);
		entries.set(key, { expiresAt });
		pruneMap(entries, Date.now());
	}

	private consume(entries: Map<string, ExpiringEntry>, key: string, now: number): boolean {
		this.prune(now);
		const entry = entries.get(key);
		if (!entry || entry.expiresAt <= now) {
			entries.delete(key);
			return false;
		}
		entries.delete(key);
		return true;
	}

	registerSession(sessionId: string, expiresAt: number): Promise<void> {
		this.put(this.sessions, sessionId, expiresAt);
		return Promise.resolve();
	}

	consumeSession(sessionId: string, now: number): Promise<boolean> {
		return Promise.resolve(this.consume(this.sessions, sessionId, now));
	}

	registerCode(code: string, expiresAt: number): Promise<void> {
		this.put(this.codes, code, expiresAt);
		return Promise.resolve();
	}

	consumeCode(code: string, now: number): Promise<boolean> {
		return Promise.resolve(this.consume(this.codes, code, now));
	}

	registerAccessToken(accessToken: string, expiresAt: number): Promise<void> {
		this.put(this.accessTokens, accessToken, expiresAt);
		return Promise.resolve();
	}

	hasAccessToken(accessToken: string, now: number): Promise<boolean> {
		this.prune(now);
		const entry = this.accessTokens.get(accessToken);
		return Promise.resolve(Boolean(entry && entry.expiresAt > now));
	}

	revokeAccessToken(accessToken: string): Promise<void> {
		this.accessTokens.delete(accessToken);
		return Promise.resolve();
	}

	registerRefreshToken(
		refreshToken: string,
		accessToken: string,
		expiresAt: number
	): Promise<void> {
		this.prune(Date.now());
		this.refreshTokens.delete(refreshToken);
		this.refreshTokens.set(refreshToken, { accessToken, expiresAt });
		pruneMap(this.refreshTokens, Date.now());
		return Promise.resolve();
	}

	consumeRefreshToken(refreshToken: string, now: number): Promise<string | null> {
		this.prune(now);
		const entry = this.refreshTokens.get(refreshToken);
		if (!entry || entry.expiresAt <= now) {
			this.refreshTokens.delete(refreshToken);
			return Promise.resolve(null);
		}
		this.refreshTokens.delete(refreshToken);
		return Promise.resolve(entry.accessToken);
	}
}

export interface DurableObjectStateLike {
	blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
	storage: {
		get<T = unknown>(key: string): Promise<T | undefined>;
		list<T = unknown>(options: { prefix: string; limit: number }): Promise<Map<string, T>>;
		put<T>(key: string, value: T): Promise<void>;
		delete(key: string): Promise<boolean>;
	};
}

export interface DurableObjectStubLike {
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

type DurableOperation =
	| { operation: 'put'; kind: 'session' | 'code' | 'access'; key: string; expiresAt: number }
	| {
			operation: 'put-refresh';
			key: string;
			accessToken: string;
			expiresAt: number;
	  }
	| { operation: 'consume'; kind: 'session' | 'code' | 'refresh'; key: string; now: number }
	| { operation: 'has-access'; key: string; now: number }
	| { operation: 'revoke-access'; key: string };

function durableKey(kind: string, value: string): string {
	return `oauth:${kind}:${sha256Base64Url(value)}`;
}

async function callDurableObject(
	stub: DurableObjectStubLike,
	operation: DurableOperation
): Promise<unknown> {
	const response = await stub.fetch('https://oauth-state.internal/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(operation)
	});
	if (!response.ok) throw new Error('OAuth state store unavailable');
	return response.json();
}

/** Cloudflare Durable Object-backed state shared by every Worker isolate. */
export class DurableOAuthStateStore implements OAuthStateStore {
	constructor(private readonly stub: DurableObjectStubLike) {}

	async registerSession(sessionId: string, expiresAt: number): Promise<void> {
		await callDurableObject(this.stub, {
			operation: 'put',
			kind: 'session',
			key: durableKey('session', sessionId),
			expiresAt
		});
	}

	async consumeSession(sessionId: string, now: number): Promise<boolean> {
		return Boolean(
			await callDurableObject(this.stub, {
				operation: 'consume',
				kind: 'session',
				key: durableKey('session', sessionId),
				now
			})
		);
	}

	async registerCode(code: string, expiresAt: number): Promise<void> {
		await callDurableObject(this.stub, {
			operation: 'put',
			kind: 'code',
			key: durableKey('code', code),
			expiresAt
		});
	}

	async consumeCode(code: string, now: number): Promise<boolean> {
		return Boolean(
			await callDurableObject(this.stub, {
				operation: 'consume',
				kind: 'code',
				key: durableKey('code', code),
				now
			})
		);
	}

	async registerAccessToken(accessToken: string, expiresAt: number): Promise<void> {
		await callDurableObject(this.stub, {
			operation: 'put',
			kind: 'access',
			key: durableKey('access', accessToken),
			expiresAt
		});
	}

	async hasAccessToken(accessToken: string, now: number): Promise<boolean> {
		return Boolean(
			await callDurableObject(this.stub, {
				operation: 'has-access',
				key: durableKey('access', accessToken),
				now
			})
		);
	}

	async revokeAccessToken(accessToken: string): Promise<void> {
		await callDurableObject(this.stub, {
			operation: 'revoke-access',
			key: durableKey('access', accessToken)
		});
	}

	async registerRefreshToken(
		refreshToken: string,
		accessToken: string,
		expiresAt: number
	): Promise<void> {
		await callDurableObject(this.stub, {
			operation: 'put-refresh',
			key: durableKey('refresh', refreshToken),
			accessToken,
			expiresAt
		});
	}

	async consumeRefreshToken(refreshToken: string, now: number): Promise<string | null> {
		const result = await callDurableObject(this.stub, {
			operation: 'consume',
			kind: 'refresh',
			key: durableKey('refresh', refreshToken),
			now
		});
		return typeof result === 'string' ? result : null;
	}
}

export class McpOAuthState {
	constructor(private readonly state: DurableObjectStateLike) {}

	private async pruneAndCount(kind: string, now: number): Promise<number> {
		const entries = await this.state.storage.list<number | RefreshEntry>({
			prefix: `oauth:${kind}:`,
			limit: MAX_OAUTH_STATE_ENTRIES + 1
		});
		let active = 0;
		for (const [key, value] of entries) {
			const expiresAt = typeof value === 'number' ? value : value.expiresAt;
			if (expiresAt <= now) {
				await this.state.storage.delete(key);
			} else {
				active += 1;
			}
		}
		return active;
	}

	async fetch(request: Request): Promise<Response> {
		if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

		let operation: DurableOperation;
		try {
			operation = (await request.json()) as DurableOperation;
		} catch {
			return new Response('Bad Request', { status: 400 });
		}

		try {
			const result = await this.state.blockConcurrencyWhile(async () => {
				if (operation.operation === 'put') {
					if ((await this.pruneAndCount(operation.kind, Date.now())) >= MAX_OAUTH_STATE_ENTRIES) {
						throw new Error('OAuth state store capacity reached');
					}
					await this.state.storage.put(operation.key, operation.expiresAt);
					return true;
				}
				if (operation.operation === 'put-refresh') {
					if ((await this.pruneAndCount('refresh', Date.now())) >= MAX_OAUTH_STATE_ENTRIES) {
						throw new Error('OAuth state store capacity reached');
					}
					await this.state.storage.put(operation.key, {
						accessToken: operation.accessToken,
						expiresAt: operation.expiresAt
					});
					return true;
				}
				if (operation.operation === 'has-access') {
					const expiresAt = await this.state.storage.get<number>(operation.key);
					if (!expiresAt || expiresAt <= operation.now) {
						if (expiresAt !== undefined) await this.state.storage.delete(operation.key);
						return false;
					}
					return true;
				}
				if (operation.operation === 'revoke-access') {
					await this.state.storage.delete(operation.key);
					return true;
				}

				const entry = await this.state.storage.get<number | RefreshEntry>(operation.key);
				if (!entry) return false;
				const expiresAt = typeof entry === 'number' ? entry : entry.expiresAt;
				if (expiresAt <= operation.now) {
					await this.state.storage.delete(operation.key);
					return false;
				}
				await this.state.storage.delete(operation.key);
				return operation.kind === 'refresh' && typeof entry !== 'number' ? entry.accessToken : true;
			});
			return Response.json(result);
		} catch {
			return new Response('OAuth state store unavailable', { status: 503 });
		}
	}
}
