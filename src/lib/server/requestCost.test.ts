import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { batch, execute } from './cloudflare/d1';
import { measureRequestCost, nameRequestCost, newRequestCost } from './requestCost';

/** A D1 binding whose every statement reports the given billed rows. */
function d1(rowsRead: number, rowsWritten: number): D1Database {
	const statement = {
		bind: () => statement,
		run: async () => {
			await Promise.resolve();
			return {
				results: [],
				meta: { changes: rowsWritten, rows_read: rowsRead, rows_written: rowsWritten }
			};
		}
	};
	return {
		prepare: () => statement,
		batch: (statements: (typeof statement)[]) => Promise.all(statements.map((each) => each.run()))
	} as unknown as D1Database;
}

describe('request database cost', () => {
	it('adds up the rows D1 bills for every statement and batch the request runs', async () => {
		const db = d1(3, 1);
		const cost = newRequestCost();
		const result = await measureRequestCost(cost, async () => {
			nameRequestCost('empty');
			await execute(db, 'SELECT 1');
			return batch(db, [{ sql: 'SELECT 2' }, { sql: 'SELECT 3' }]);
		});

		expect(result.map(({ rowsRead, rowsWritten }) => [rowsRead, rowsWritten])).toEqual([
			[3, 1],
			[3, 1]
		]);
		expect(cost).toEqual({ kind: 'empty', queries: 3, rowsRead: 9, rowsWritten: 3, phases: {} });
	});

	it('keeps concurrent requests apart', async () => {
		const first = newRequestCost();
		const second = newRequestCost();
		await Promise.all([
			measureRequestCost(first, () => execute(d1(5, 0), 'SELECT 1')),
			measureRequestCost(second, async () => {
				await execute(d1(1, 2), 'SELECT 1');
				await execute(d1(1, 2), 'SELECT 1');
			})
		]);

		expect([first.queries, first.rowsRead, first.rowsWritten]).toEqual([1, 5, 0]);
		expect([second.queries, second.rowsRead, second.rowsWritten]).toEqual([2, 2, 4]);
	});

	it('counts nothing, and does not fail, outside a measured request', async () => {
		await expect(execute(d1(1, 1), 'SELECT 1')).resolves.toMatchObject({ rowsRead: 1 });
		expect(() => nameRequestCost('unmeasured')).not.toThrow();
	});
});
