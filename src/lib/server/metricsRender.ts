/** Prometheus rendering, shared by both deployments. Where the counters come
 * from differs; what they look like on the wire should not. */

export type ProcessActivity = {
	syncRequests: number;
	syncUploadEnvelopes: number;
	syncDeleteSlots: number;
	rateLimited: number;
	sqliteBusy: number;
	reminderWakesSent: number;
	reminderWakesGone: number;
	reminderWakesFailed: number;
};

export type HttpSample = { route: string; status: string; count: number; durationMs: number };

/**
 * Counters a single process accumulated in memory.
 *
 * `null` where no one process sees them all. On Workers each isolate is
 * short-lived and holds its own copy, so a scrape would report whichever isolate
 * happened to answer — a number that looks like a total and is not one. Those
 * deployments emit counters to a telemetry dataset instead, and omit them here
 * rather than publish a figure nobody should act on.
 */
export type MetricsSnapshot = { http: HttpSample[]; activity: ProcessActivity } | null;

export type MetricsUsage = {
	accounts: number;
	envelopeCount: number;
	ciphertextBytes: number;
	gigabytes?: number;
	activeByWindowDays?: Record<string, number>;
	staleAccounts?: number;
};

export type MetricsRetention = {
	enabled: boolean;
	inactiveDays: number;
	lastRunAt: number;
	deletedAccountsTotal: number;
};

function line(name: string, value: number, labels = ''): string {
	return `${name}${labels ? `{${labels}}` : ''} ${Number.isFinite(value) ? value : 0}`;
}

export function renderMetrics(
	usage: MetricsUsage,
	retention?: MetricsRetention,
	snapshot: MetricsSnapshot = null
): string {
	const lines: string[] = [];
	if (snapshot) {
		lines.push(
			'# TYPE scrapscache_http_requests_total counter',
			'# TYPE scrapscache_http_request_duration_milliseconds_sum counter'
		);
		for (const sample of snapshot.http) {
			const labels = `route=${JSON.stringify(sample.route)},status=${JSON.stringify(sample.status)}`;
			lines.push(line('scrapscache_http_requests_total', sample.count, labels));
			lines.push(
				line('scrapscache_http_request_duration_milliseconds_sum', sample.durationMs, labels)
			);
		}
		const activity = snapshot.activity;
		lines.push(
			'# TYPE scrapscache_rate_limited_total counter',
			line('scrapscache_rate_limited_total', activity.rateLimited),
			'# TYPE scrapscache_sync_requests_total counter',
			line('scrapscache_sync_requests_total', activity.syncRequests),
			'# TYPE scrapscache_sync_upload_envelopes_total counter',
			line('scrapscache_sync_upload_envelopes_total', activity.syncUploadEnvelopes),
			'# TYPE scrapscache_sync_delete_slots_total counter',
			line('scrapscache_sync_delete_slots_total', activity.syncDeleteSlots),
			'# TYPE scrapscache_sqlite_busy_total counter',
			line('scrapscache_sqlite_busy_total', activity.sqliteBusy),
			'# TYPE scrapscache_reminder_wakes_sent_total counter',
			line('scrapscache_reminder_wakes_sent_total', activity.reminderWakesSent),
			'# TYPE scrapscache_reminder_wakes_gone_total counter',
			line('scrapscache_reminder_wakes_gone_total', activity.reminderWakesGone),
			'# TYPE scrapscache_reminder_wakes_failed_total counter',
			line('scrapscache_reminder_wakes_failed_total', activity.reminderWakesFailed)
		);
	}
	lines.push(
		'# TYPE scrapscache_sync_accounts gauge',
		line('scrapscache_sync_accounts', usage.accounts),
		'# TYPE scrapscache_sync_envelopes gauge',
		line('scrapscache_sync_envelopes', usage.envelopeCount),
		'# TYPE scrapscache_sync_ciphertext_bytes gauge',
		line('scrapscache_sync_ciphertext_bytes', usage.ciphertextBytes),
		'# TYPE scrapscache_sync_storage_gigabytes gauge',
		line('scrapscache_sync_storage_gigabytes', usage.gigabytes ?? 0),
		'# TYPE scrapscache_sync_stale_accounts gauge',
		line('scrapscache_sync_stale_accounts', usage.staleAccounts ?? 0)
	);
	if (usage.activeByWindowDays) {
		lines.push('# TYPE scrapscache_sync_accounts_active gauge');
		for (const [windowDays, count] of Object.entries(usage.activeByWindowDays)) {
			lines.push(
				line('scrapscache_sync_accounts_active', count, `window_days=${JSON.stringify(windowDays)}`)
			);
		}
	}
	if (retention) {
		lines.push(
			'# TYPE scrapscache_retention_enabled gauge',
			line('scrapscache_retention_enabled', retention.enabled ? 1 : 0),
			'# TYPE scrapscache_retention_inactive_days gauge',
			line('scrapscache_retention_inactive_days', retention.inactiveDays),
			'# TYPE scrapscache_retention_last_run_timestamp_seconds gauge',
			line('scrapscache_retention_last_run_timestamp_seconds', retention.lastRunAt / 1000),
			'# TYPE scrapscache_retention_deleted_accounts_total counter',
			line('scrapscache_retention_deleted_accounts_total', retention.deletedAccountsTotal)
		);
	}
	return `${lines.join('\n')}\n`;
}
