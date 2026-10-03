import { env } from 'cloudflare:workers';
import type { D1Database, DurableObjectNamespace, R2Bucket } from '@cloudflare/workers-types';

export type CloudflareBindings = {
	SCRAPSCACHE_DB: D1Database;
	SCRAPSCACHE_ENVELOPES: R2Bucket;
	ACCOUNT_COORDINATOR: DurableObjectNamespace;
	/** Per-account reminder schedulers, defined in the separate reminders Worker. */
	REMINDER_SCHEDULER: DurableObjectNamespace;
	SCRAPSCACHE_SYNC_MAX_ACCOUNT_BYTES?: string;
	SCRAPSCACHE_HISTORY_VERSIONS?: string;
};

/** SvelteKit 3 no longer passes bindings on `platform`; the Workers runtime exposes them. */
export function cloudflareBindings(): CloudflareBindings {
	if (!env.SCRAPSCACHE_DB) throw new Error('Cloudflare platform bindings are unavailable');
	return env as unknown as CloudflareBindings;
}
