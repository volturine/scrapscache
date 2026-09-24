import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	bytesToGigabytes,
	DEFAULT_HISTORY_VERSIONS,
	DEFAULT_MAX_ACCOUNT_BYTES,
	MAX_HISTORY_VERSIONS,
	parseHistoryVersions,
	parseMaxAccountBytes,
	parseRetentionInactiveDays,
	staleBeforeMs
} from './operatorConfig';

type WranglerVars = Record<string, string | undefined>;
type WranglerConfig = {
	vars?: WranglerVars;
	env?: Record<string, { vars?: WranglerVars }>;
};

function composeFallback(source: string, name: string): string {
	const match = source.match(new RegExp(`${name}: "\\$\\{${name}:-(\\d+)\\}"`));
	if (!match) throw new Error(`Compose fallback for ${name} is missing`);
	return match[1];
}

/** wrangler.jsonc carries rationale comments; strip whole-line ones before parsing
 * so a URL's `//` is never mistaken for the start of a comment. */
function readWranglerConfig(path: string): WranglerConfig {
	const stripped = readFileSync(path, 'utf8')
		.split('\n')
		.filter((line) => !line.trim().startsWith('//'))
		.join('\n');
	return JSON.parse(stripped) as WranglerConfig;
}

describe('operator config', () => {
	it('treats missing or non-positive retention days as disabled', () => {
		expect(parseRetentionInactiveDays(undefined)).toBe(0);
		expect(parseRetentionInactiveDays('0')).toBe(0);
		expect(parseRetentionInactiveDays('-3')).toBe(0);
		expect(parseRetentionInactiveDays('365')).toBe(365);
	});

	it('reports decimal gigabytes and a retention cutoff only when enabled', () => {
		expect(bytesToGigabytes(1_500_000_000)).toBe(1.5);
		expect(bytesToGigabytes(1_000_000)).toBe(0.001);
		expect(staleBeforeMs(0, 1_000)).toBeNull();
		expect(staleBeforeMs(2, 2 * 24 * 60 * 60 * 1000)).toBe(0);
	});

	it('falls back to the shared 100 MB account quota', () => {
		expect(DEFAULT_MAX_ACCOUNT_BYTES).toBe(100_000_000);
		expect(parseMaxAccountBytes(undefined)).toBe(DEFAULT_MAX_ACCOUNT_BYTES);
		expect(parseMaxAccountBytes('0')).toBe(DEFAULT_MAX_ACCOUNT_BYTES);
		expect(parseMaxAccountBytes('200000000')).toBe(200_000_000);
	});

	it('keeps 14 history versions unless an operator sets 1 to 40', () => {
		expect(DEFAULT_HISTORY_VERSIONS).toBe(14);
		expect(MAX_HISTORY_VERSIONS).toBe(40);
		expect(parseHistoryVersions(undefined)).toBe(14);
		expect(parseHistoryVersions('0')).toBe(14);
		expect(parseHistoryVersions('41')).toBe(14);
		expect(parseHistoryVersions('2.5')).toBe(14);
		expect(parseHistoryVersions('1')).toBe(1);
		expect(parseHistoryVersions('40')).toBe(40);
	});

	it.each([
		['SCRAPSCACHE_SYNC_MAX_ACCOUNT_BYTES', String(DEFAULT_MAX_ACCOUNT_BYTES)],
		['SCRAPSCACHE_HISTORY_VERSIONS', String(DEFAULT_HISTORY_VERSIONS)]
	])('keeps the self-host and Workers default for %s aligned', (name, expected) => {
		const example = readFileSync('docker/.env.example', 'utf8');
		expect(example).toMatch(new RegExp(`^${name}=${expected}$`, 'm'));

		expect(composeFallback(readFileSync('docker/compose.yaml', 'utf8'), name)).toBe(expected);
		expect(composeFallback(readFileSync('docker/compose.dev.yaml', 'utf8'), name)).toBe(expected);

		const wrangler = readWranglerConfig('wrangler.jsonc');
		expect(wrangler.vars?.[name]).toBe(expected);
		const environments = Object.entries(wrangler.env ?? {});
		expect(environments.length).toBeGreaterThan(0);
		expect(
			Object.fromEntries(environments.map(([env, config]) => [env, config.vars?.[name]]))
		).toEqual(Object.fromEntries(environments.map(([env]) => [env, expected])));
	});
});
