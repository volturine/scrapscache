import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { batch, execute } from './d1';

type Bindings = { SCRAPSCACHE_DB: D1Database; SCRAPSCACHE_ENVELOPES: R2Bucket };

/** R2 deletes up to 1,000 keys in one call; each call is one Workers subrequest. */
const R2_DELETE_BATCH = 1_000;

/** Delete objects in as few subrequests as R2 allows. */
export async function deleteObjects(bucket: R2Bucket, keys: string[]): Promise<void> {
	for (let index = 0; index < keys.length; index += R2_DELETE_BATCH)
		await bucket.delete(keys.slice(index, index + R2_DELETE_BATCH));
}

/**
 * Drop history rows and any object nothing else in their account still names. Objects go
 * first, rows second: a run cut short leaves a row whose object is already gone, which the
 * next run removes, rather than an object no row points at any more. Each chunk costs three
 * subrequests (one reference query naming each id twice, inside D1's 100 bound parameters).
 */
export async function deleteHistoryRows(
	env: Bindings,
	rows: Array<{ historyId: number }>
): Promise<void> {
	for (let index = 0; index < rows.length; index += 49) {
		const ids = rows.slice(index, index + 49).map((row) => Number(row.historyId));
		const list = ids.map(() => '?').join(', ');
		const unreferenced = (
			await execute(env.SCRAPSCACHE_DB, {
				sql: `SELECT history.r2_key AS r2Key FROM envelope_history AS history
				WHERE history.history_id IN (${list})
				AND NOT EXISTS (SELECT 1 FROM envelopes AS live
					WHERE live.account_id = history.account_id AND live.r2_key = history.r2_key)
				AND NOT EXISTS (SELECT 1 FROM deleted_envelopes AS deleted
					WHERE deleted.account_id = history.account_id AND deleted.r2_key = history.r2_key)
				AND NOT EXISTS (SELECT 1 FROM envelope_history AS other
					WHERE other.r2_key = history.r2_key AND other.history_id NOT IN (${list}))`,
				args: [...ids, ...ids]
			})
		).rows.map((row) => String(row.r2Key));
		await deleteObjects(env.SCRAPSCACHE_ENVELOPES, [...new Set(unreferenced)]);
		await batch(
			env.SCRAPSCACHE_DB,
			ids.map((id) => ({ sql: 'DELETE FROM envelope_history WHERE history_id = ?', args: [id] }))
		);
	}
}

/**
 * A history row counted in quota: an older version of a record that still exists. The live
 * copy each record's history holds is already counted.
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

/**
 * Remove records deleted for good: their remaining versions, then the deleted copies' objects,
 * then the rows that staged them. The coordinator runs this for its own deletes right after
 * committing them; the daily sweep runs it for everything a cut-short request left behind.
 */
export async function purgeDeletedRecords(
	env: Bindings,
	scope?: { accountId: string; slots: string[] }
): Promise<number> {
	const filter = scope
		? `deleted.account_id = ? AND deleted.slot IN (${scope.slots.map(() => '?').join(', ')})`
		: '1 = 1';
	const args = scope ? [scope.accountId, ...scope.slots] : [];
	const history = (
		await execute(env.SCRAPSCACHE_DB, {
			sql: `SELECT history.history_id AS historyId
			FROM envelope_history AS history
			JOIN deleted_envelopes AS deleted
				ON deleted.account_id = history.account_id AND deleted.slot = history.slot
			WHERE ${filter} AND NOT EXISTS (
				SELECT 1 FROM envelopes AS live
				WHERE live.account_id = history.account_id AND live.slot = history.slot
			)`,
			args
		})
	).rows as Array<{ historyId: number }>;
	await deleteHistoryRows(env, history);
	// A record written again may still hold the old object among its versions.
	const deleted = (
		await execute(env.SCRAPSCACHE_DB, {
			sql: `SELECT deleted.account_id AS accountId, deleted.slot AS slot, deleted.r2_key AS r2Key,
				NOT EXISTS (SELECT 1 FROM envelopes AS live
					WHERE live.account_id = deleted.account_id AND live.r2_key = deleted.r2_key)
				AND NOT EXISTS (SELECT 1 FROM envelope_history AS history
					WHERE history.account_id = deleted.account_id AND history.r2_key = deleted.r2_key)
				AS unreferenced
			FROM deleted_envelopes AS deleted WHERE ${filter}`,
			args
		})
	).rows as Array<{ accountId: string; slot: string; r2Key: string; unreferenced: number }>;
	await deleteObjects(
		env.SCRAPSCACHE_ENVELOPES,
		deleted.filter((row) => Number(row.unreferenced)).map((row) => String(row.r2Key))
	);
	for (let index = 0; index < deleted.length; index += 100)
		await batch(
			env.SCRAPSCACHE_DB,
			deleted.slice(index, index + 100).map((row) => ({
				sql: 'DELETE FROM deleted_envelopes WHERE account_id = ? AND slot = ? AND r2_key = ?',
				args: [String(row.accountId), String(row.slot), String(row.r2Key)]
			}))
		);
	return deleted.length;
}
