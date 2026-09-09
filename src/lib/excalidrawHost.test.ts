import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const hostSource = readFileSync(join(here, 'excalidrawHost.ts'), 'utf8');
const viteConfig = readFileSync(join(here, '../../vite.config.ts'), 'utf8');

describe('Excalidraw host', () => {
	it('loads Excalidraw CSS with the ESM package', () => {
		expect(hostSource).toMatch(/import '@excalidraw\/excalidraw\/index\.css'/);
		expect(viteConfig).toMatch(/development\|production/);
	});
});
