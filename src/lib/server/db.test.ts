import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, getDb, getMeta, setMetaIfAbsent } from './db';
import { cleanupTestDbs, testDb } from './testDb';
import { privateEnv } from '../../tests/env';

afterEach(() => {
	closeDb();
	cleanupTestDbs();
});

describe('server database configuration', () => {
	it('opens file-backed databases from the environment', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'scraps-db-env-'));
		try {
			privateEnv.SCRAPSCACHE_RELAY_DB_URL = 'file:' + join(dir, 'relay.db');
			privateEnv.SCRAPSCACHE_OPS_DB_URL = 'file:' + join(dir, 'ops.db');
			const db = getDb();
			await db.ready;
			expect(await setMetaIfAbsent(db, 'instance', 'first')).toBe('first');
		} finally {
			closeDb();
			rmSync(dir, { recursive: true });
		}
	});

	it('refuses a database URL that is not libSQL', () => {
		privateEnv.SCRAPSCACHE_RELAY_DB_URL = 'postgres://relay';
		expect(() => getDb()).toThrow('SCRAPSCACHE_RELAY_DB_URL must be a libSQL URL');
	});
});

describe('server database metadata', () => {
	it('selects one stable winner during concurrent initialization', async () => {
		const db = testDb();
		const candidates = Array.from({ length: 20 }, (_, index) => `candidate-${index}`);
		const winners = await Promise.all(
			candidates.map((candidate) => setMetaIfAbsent(db, 'singleton', candidate))
		);

		expect(new Set(winners).size).toBe(1);
		expect(await getMeta(db, 'singleton')).toBe(winners[0]);
	});
});
