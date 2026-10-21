import { processActivity, type ProcessActivity } from '#lib/server/metrics.js';
import { bytesToGigabytes, staleBeforeMs } from '#lib/server/operatorConfig.js';
import { getDb } from '#lib/server/db.js';
import { getRetentionStatus, type RetentionStatus } from '#lib/server/retentionSweep.js';
import { getRuntimeSettings } from '#lib/server/runtimeSettings.js';
import { getSyncStore, type OperatorUsage, type SyncQuotas } from '#lib/server/syncStore.js';

export type OperatorSnapshot = {
	generatedAt: number;
	storage: {
		ciphertextBytes: number;
		storageBytes: number;
		gigabytes: number;
		envelopes: number;
	};
	accounts: {
		total: number;
		active: Record<string, number>;
		staleForRetention: number | null;
	};
	/** Null where no single process sees every request. */
	activity: ProcessActivity | null;
	retention: RetentionStatus;
	quotas: SyncQuotas;
};

export function buildOperatorSnapshot(
	usage: OperatorUsage,
	quotas: SyncQuotas,
	activity: ProcessActivity | null,
	retention: RetentionStatus,
	now: number,
	retentionInactiveDays: number
): OperatorSnapshot {
	return {
		generatedAt: now,
		storage: {
			ciphertextBytes: usage.ciphertextBytes,
			storageBytes: usage.storageBytes,
			gigabytes: bytesToGigabytes(usage.storageBytes),
			envelopes: usage.envelopeCount
		},
		accounts: {
			total: usage.accounts,
			active: usage.activeByWindowDays,
			staleForRetention: retentionInactiveDays > 0 ? usage.staleAccounts : null
		},
		activity,
		retention,
		quotas
	};
}

export async function getOperatorSnapshot(now = Date.now()): Promise<OperatorSnapshot> {
	const store = getSyncStore();
	const db = getDb();
	const settings = await getRuntimeSettings(db);
	const retentionInactiveDays = settings.retentionInactiveDays;
	const usage = await store.operatorUsage({
		now,
		staleBefore: staleBeforeMs(retentionInactiveDays, now)
	});
	return buildOperatorSnapshot(
		usage,
		store.getQuotas(settings.maxAccountBytes),
		processActivity(),
		await getRetentionStatus(db, retentionInactiveDays),
		now,
		retentionInactiveDays
	);
}
