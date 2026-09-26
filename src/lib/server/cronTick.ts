import { getDb } from '$lib/server/db';
import { getSyncAuth } from '$lib/server/syncAuth';
import { getPairingSessions } from '$lib/server/pairingSessions';
import { pruneRateBuckets } from '$lib/server/rateLimit';
import { getSyncStore } from '$lib/server/syncStore';
import {
	getRetentionStatus,
	runRetentionSweep,
	type RetentionStatus
} from '$lib/server/retentionSweep';

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
