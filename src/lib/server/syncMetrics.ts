/**
 * Per-phase timings for one relay sync round, reported through whichever
 * metrics module the deployment swaps in. Phases name where a round's wall
 * time actually goes — reads, the object-storage work, the commit, the
 * post-commit tail — so an operator can see where the wall time went instead
 * of guessing. Measuring is the point: every later change to the relay
 * ordering gets to be judged on these numbers, not on intuition.
 */

export type SyncPhase =
	/** Account, quota, page, slot and history reads before anything else. */
	| 'reads'
	/** Fetching a download page's ciphertext out of object storage. */
	| 'r2_get'
	/** Uploading: ciphertext writes to object storage. */
	| 'r2_put'
	/** The D1 batch that commits uploads and deletions. */
	| 'commit'
	/** Pruning, purging, eviction and usage bookkeeping after the commit. */
	| 'tail';

/** One live run. `stop` without `start` (or twice) records nothing, so a sloppy
 * call site can never add a wrong number, and a phase may be stopped and
 * measured separately again. */
export type SyncTimings = {
	start(phase: SyncPhase): void;
	stop(phase: SyncPhase): void;
	count(phase: SyncPhase, calls: number): void;
	timings(): Record<string, number>;
};

const PHASES: SyncPhase[] = ['reads', 'r2_get', 'r2_put', 'commit', 'tail'];

export function createSyncTimings(): SyncTimings {
	const started = new Map<SyncPhase, number>();
	const ms = new Map<SyncPhase, number>();
	const calls = new Map<SyncPhase, number>();
	return {
		start(phase) {
			started.set(phase, Date.now());
		},
		stop(phase) {
			const began = started.get(phase);
			if (began !== undefined) {
				ms.set(phase, (ms.get(phase) ?? 0) + Math.max(0, Math.round(Date.now() - began)));
				started.delete(phase);
			}
		},
		count(phase, amount) {
			calls.set(phase, (calls.get(phase) ?? 0) + amount);
		},
		timings() {
			const report: Record<string, number> = {};
			for (const phase of PHASES) {
				const duration = ms.get(phase) ?? 0;
				if (duration > 0) report[`sync_ms phase:${phase}`] = duration;
				const amount = calls.get(phase) ?? 0;
				if (amount > 0) report[`sync_calls phase:${phase}`] = amount;
			}
			return report;
		}
	};
}
