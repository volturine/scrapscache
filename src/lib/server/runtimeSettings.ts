import { env } from '$env/dynamic/private';
import { getDb, type Db } from '$lib/server/db';
import {
	DEFAULT_SYNC_PER_MINUTE,
	parseMaxAccountBytes,
	parseRetentionInactiveDays
} from '$lib/server/operatorConfig';

export const DEFAULT_MAX_CONCURRENT_SYNC_REQUESTS = 8;

export type RuntimeSettings = {
	maxAccountBytes: number;
	syncPerMinute: number;
	maxConcurrentSyncRequests: number;
	retentionInactiveDays: number;
	allowIndexing: boolean;
	vapidSubject: string;
};

export type RuntimeSettingsPatch = Partial<{
	[Key in keyof RuntimeSettings]: RuntimeSettings[Key] | null;
}>;

export type RuntimeSettingsState = {
	values: RuntimeSettings;
	defaults: RuntimeSettings;
	overrides: Partial<RuntimeSettings>;
};

const PREFIX = 'runtime-setting:';
const SETTING_NAMES = [
	'maxAccountBytes',
	'syncPerMinute',
	'maxConcurrentSyncRequests',
	'retentionInactiveDays',
	'allowIndexing',
	'vapidSubject'
] as const satisfies ReadonlyArray<keyof RuntimeSettings>;
const SETTING_NAME_SET = new Set<string>(SETTING_NAMES);

function positiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultVapidSubject(): string {
	const configured = env.SCRAPSCACHE_VAPID_SUBJECT?.trim();
	if (configured && (/^mailto:/i.test(configured) || /^https:/i.test(configured))) {
		return configured;
	}
	const origin = env.SCRAPSCACHE_ORIGIN?.trim() || env.ORIGIN?.trim();
	return origin && /^https:/i.test(origin)
		? origin.replace(/\/$/, '')
		: 'mailto:scrapscache@localhost';
}

export function defaultRuntimeSettings(): RuntimeSettings {
	return {
		maxAccountBytes: parseMaxAccountBytes(env.SCRAPSCACHE_SYNC_MAX_ACCOUNT_BYTES),
		syncPerMinute: DEFAULT_SYNC_PER_MINUTE,
		maxConcurrentSyncRequests: positiveInteger(
			env.SCRAPSCACHE_SYNC_MAX_CONCURRENT_REQUESTS,
			DEFAULT_MAX_CONCURRENT_SYNC_REQUESTS
		),
		retentionInactiveDays: parseRetentionInactiveDays(env.SCRAPSCACHE_RETENTION_INACTIVE_DAYS),
		allowIndexing: env.SCRAPSCACHE_ALLOW_INDEXING === 'true',
		vapidSubject: defaultVapidSubject()
	};
}

function isSettingValue<Key extends keyof RuntimeSettings>(
	key: Key,
	value: unknown
): value is RuntimeSettings[Key] {
	switch (key) {
		case 'maxAccountBytes':
		case 'syncPerMinute':
		case 'maxConcurrentSyncRequests':
			return Number.isSafeInteger(value) && Number(value) > 0;
		case 'retentionInactiveDays':
			return Number.isSafeInteger(value) && Number(value) >= 0;
		case 'allowIndexing':
			return typeof value === 'boolean';
		case 'vapidSubject':
			return (
				typeof value === 'string' &&
				value.length <= 512 &&
				(/^mailto:/i.test(value) || /^https:/i.test(value))
			);
	}
}

export function parseRuntimeSettingsPatch(value: unknown): RuntimeSettingsPatch {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new RangeError('Settings must be an object');
	}
	const patch: RuntimeSettingsPatch = {};
	for (const [name, raw] of Object.entries(value)) {
		if (!SETTING_NAME_SET.has(name)) throw new RangeError(`Unknown setting: ${name}`);
		const key = name as keyof RuntimeSettings;
		if (raw === null) {
			Object.assign(patch, { [key]: null });
			continue;
		}
		const normalized = key === 'vapidSubject' && typeof raw === 'string' ? raw.trim() : raw;
		if (!isSettingValue(key, normalized)) {
			throw new RangeError(`Invalid value for ${key}`);
		}
		Object.assign(patch, { [key]: normalized });
	}
	return patch;
}

export async function getRuntimeSettingsState(db: Db = getDb()): Promise<RuntimeSettingsState> {
	await db.ready;
	const rows = (
		await db.ops.execute({
			sql: `SELECT key, value FROM meta WHERE key LIKE ?`,
			args: [`${PREFIX}%`]
		})
	).rows as unknown as Array<{ key: string; value: string }>;
	const overrides: Partial<RuntimeSettings> = {};
	for (const row of rows) {
		const name = row.key.slice(PREFIX.length);
		if (!SETTING_NAME_SET.has(name)) continue;
		const key = name as keyof RuntimeSettings;
		try {
			const value: unknown = JSON.parse(row.value);
			if (isSettingValue(key, value)) Object.assign(overrides, { [key]: value });
		} catch {
			// Ignore a corrupt row and keep the safe deployment default.
		}
	}
	const defaults = defaultRuntimeSettings();
	return { defaults, overrides, values: { ...defaults, ...overrides } };
}

export async function getRuntimeSettings(db: Db = getDb()): Promise<RuntimeSettings> {
	return (await getRuntimeSettingsState(db)).values;
}

export async function updateRuntimeSettings(
	patch: RuntimeSettingsPatch,
	db: Db = getDb()
): Promise<RuntimeSettingsState> {
	await db.ready;
	const statements = Object.entries(patch).map(([name, value]) =>
		value === null
			? { sql: 'DELETE FROM meta WHERE key = ?', args: [`${PREFIX}${name}`] }
			: {
					sql: `INSERT INTO meta(key, value) VALUES (?, ?)
						ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
					args: [`${PREFIX}${name}`, JSON.stringify(value)]
				}
	);
	if (statements.length > 0) await db.ops.batch(statements, 'write');
	return getRuntimeSettingsState(db);
}
