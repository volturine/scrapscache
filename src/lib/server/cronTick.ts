import { getDb } from '#lib/server/db.js';
import { getSyncAuth } from '#lib/server/syncAuth.js';
import { getPairingSessions } from '#lib/server/pairingSessions.js';
import { pruneRateBuckets } from '#lib/server/rateLimit.js';
import { getSyncStore } from '#lib/server/syncStore.js';
import {
	getRetentionStatus,
	runRetentionSweep,
	type RetentionStatus
} from '#lib/server/retentionSweep.js';

export type CronTickResult = {
	retention: RetentionStatus;
	retentionSkipped: boolean;
};

/**
 * Maintenance: run the daily retention sweep when due and prune expired
 * operational state. Invoked hourly by the platform cron (the maintenance
 * Worker's Cron Trigger or a self-host crontab). Reminders never wait for it:
 * each is delivered at its own time by the wake timer.
 */
export async function runCronTick(now = Date.now()): Promise<CronTickResult> {
	const db = getDb();
	await db.ready;
	const retention = await runRetentionSweep({ now: () => now });
	await pruneRateBuckets(db, now);
	await getSyncAuth().pruneExpired(now);
	await getPairingSessions().prune(now);
	await getSyncStore().pruneStaleWakes(now);
	return {
		retention: retention ?? (await getRetentionStatus(db)),
		retentionSkipped: retention == null
	};
}
