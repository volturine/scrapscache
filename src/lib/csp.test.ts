import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const svelteConfig = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), '../../svelte.config.js'),
	'utf8'
);

describe('attachment CSP', () => {
	it('allows same-origin blob PDFs in the in-app viewer', () => {
		expect(svelteConfig).toMatch(
			/'frame-src':\s*\['self',\s*'blob:',\s*'https:\/\/challenges\.cloudflare\.com'\]/
		);
		expect(svelteConfig).toMatch(/'object-src':\s*\['self',\s*'blob:'\]/);
		expect(svelteConfig).toMatch(/'default-src':\s*\['self'\]/);
	});
});

describe('Turnstile CSP', () => {
	it('allows only the Turnstile origin as a third-party script source', () => {
		expect(svelteConfig).toMatch(
			/'script-src':\s*\['self',\s*'https:\/\/challenges\.cloudflare\.com'\]/
		);
	});
});
