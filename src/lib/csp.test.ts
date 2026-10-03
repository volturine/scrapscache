import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const viteConfig = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), '../../vite.config.ts'),
	'utf8'
);

describe('attachment CSP', () => {
	it('allows same-origin blob PDFs in the in-app viewer', () => {
		expect(viteConfig).toMatch(/'frame-src':\s*\['self',\s*'blob:'\]/);
		expect(viteConfig).toMatch(/'object-src':\s*\['self',\s*'blob:'\]/);
		expect(viteConfig).toMatch(/'default-src':\s*\['self'\]/);
	});
});

describe('font CSP', () => {
	it("allows this origin and Excalidraw's esm.sh font fallback, nothing broader", () => {
		// Excalidraw registers every font with an esm.sh fallback after /fonts;
		// blocking it only produces a console violation per font.
		expect(viteConfig).toMatch(/'font-src':\s*\['self',\s*'https:\/\/esm\.sh\/@excalidraw\/'\]/);
		// No other directive may reach esm.sh; scripts in particular stay same-origin.
		const reachingEsm = [...viteConfig.matchAll(/'([a-z-]+)':\s*\[[^\]]*esm\.sh[^\]]*\]/g)].map(
			(match) => match[1]
		);
		expect(reachingEsm).toEqual(['font-src']);
	});
});

describe('script CSP', () => {
	it('allows scripts from this origin only, with no third party', () => {
		// Anything allowed to run here can read the sync keys. Turnstile is framed
		// from its own origin instead.
		expect(viteConfig).toMatch(/'script-src':\s*\['self'\]/);
		expect(viteConfig).not.toMatch(/challenges\.cloudflare\.com/);
	});
});

describe('navigation CSP', () => {
	it('blocks base rewrites, foreign form targets and every framing ancestor', () => {
		// An injected <base> or form could send note content elsewhere; the app is
		// never framed, so no ancestor is allowed.
		expect(viteConfig).toMatch(/'base-uri':\s*\['none'\]/);
		expect(viteConfig).toMatch(/'form-action':\s*\['self'\]/);
		expect(viteConfig).toMatch(/'frame-ancestors':\s*\['none'\]/);
	});
});
