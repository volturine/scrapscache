import { metricsSnapshot } from '$lib/server/metrics';
import type { HttpSample, ProcessActivity } from '$lib/server/metricsRender';

export type TelemetryReport = {
	/** False when counters exist somewhere this deployment cannot read them from. */
	available: boolean;
	source: 'process' | 'dataset';
	/** Null when the numbers are process-lifetime rather than windowed. */
	windowHours: number | null;
	activity: ProcessActivity | null;
	http: HttpSample[];
	note?: string;
};

/** One process has seen every request it served, so the window is its own
 * lifetime and there is nothing to query. */
export async function queryTelemetry(_windowHours: number): Promise<TelemetryReport> {
	const snapshot = metricsSnapshot();
	if (!snapshot) {
		return {
			available: false,
			source: 'process',
			windowHours: null,
			activity: null,
			http: [],
			note: 'No counters available in this process.'
		};
	}
	return {
		available: true,
		source: 'process',
		windowHours: null,
		activity: snapshot.activity,
		http: snapshot.http
	};
}
