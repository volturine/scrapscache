import { env } from 'cloudflare:workers';
import type { D1Database, DurableObjectNamespace, R2Bucket } from '@cloudflare/workers-types';
import { getRequestEvent } from '$app/server';

export type CloudflareBindings = {
	SCRAPSCACHE_DB: D1Database;
	SCRAPSCACHE_ENVELOPES: R2Bucket;
	ACCOUNT_COORDINATOR: DurableObjectNamespace;
	/** Per-account reminder schedulers, defined in the separate reminders Worker. */
	REMINDER_SCHEDULER: DurableObjectNamespace;
	SCRAPSCACHE_SYNC_MAX_ACCOUNT_BYTES?: string;
	SCRAPSCACHE_HISTORY_VERSIONS?: string;
};

export function cloudflareBindings(): CloudflareBindings {
	if (typeof env !== 'undefined' && env && Object.keys(env).length > 0) {
		return env as unknown as CloudflareBindings;
	}
	try {
		const platformEnv = (getRequestEvent()?.platform as { env?: unknown } | undefined)?.env;
		if (platformEnv) return platformEnv as unknown as CloudflareBindings;
	} catch {
		// Outside request context
	}
	if (env && Object.keys(env).length > 0) return env as unknown as CloudflareBindings;
	throw new Error('Cloudflare platform bindings are unavailable');
}
