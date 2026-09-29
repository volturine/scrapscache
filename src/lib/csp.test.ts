import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const svelteConfig = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), '../../svelte.config.js'),
	'utf8'
);

function directiveSources(name: string): string[] {
	const declaration = new RegExp(`'${name}':\\s*\\[([\\s\\S]*?)\\]`).exec(svelteConfig)?.[1];
	return declaration?.match(/'[^']+'/g)?.map((source) => source.slice(1, -1)) ?? [];
}

describe('attachment CSP', () => {
	it('allows same-origin blob PDFs in the in-app viewer', () => {
		expect(svelteConfig).toMatch(/'frame-src':\s*\['self',\s*'blob:'\]/);
		expect(svelteConfig).toMatch(/'object-src':\s*\['self',\s*'blob:'\]/);
		expect(svelteConfig).toMatch(/'default-src':\s*\['self'\]/);
	});
});

describe('font CSP', () => {
	it("allows this origin and Excalidraw's esm.sh font fallback, nothing broader", () => {
		// Excalidraw registers every font with an esm.sh fallback after /fonts;
		// blocking it only produces a console violation per font.
		expect(svelteConfig).toMatch(/'font-src':\s*\['self',\s*'https:\/\/esm\.sh\/@excalidraw\/'\]/);
		// No other directive may reach esm.sh; scripts in particular stay same-origin.
		const reachingEsm = [...svelteConfig.matchAll(/'([a-z-]+)':\s*\[[^\]]*esm\.sh[^\]]*\]/g)].map(
			(match) => match[1]
		);
		expect(reachingEsm).toEqual(['font-src']);
	});
});

describe('script CSP', () => {
	it('allows same-origin JavaScript and WebLLM WebAssembly, with no third-party scripts', () => {
		// Anything allowed to run here can read the sync keys. Turnstile is framed
		// from its own origin instead. wasm-unsafe-eval permits WebAssembly compilation,
		// not JavaScript eval or scripts from another origin.
		expect(directiveSources('script-src')).toEqual(['self', 'wasm-unsafe-eval']);
	});
});

describe('WebLLM model CSP', () => {
	it('allows only the pinned model download hosts in connect-src', () => {
		expect(directiveSources('connect-src')).toEqual([
			'self',
			'https://huggingface.co',
			'https://*.huggingface.co',
			'https://*.hf.co',
			'https://raw.githubusercontent.com'
		]);
	});
});
