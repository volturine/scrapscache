import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const hostSource = readFileSync(join(here, 'excalidrawHost.ts'), 'utf8');
const viteConfig = readFileSync(join(here, '../../vite.config.ts'), 'utf8');

describe('Excalidraw host', () => {
	it('links Excalidraw CSS when a canvas mounts instead of importing it', () => {
		// A CSS import would make SvelteKit block every notes page on Excalidraw's stylesheet.
		expect(hostSource).not.toMatch(/import '@excalidraw\/excalidraw\/index\.css'/);
		expect(hostSource).toMatch(/from '@excalidraw\/excalidraw\/index\.css\?url'/);
		expect(hostSource).toMatch(/await loadStylesheet\(\);/);
		expect(viteConfig).toMatch(/development\|production/);
	});
});
