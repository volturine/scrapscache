import { describe, expect, it } from 'vitest';
import {
	DurableOAuthStateStore,
	McpOAuthState,
	type DurableObjectStateLike,
	type DurableObjectStubLike
} from '../src/oauthState.js';

class FakeStorage {
	private readonly values = new Map<string, unknown>();

	async get<T>(key: string): Promise<T | undefined> {
		return this.values.get(key) as T | undefined;
	}

	async list<T>(options: { prefix: string; limit: number }): Promise<Map<string, T>> {
		return new Map(
			[...this.values.entries()]
				.filter(([key]) => key.startsWith(options.prefix))
				.slice(0, options.limit) as [string, T][]
		);
	}

	async put<T>(key: string, value: T): Promise<void> {
		this.values.set(key, value);
	}

	async delete(key: string): Promise<boolean> {
		return this.values.delete(key);
	}
}

class FakeState implements DurableObjectStateLike {
	readonly storage = new FakeStorage();

	blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
		return callback();
	}
}

class FakeStub implements DurableObjectStubLike {
	constructor(private readonly object: McpOAuthState) {}

	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		return this.object.fetch(new Request(input, init));
	}
}

describe('Durable OAuth state store', () => {
	it('atomically consumes one-time state and rotates access state', async () => {
		const object = new McpOAuthState(new FakeState());
		const store = new DurableOAuthStateStore(new FakeStub(object));
		const expiresAt = Date.now() + 60_000;

		await store.registerCode('code-test', expiresAt);
		expect(await store.consumeCode('code-test', Date.now())).toBe(true);
		expect(await store.consumeCode('code-test', Date.now())).toBe(false);

		await store.registerAccessToken('access-test', expiresAt);
		expect(await store.hasAccessToken('access-test', Date.now())).toBe(true);
		await store.revokeAccessToken('access-test');
		expect(await store.hasAccessToken('access-test', Date.now())).toBe(false);

		await store.registerRefreshToken('refresh-test', 'access-test', expiresAt);
		expect(await store.consumeRefreshToken('refresh-test', Date.now())).toBe('access-test');
		expect(await store.consumeRefreshToken('refresh-test', Date.now())).toBeNull();
	});
});
