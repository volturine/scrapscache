import { describe, expect, it } from 'vitest';
import { createEditContext } from './edit.js';

describe('createEditContext writer id', () => {
	it('is unique across contexts', () => {
		const contexts = new Set(Array.from({ length: 20 }, () => createEditContext(() => 0).writer));
		expect(contexts.size).toBe(20);
	});

	// crypto.randomUUID exists only in secure contexts; plain-HTTP LAN access to a
	// self-hosted relay must still boot (issue #12: whole-app 500 on such origins).
	it('creates a writer even where crypto.randomUUID is absent', () => {
		const randomUUID = crypto.randomUUID;
		try {
			// Simulate the insecure-origin shape: crypto without randomUUID.
			type RandomUUIDCrypto = Pick<Crypto, 'getRandomValues'> & {
				randomUUID?: Crypto['randomUUID'];
			};
			const insecureCrypto = crypto as unknown as RandomUUIDCrypto;
			delete insecureCrypto.randomUUID;
			const context = createEditContext(() => 0);
			expect(context.writer).toBeTruthy();
			expect(typeof context.writer).toBe('string');
		} finally {
			crypto.randomUUID = randomUUID;
		}
	});
});
