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
		expect(viteConfig).toMatch(/:\s*\['self',\s*'blob:'\],\s*'object-src'/);
		expect(viteConfig).toMatch(/'object-src':\s*\['self',\s*'blob:'\]/);
		expect(viteConfig).toMatch(/'default-src':\s*\['self'\]/);
	});
});

describe('frame CSP', () => {
	const frameSrc = /'frame-src':([\s\S]*?)'object-src'/.exec(viteConfig)?.[1] ?? '';

	it('frames this origin and blobs, plus only the hosted challenge origins in the iPhone app', () => {
		expect(frameSrc).toContain("['self', 'blob:', ...HOSTED_CHALLENGE_ORIGINS]");
		expect(frameSrc).toContain("['self', 'blob:']");
		// A whole scheme would also let a drawing's iframe element load any page.
		expect(frameSrc).not.toMatch(/'https:'|'http:'|'\*'/);
	});

	it('takes the hosted challenge origins from the hosted servers’ configuration', () => {
		const wrangler = readFileSync(
			join(dirname(fileURLToPath(import.meta.url)), '../../wrangler.jsonc'),
			'utf8'
		);
		const origins = [
			...wrangler.matchAll(/"PUBLIC_TURNSTILE_ORIGIN":\s*"(https:\/\/[^"/]+)"/g)
		].map((match) => match[1]);
		expect(origins).toEqual([
			'https://verify.scrapscache.com',
			'https://verify-dev.scrapscache.com'
		]);
		expect(__APP_CHALLENGE_ORIGINS__).toEqual(origins);
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
