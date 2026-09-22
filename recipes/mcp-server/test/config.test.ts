import { describe, expect, it } from 'vitest';
import { bytesToBase64Url, randomBytes } from '../src/crypto.js';
import { validateRuntimeSecrets } from '../src/config.js';

describe('MCP runtime secret configuration', () => {
	it('requires an independent MCP_SECRET', () => {
		const syncKey = bytesToBase64Url(randomBytes(32));
		expect(validateRuntimeSecrets({ SCRAPSCACHE_SYNC_KEY: syncKey })).toContain('MCP_SECRET');
	});

	it('accepts OAuth-only configuration with a strong independent secret', () => {
		expect(validateRuntimeSecrets({ MCP_SECRET: 'a'.repeat(64) })).toBeNull();
	});

	it('rejects weak static bearer tokens and malformed sync keys', () => {
		expect(
			validateRuntimeSecrets({ MCP_SECRET: 'a'.repeat(64), MCP_BEARER_TOKEN: 'short' })
		).toContain('MCP_BEARER_TOKEN');
		expect(
			validateRuntimeSecrets({ MCP_SECRET: 'a'.repeat(64), SCRAPSCACHE_SYNC_KEY: 'not-a-key' })
		).toContain('SCRAPSCACHE_SYNC_KEY');
	});
});
