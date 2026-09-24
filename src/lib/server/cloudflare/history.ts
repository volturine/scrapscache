import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { batch, execute } from './d1';

/**
 * Drop history rows and any object nothing else still names. Objects go first, rows
 * second: a run cut short leaves a row whose object is already gone, which the next run
 * removes, rather than an object no row points at any more. Chunks keep each reference
 * query inside D1's 100 bound parameters.
 */
export async function deleteHistoryRows(
	env: { SCRAPSCACHE_DB: D1Database; SCRAPSCACHE_ENVELOPES: R2Bucket },
	rows: Array<{ historyId: number; r2Key: string }>
): Promise<void> {
	for (let index = 0; index < rows.length; index += 20) {
		const group = rows.slice(index, index + 20);
		const keys = group.map((row) => String(row.r2Key));
		const ids = group.map((row) => Number(row.historyId));
		const list = (values: unknown[]) => values.map(() => '?').join(', ');
		const held = new Set(
			(
				await execute(env.SCRAPSCACHE_DB, {
					sql: `SELECT r2_key AS r2Key FROM envelopes WHERE r2_key IN (${list(keys)})
					UNION SELECT r2_key FROM deleted_envelopes WHERE r2_key IN (${list(keys)})
					UNION SELECT r2_key FROM envelope_history
						WHERE r2_key IN (${list(keys)}) AND history_id NOT IN (${list(ids)})`,
					args: [...keys, ...keys, ...keys, ...ids]
				})
			).rows.map((row) => String(row.r2Key))
		);
		const unreferenced = keys.filter((key) => !held.has(key));
		if (unreferenced.length) await env.SCRAPSCACHE_ENVELOPES.delete(unreferenced);
		await batch(
			env.SCRAPSCACHE_DB,
			ids.map((id) => ({ sql: 'DELETE FROM envelope_history WHERE history_id = ?', args: [id] }))
		);
	}
}

/**
 * A history row counted in quota: an older version of a record that still exists. The live
 * copy each record's history holds is already counted, and a deleted record's versions are
 * kept only through its deletion grace, like the deleted copy itself.
 */
export const OLDER_VERSION = `EXISTS (
	SELECT 1 FROM envelopes AS live
	WHERE live.account_id = history.account_id AND live.slot = history.slot AND live.id != history.id
)`;

/** Count and bytes of the older versions the given records hold. */
export async function olderVersions(
	db: D1Database,
	accountId: string,
	slots: string[]
): Promise<{ versions: number; bytes: number }> {
	let versions = 0;
	let bytes = 0;
	for (let index = 0; index < slots.length; index += 90) {
		const group = slots.slice(index, index + 90);
		const row = (
			await execute(db, {
				sql: `SELECT COUNT(*) AS versions, COALESCE(SUM(ciphertext_bytes), 0) AS bytes
				FROM envelope_history AS history
				WHERE account_id = ? AND slot IN (${group.map(() => '?').join(', ')}) AND ${OLDER_VERSION}`,
				args: [accountId, ...group]
			})
		).rows[0] as { versions: number; bytes: number } | undefined;
		versions += Number(row?.versions ?? 0);
		bytes += Number(row?.bytes ?? 0);
	}
	return { versions, bytes };
}
