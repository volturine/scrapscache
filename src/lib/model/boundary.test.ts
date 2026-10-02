import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The MCP server compiles this directory on its own (its Dockerfile copies only
// src/lib/model), so a model file may import its siblings and the server's own
// npm dependencies, nothing else. Vite resolves anything, so only this catches it.
const modelDir = dirname(fileURLToPath(import.meta.url));
const serverPackage = JSON.parse(
	readFileSync(join(modelDir, '../../../recipes/mcp-server/package.json'), 'utf8')
) as { dependencies: Record<string, string> };
const allowedPackages = new Set(Object.keys(serverPackage.dependencies));

/** Import specifiers in `source` that the MCP server build could not resolve. */
function escapingImports(source: string): string[] {
	return [...source.matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'\s*\)/g)]
		.map((match) => match[1] ?? match[2])
		.filter((specifier) =>
			specifier.startsWith('.')
				? specifier.startsWith('../') || specifier.includes('/', 2)
				: !allowedPackages.has(packageName(specifier))
		);
}

/** `@scope/name` or `name`, without a subpath such as `/sha2.js`. */
function packageName(specifier: string): string {
	const parts = specifier.split('/');
	return parts.slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
}

describe('model module boundary', () => {
	const sources = readdirSync(modelDir).filter(
		(file) => file.endsWith('.ts') && !file.endsWith('.test.ts')
	);

	it.each(sources)('%s imports only siblings and MCP server dependencies', (file) => {
		expect(escapingImports(readFileSync(join(modelDir, file), 'utf8'))).toEqual([]);
	});

	it('rejects parent-directory, $lib and unlisted package imports, allowing listed subpaths', () => {
		const source = [
			"import { uid } from '../uid.js';",
			"import { dayKey } from '#lib/utils';",
			"import { nanoid } from 'nanoid';",
			"import { x } from 'nanoid/sub.js';",
			"import { sha256 } from '@noble/hashes/sha2.js';",
			"import * as Y from 'yjs';",
			"import { merge } from './merge.js';"
		].join('\n');
		expect(escapingImports(source)).toEqual(['../uid.js', '#lib/utils', 'nanoid', 'nanoid/sub.js']);
	});
});
