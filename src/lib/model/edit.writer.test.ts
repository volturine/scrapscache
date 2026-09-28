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
			// The fallback builds a UUID v4 from getRandomValues, which insecure
			// contexts do have; assert the shape so a silent downgrade can't slip in.
			expect(context.writer).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
			);
		} finally {
			crypto.randomUUID = randomUUID;
		}
	});
});
