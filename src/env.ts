import { defineEnvVars } from '@sveltejs/kit/env';

// @migration-task Review usage of dynamic environment variables. They fall back to the empty string if not present, which may not be what you want.
export const variables = defineEnvVars({
	SCRAPSCACHE_TICK_SECRET: { schema: (input) => input ?? '' },
	SCRAPSCACHE_ADMIN_TOKEN: { schema: (input) => input ?? '' },
	SCRAPSCACHE_RELAY_DB_URL: { schema: (input) => input ?? '' },
	SCRAPSCACHE_RELAY_DB_AUTH_TOKEN: { schema: (input) => input ?? '' },
	SCRAPSCACHE_OPS_DB_URL: { schema: (input) => input ?? '' },
	SCRAPSCACHE_OPS_DB_AUTH_TOKEN: { schema: (input) => input ?? '' },
	SCRAPSCACHE_REMINDER_MAX_ACCOUNT_BYTES: { schema: (input) => input ?? '' },
	SCRAPSCACHE_VAPID_SUBJECT: { schema: (input) => input ?? '' },
	SCRAPSCACHE_ORIGIN: { schema: (input) => input ?? '' },
	ORIGIN: { schema: (input) => input ?? '' },
	SCRAPSCACHE_SYNC_MAX_ACCOUNT_BYTES: { schema: (input) => input ?? '' },
	SCRAPSCACHE_SYNC_MAX_CONCURRENT_REQUESTS: { schema: (input) => input ?? '' },
	SCRAPSCACHE_RETENTION_INACTIVE_DAYS: { schema: (input) => input ?? '' },
	SCRAPSCACHE_ALLOW_INDEXING: { schema: (input) => input ?? '' },
	SCRAPSCACHE_HISTORY_VERSIONS: { schema: (input) => input ?? '' },
	TURNSTILE_SITEKEY: { schema: (input) => input ?? '' },
	TURNSTILE_SECRET: { schema: (input) => input ?? '' },
	TURNSTILE_HOSTNAMES: { schema: (input) => input ?? '' },
	PUBLIC_TURNSTILE_ORIGIN: { public: true, schema: (input) => input ?? '' },
	SCRAPSCACHE_VAPID_PUBLIC_KEY: { schema: (input) => input ?? '' },
	SCRAPSCACHE_VAPID_PRIVATE_KEY: { schema: (input) => input ?? '' }
});
