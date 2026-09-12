import { createClient, type Client } from '@libsql/client/node';
import { readFileSync } from 'node:fs';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

/**
 * Real SQLite behind the D1 surface `d1.ts` uses, so Cloudflare store queries are
 * exercised as SQL rather than as assertions about mock calls. The Workers runtime
 * differences that remain (batch atomicity, subrequest limits) are not what these
 * tests are checking.
 */
export function testD1(): { db: D1Database; client: Client } {
	const client = createClient({ url: ':memory:' });
	const prepare = (sql: string, args: readonly unknown[]) => ({
		bind: (...bound: unknown[]) => prepare(sql, bound),
		async run() {
			const result = await client.execute({ sql, args: args as never });
			return { results: result.rows, meta: { changes: result.rowsAffected } };
		}
	});
	const db = {
		prepare: (sql: string) => prepare(sql, []),
		batch: (statements: { run(): Promise<unknown> }[]) =>
			Promise.all(statements.map((statement) => statement.run()))
	};
	return { db: db as unknown as D1Database, client };
}

export async function applyMigrations(client: Client): Promise<void> {
	await client.executeMultiple(readFileSync('cf/migrations/0001_initial.sql', 'utf8'));
}

/**
 * In-memory R2. `writes` counts put calls rather than surviving objects, because
 * an operation that is paid for and then undone still costs the same as one that
 * is kept, and the end state cannot tell the two apart.
 */
export function testR2(): {
	bucket: R2Bucket;
	objects: Map<string, string>;
	writes: () => number;
} {
	const objects = new Map<string, string>();
	let writes = 0;
	const bucket = {
		put: async (key: string, value: string) => {
			writes += 1;
			objects.set(key, value);
		},
		get: async (key: string) => (objects.has(key) ? { text: async () => objects.get(key)! } : null),
		delete: async (key: string) => void objects.delete(key)
	};
	return { bucket: bucket as unknown as R2Bucket, objects, writes: () => writes };
}
