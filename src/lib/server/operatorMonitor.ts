import { processActivity, type ProcessActivity } from '$lib/server/metrics';
import {
	bytesToGigabytes,
	parseRetentionInactiveDays,
	staleBeforeMs
} from '$lib/server/operatorConfig';
import { getRetentionStatus, type RetentionStatus } from '$lib/server/retentionSweep';
import { getSyncStore, type OperatorUsage, type SyncQuotas } from '$lib/server/syncStore';

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
	/** Null where no single process sees every request; `telemetry` says where
	 * the counters actually live. */
	activity: ProcessActivity | null;
	telemetry: { source: 'process' | 'dataset' };
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
		telemetry: { source: activity ? 'process' : 'dataset' },
		retention,
		quotas
	};
}

export async function getOperatorSnapshot(now = Date.now()): Promise<OperatorSnapshot> {
	const store = getSyncStore();
	const retentionInactiveDays = parseRetentionInactiveDays();
	const usage = await store.operatorUsage({
		now,
		staleBefore: staleBeforeMs(retentionInactiveDays, now)
	});
	return buildOperatorSnapshot(
		usage,
		store.getQuotas(),
		processActivity(),
		await getRetentionStatus(),
		now,
		retentionInactiveDays
	);
}
