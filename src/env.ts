import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Every variable is optional: blank and unset both mean "not configured", and the
 * module that reads one applies its own default. Values stay strings because the
 * Cloudflare Durable Objects parse the same settings from their own bindings.
 */
function optional(description: string, options: { public?: boolean } = {}) {
	return {
		...options,
		description,
		schema: (value: string | undefined) => value || undefined
	};
}

export const variables = defineEnvVars({
	SCRAPSCACHE_ORIGIN: optional(
		'Exact public origin of this deployment, e.g. https://notes.example'
	),
	SCRAPSCACHE_ADMIN_TOKEN: optional('Bearer token for the operator API and dashboard'),
	SCRAPSCACHE_TICK_SECRET: optional('Bearer token for the scheduled cron endpoints'),
	SCRAPSCACHE_RELAY_DB_URL: optional('libSQL URL of the relay database'),
	SCRAPSCACHE_RELAY_DB_AUTH_TOKEN: optional('Auth token for the relay database'),
	SCRAPSCACHE_OPS_DB_URL: optional('libSQL URL of the operations database'),
	SCRAPSCACHE_OPS_DB_AUTH_TOKEN: optional('Auth token for the operations database'),
	SCRAPSCACHE_SYNC_MAX_ACCOUNT_BYTES: optional('Relay storage quota per account, in bytes'),
	SCRAPSCACHE_SYNC_MAX_CONCURRENT_REQUESTS: optional('Sync requests the relay serves at once'),
	SCRAPSCACHE_REMINDER_MAX_ACCOUNT_BYTES: optional(
		'Reminder receipt storage per account, in bytes'
	),
	SCRAPSCACHE_HISTORY_VERSIONS: optional('Versions the relay keeps per record'),
	SCRAPSCACHE_RETENTION_INACTIVE_DAYS: optional(
		'Days before an inactive account is deleted; 0 keeps all'
	),
	SCRAPSCACHE_ALLOW_INDEXING: optional('"true" lets search engines index the public pages'),
	SCRAPSCACHE_VAPID_SUBJECT: optional('Contact for Web Push services, as mailto: or https:'),
	SCRAPSCACHE_VAPID_PUBLIC_KEY: optional('Web Push public key; generated and stored when unset'),
	SCRAPSCACHE_VAPID_PRIVATE_KEY: optional('Web Push private key; set together with the public key'),
	TURNSTILE_SITEKEY: optional('Cloudflare Turnstile site key'),
	TURNSTILE_SECRET: optional('Cloudflare Turnstile secret key'),
	TURNSTILE_HOSTNAMES: optional('Comma-separated hostnames Turnstile tokens may be issued for'),
	PUBLIC_TURNSTILE_ORIGIN: optional('Separate origin that hosts the Turnstile challenge', {
		public: true
	})
});
