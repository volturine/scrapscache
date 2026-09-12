import {
	ACTIVITY_WINDOWS_DAYS,
	DEFAULT_SYNC_PER_MINUTE,
	parseMaxAccountBytes
} from '$lib/server/operatorConfig';
import { batch, execute, type SqlStatement } from './d1';
import { cloudflareBindings } from './env';
import { MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST } from '$lib/syncLimits';

export type EncryptedEnvelope = { seq: number; id: string; ciphertext: string; slot: string };
export type OpaqueUpload = Omit<EncryptedEnvelope, 'seq'> & { expectedId?: string | null };
export type OpaqueDelete = { id: string; slot: string };
export type SyncResult = {
	cursor: number;
	envelopes: EncryptedEnvelope[];
	conflicts: EncryptedEnvelope[];
	hasMore: boolean;
	reset: boolean;
	writesAccepted: boolean;
};
export type SyncQuotas = { maxAccountBytes: number };
export type AccountByteQuota = { maxBytes: number; overridden: boolean };
export type OperatorUsage = {
	accounts: number;
	envelopeCount: number;
	ciphertextBytes: number;
	storageBytes: number;
	activeByWindowDays: Record<string, number>;
	staleAccounts: number;
};
export type PushDeviceInput = {
	deviceId: string;
	endpoint: string;
	p256dh: string;
	auth: string;
	accountId: string;
};
export type ReminderWakeInput = { id: string; fireAt: number };
export type DueWake = PushDeviceInput & { wakeId: string; fireAt: number };

export type AccountSummary = {
	accountId: string;
	envelopeCount: number;
	ciphertextBytes: number;
	storageBytes: number;
	lastSeenAt: number;
	maxBytes: number;
	maxBytesOverridden: boolean;
	syncPerMinute: number;
	syncPerMinuteOverridden: boolean;
};

export type AccountPage = { total: number; accounts: AccountSummary[] };

export type FeatureFlag = { flag: string; defaultEnabled: boolean; description: string };

export const ENVELOPE_STORAGE_OVERHEAD_BYTES = 512;
export const MAX_PUSH_DEVICES = 32;
export const MAX_WAKES_PER_ACCOUNT = 1_000;
export const WAKE_RETAIN_MS = 86_400_000;
export const WAKE_CLAIM_LEASE_MS = 60_000;
export const DELETED_SLOT_GRACE_MS = 14 * 86_400_000;
/** How long an uncommitted upload may sit before the sweep treats it as abandoned.
 * Far longer than any request can live, so an in-flight upload is never reclaimed. */
export const PENDING_UPLOAD_GRACE_MS = 3_600_000;
/** Keeps D1 parameters and R2 subrequests safely inside Workers limits. */
export const MAX_SYNC_MUTATIONS_PER_REQUEST = MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST;

export class SyncQuotaExceededError extends Error {
	constructor() {
		super('Sync account storage quota exceeded');
		this.name = 'SyncQuotaExceededError';
	}
}

export class SyncStore {
	private readonly bindings = cloudflareBindings();
	private readonly maxAccountBytes = parseMaxAccountBytes(
		this.bindings.SCRAPSCACHE_SYNC_MAX_ACCOUNT_BYTES
	);
	private get db() {
		return this.bindings.SCRAPSCACHE_DB;
	}

	async getAuthCredential(accountId: string): Promise<string | null> {
		const row = (
			await execute(this.db, {
				sql: 'SELECT credential_hash AS credentialHash FROM accounts WHERE account_id = ?',
				args: [accountId]
			})
		).rows[0];
		return row ? String(row.credentialHash) : null;
	}
	async replaceAuthCredential(
		accountId: string,
		expected: string,
		replacement: string
	): Promise<boolean> {
		return (
			(
				await execute(this.db, {
					sql: 'UPDATE accounts SET credential_hash = ?, updated_at = ? WHERE account_id = ? AND credential_hash = ?',
					args: [replacement, Date.now(), accountId, expected]
				})
			).rowsAffected === 1
		);
	}
	async createAccount(
		accountId: string,
		authPublicKey: string,
		updatedAt = Date.now()
	): Promise<boolean> {
		return (
			(
				await execute(this.db, {
					sql: 'INSERT OR IGNORE INTO accounts(account_id, credential_hash, updated_at, last_seen_at) VALUES (?, ?, ?, ?)',
					args: [accountId, authPublicKey, updatedAt, updatedAt]
				})
			).rowsAffected === 1
		);
	}
	async getAccountByteQuota(accountId: string): Promise<AccountByteQuota | null> {
		const row = (
			await execute(this.db, {
				sql: 'SELECT q.max_bytes AS maxBytes FROM accounts a LEFT JOIN account_quotas q USING(account_id) WHERE a.account_id = ?',
				args: [accountId]
			})
		).rows[0];
		if (!row) return null;
		return {
			maxBytes: row.maxBytes == null ? this.maxAccountBytes : Number(row.maxBytes),
			overridden: row.maxBytes != null
		};
	}
	async setAccountByteQuota(accountId: string, maxBytes: number): Promise<boolean> {
		if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
			throw new RangeError('Account byte quota must be a positive safe integer');
		return (
			(
				await execute(this.db, {
					sql: 'INSERT INTO account_quotas(account_id,max_bytes) SELECT account_id,? FROM accounts WHERE account_id=? ON CONFLICT(account_id) DO UPDATE SET max_bytes=excluded.max_bytes',
					args: [maxBytes, accountId]
				})
			).rowsAffected === 1
		);
	}
	async clearAccountByteQuota(accountId: string): Promise<boolean> {
		if (!(await this.getAuthCredential(accountId))) return false;
		await execute(this.db, {
			sql: 'DELETE FROM account_quotas WHERE account_id=?',
			args: [accountId]
		});
		return true;
	}
	/** One page of accounts with their effective limits, largest first, so the
	 * operator view opens on whatever is consuming the most. */
	async listAccounts(
		options: { limit?: number; offset?: number; search?: string } = {}
	): Promise<AccountPage> {
		const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 200);
		const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
		const search = (options.search ?? '').trim();
		const where = search ? 'WHERE a.account_id LIKE ?' : '';
		const filter = search ? [`${search}%`] : [];
		const total = (
			await execute(this.db, {
				sql: `SELECT COUNT(*) AS total FROM accounts a ${where}`,
				args: filter
			})
		).rows[0] as { total: number };
		const rows = (
			await execute(this.db, {
				sql: `SELECT a.account_id AS accountId, a.envelope_count AS envelopeCount,
						a.ciphertext_bytes AS ciphertextBytes, a.last_seen_at AS lastSeenAt,
						q.max_bytes AS maxBytes, r.sync_per_minute AS syncPerMinute
					FROM accounts a
					LEFT JOIN account_quotas q ON q.account_id = a.account_id
					LEFT JOIN account_rate_limits r ON r.account_id = a.account_id
					${where}
					ORDER BY a.ciphertext_bytes DESC, a.account_id ASC
					LIMIT ? OFFSET ?`,
				args: [...filter, limit, offset]
			})
		).rows;
		return { total: Number(total.total), accounts: rows.map((row) => this.toSummary(row)) };
	}

	private toSummary(row: Record<string, unknown>): AccountSummary {
		const envelopeCount = Number(row.envelopeCount ?? 0);
		const ciphertextBytes = Number(row.ciphertextBytes ?? 0);
		return {
			accountId: String(row.accountId),
			envelopeCount,
			ciphertextBytes,
			storageBytes: ciphertextBytes + envelopeCount * ENVELOPE_STORAGE_OVERHEAD_BYTES,
			lastSeenAt: Number(row.lastSeenAt ?? 0),
			maxBytes: row.maxBytes == null ? this.maxAccountBytes : Number(row.maxBytes),
			maxBytesOverridden: row.maxBytes != null,
			syncPerMinute:
				row.syncPerMinute == null ? DEFAULT_SYNC_PER_MINUTE : Number(row.syncPerMinute),
			syncPerMinuteOverridden: row.syncPerMinute != null
		};
	}

	/** Null when this account runs on the shared default. */
	async accountRateLimit(accountId: string): Promise<number | null> {
		const row = (
			await execute(this.db, {
				sql: 'SELECT sync_per_minute AS syncPerMinute FROM account_rate_limits WHERE account_id = ?',
				args: [accountId]
			})
		).rows[0];
		return row ? Number(row.syncPerMinute) : null;
	}

	async setAccountRateLimit(accountId: string, syncPerMinute: number): Promise<boolean> {
		if (!Number.isSafeInteger(syncPerMinute) || syncPerMinute <= 0) {
			throw new RangeError('Sync rate limit must be a positive safe integer');
		}
		return (
			(
				await execute(this.db, {
					sql: `INSERT INTO account_rate_limits(account_id, sync_per_minute, updated_at)
						SELECT account_id, ?, ? FROM accounts WHERE account_id = ?
						ON CONFLICT(account_id) DO UPDATE SET
							sync_per_minute = excluded.sync_per_minute, updated_at = excluded.updated_at`,
					args: [syncPerMinute, Date.now(), accountId]
				})
			).rowsAffected === 1
		);
	}

	async clearAccountRateLimit(accountId: string): Promise<boolean> {
		if (!(await this.getAuthCredential(accountId))) return false;
		await execute(this.db, {
			sql: 'DELETE FROM account_rate_limits WHERE account_id = ?',
			args: [accountId]
		});
		return true;
	}

	async listFeatureFlags(): Promise<FeatureFlag[]> {
		const rows = (
			await execute(
				this.db,
				'SELECT flag, default_enabled AS defaultEnabled, description FROM feature_flags ORDER BY flag'
			)
		).rows;
		return rows.map((row) => ({
			flag: String(row.flag),
			defaultEnabled: Number(row.defaultEnabled) === 1,
			description: String(row.description ?? '')
		}));
	}

	async upsertFeatureFlag(flag: string, defaultEnabled: boolean, description = ''): Promise<void> {
		await execute(this.db, {
			sql: `INSERT INTO feature_flags(flag, default_enabled, description, updated_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(flag) DO UPDATE SET
					default_enabled = excluded.default_enabled,
					description = excluded.description,
					updated_at = excluded.updated_at`,
			args: [flag, defaultEnabled ? 1 : 0, description, Date.now()]
		});
	}

	/** Removing the gate removes every per-account opinion about it, which is how
	 * a finished rollout is cleaned up rather than left to accumulate. */
	async deleteFeatureFlag(flag: string): Promise<boolean> {
		const results = await batch(this.db, [
			{ sql: 'DELETE FROM account_feature_flags WHERE flag = ?', args: [flag] },
			{ sql: 'DELETE FROM feature_flags WHERE flag = ?', args: [flag] }
		]);
		return results[1]?.rowsAffected === 1;
	}

	/** Every known gate resolved for one account: its own opinion where it has
	 * one, the default otherwise. A gate nobody declared is absent, not false. */
	async accountFeatureFlags(accountId: string): Promise<Record<string, boolean>> {
		const rows = (
			await execute(this.db, {
				sql: `SELECT f.flag AS flag, COALESCE(a.enabled, f.default_enabled) AS enabled
					FROM feature_flags f
					LEFT JOIN account_feature_flags a ON a.flag = f.flag AND a.account_id = ?
					ORDER BY f.flag`,
				args: [accountId]
			})
		).rows;
		return Object.fromEntries(rows.map((row) => [String(row.flag), Number(row.enabled) === 1]));
	}

	async setAccountFeatureFlag(accountId: string, flag: string, enabled: boolean): Promise<boolean> {
		return (
			(
				await execute(this.db, {
					sql: `INSERT INTO account_feature_flags(account_id, flag, enabled, updated_at)
						SELECT account_id, ?, ?, ? FROM accounts WHERE account_id = ?
						ON CONFLICT(account_id, flag) DO UPDATE SET
							enabled = excluded.enabled, updated_at = excluded.updated_at`,
					args: [flag, enabled ? 1 : 0, Date.now(), accountId]
				})
			).rowsAffected === 1
		);
	}

	async clearAccountFeatureFlag(accountId: string, flag: string): Promise<boolean> {
		await execute(this.db, {
			sql: 'DELETE FROM account_feature_flags WHERE account_id = ? AND flag = ?',
			args: [accountId, flag]
		});
		return true;
	}

	async sync(
		accountId: string,
		cursor: number,
		uploads: OpaqueUpload[],
		deletions: OpaqueDelete[],
		downloadLimit = 12,
		senderClientId?: string
	): Promise<
		SyncResult & {
			usage: {
				envelopeCount: number;
				ciphertextBytes: number;
				storageBytes: number;
				maxBytes: number;
			};
		}
	> {
		const stub = this.bindings.ACCOUNT_COORDINATOR.get(
			this.bindings.ACCOUNT_COORDINATOR.idFromName(accountId)
		);
		const response = await stub.fetch('https://coordinator/sync', {
			method: 'POST',
			body: JSON.stringify({
				accountId,
				cursor,
				uploads,
				deletions,
				downloadLimit,
				maxAccountBytes: this.maxAccountBytes,
				senderClientId
			})
		});
		if (response.status === 507) throw new SyncQuotaExceededError();
		if (!response.ok) throw new Error(`Account coordinator failed (${response.status})`);
		return response.json();
	}
	async deleteAccount(accountId: string): Promise<boolean> {
		const namespace = this.bindings.ACCOUNT_COORDINATOR;
		const response = await namespace
			.get(namespace.idFromName(accountId))
			.fetch('https://coordinator/delete', {
				method: 'POST',
				body: JSON.stringify({ accountId })
			});
		if (!response.ok) throw new Error(`Account coordinator failed (${response.status})`);
		return Boolean(((await response.json()) as { deleted?: unknown }).deleted);
	}
	async touchAccount(accountId: string, now = Date.now()): Promise<void> {
		await execute(this.db, {
			sql: 'UPDATE accounts SET last_seen_at=? WHERE account_id=?',
			args: [now, accountId]
		});
	}
	getQuotas(): SyncQuotas {
		return { maxAccountBytes: this.maxAccountBytes };
	}
	async operatorUsage(
		options: { now?: number; staleBefore?: number | null } = {}
	): Promise<OperatorUsage> {
		const now = options.now ?? Date.now(),
			stale = options.staleBefore ?? null;
		const selects = ACTIVITY_WINDOWS_DAYS.map(
			(_, i) => `COALESCE(SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END),0) AS active_${i}`
		).join(',');
		const row = (
			await execute(this.db, {
				sql: `SELECT COUNT(*) accounts,COALESCE(SUM(envelope_count),0) envelopeCount,COALESCE(SUM(ciphertext_bytes),0) ciphertextBytes,${selects},COALESCE(SUM(CASE WHEN last_seen_at < ? THEN 1 ELSE 0 END),0) staleAccounts FROM accounts`,
				args: [...ACTIVITY_WINDOWS_DAYS.map((d) => now - d * 86_400_000), stale ?? 0]
			})
		).rows[0]!;
		const activeByWindowDays = Object.fromEntries(
			ACTIVITY_WINDOWS_DAYS.map((d, i) => [String(d), Number(row[`active_${i}`])])
		);
		const envelopeCount = Number(row.envelopeCount),
			ciphertextBytes = Number(row.ciphertextBytes);
		return {
			accounts: Number(row.accounts),
			envelopeCount,
			ciphertextBytes,
			storageBytes: ciphertextBytes + envelopeCount * ENVELOPE_STORAGE_OVERHEAD_BYTES,
			activeByWindowDays,
			staleAccounts: stale == null ? 0 : Number(row.staleAccounts)
		};
	}
	async deleteInactiveAccounts(staleBefore: number): Promise<number> {
		const rows = (
			await execute(this.db, {
				sql: 'SELECT account_id AS accountId FROM accounts WHERE last_seen_at < ?',
				args: [staleBefore]
			})
		).rows;
		for (const row of rows) await this.deleteAccount(String(row.accountId));
		return rows.length;
	}
	/**
	 * Reclaim R2 objects no live envelope points at: slots deleted long enough ago
	 * that every device has seen the deletion, and uploads that reserved an object
	 * but never committed because the request died between the R2 write and the
	 * batch that would have promoted them. Both are invisible to account quota, so
	 * nothing else would ever notice they were still being paid for.
	 */
	async purgeExpiredDeletedEnvelopes(
		now = Date.now(),
		graceMs = DELETED_SLOT_GRACE_MS
	): Promise<number> {
		const rows = (
			await execute(this.db, {
				sql: 'SELECT account_id AS accountId,slot,r2_key AS r2Key FROM deleted_envelopes WHERE deleted_at <= ?',
				args: [now - graceMs]
			})
		).rows;
		await batch(
			this.db,
			rows.map((r) => ({
				sql: 'DELETE FROM deleted_envelopes WHERE account_id=? AND slot=?',
				args: [String(r.accountId), String(r.slot)]
			}))
		);
		await Promise.all(rows.map((r) => this.bindings.SCRAPSCACHE_ENVELOPES.delete(String(r.r2Key))));
		return rows.length + (await this.purgeAbandonedUploads(now));
	}

	/** Drop uncommitted uploads and the objects they reserved. An id that reached
	 * `envelopes` is live: its row is only stale bookkeeping, so keep the object. */
	private async purgeAbandonedUploads(now: number): Promise<number> {
		const rows = (
			await execute(this.db, {
				sql: `SELECT p.account_id AS accountId,p.id AS id,p.r2_key AS r2Key
					FROM pending_envelopes p
					LEFT JOIN envelopes e ON e.account_id=p.account_id AND e.id=p.id
					WHERE p.created_at <= ? AND e.id IS NULL`,
				args: [now - PENDING_UPLOAD_GRACE_MS]
			})
		).rows;
		await batch(this.db, [
			{
				sql: `DELETE FROM pending_envelopes WHERE created_at <= ? AND EXISTS (
					SELECT 1 FROM envelopes e
					WHERE e.account_id=pending_envelopes.account_id AND e.id=pending_envelopes.id
				)`,
				args: [now - PENDING_UPLOAD_GRACE_MS]
			},
			...rows.map((r) => ({
				sql: 'DELETE FROM pending_envelopes WHERE account_id=? AND id=?',
				args: [String(r.accountId), String(r.id)]
			}))
		]);
		await Promise.all(rows.map((r) => this.bindings.SCRAPSCACHE_ENVELOPES.delete(String(r.r2Key))));
		return rows.length;
	}
	async savePushDevice(d: PushDeviceInput): Promise<void> {
		await batch(this.db, [
			{
				sql: 'DELETE FROM reminder_push_devices WHERE endpoint=? AND (account_id!=? OR device_id!=?)',
				args: [d.endpoint, d.accountId, d.deviceId]
			},
			{
				sql: 'DELETE FROM reminder_push_devices WHERE device_id=? AND account_id!=?',
				args: [d.deviceId, d.accountId]
			},
			{
				sql: 'INSERT INTO reminder_push_devices(account_id,device_id,endpoint,p256dh,auth,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,device_id) DO UPDATE SET endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth,updated_at=excluded.updated_at',
				args: [d.accountId, d.deviceId, d.endpoint, d.p256dh, d.auth, Date.now()]
			},
			{
				sql: 'DELETE FROM reminder_push_devices WHERE account_id=? AND device_id IN (SELECT device_id FROM reminder_push_devices WHERE account_id=? ORDER BY updated_at DESC LIMIT -1 OFFSET ?)',
				args: [d.accountId, d.accountId, MAX_PUSH_DEVICES]
			}
		]);
		await this.touchAccount(d.accountId);
	}
	async replaceReminderWakes(
		accountId: string,
		wakes: ReminderWakeInput[],
		revision?: number
	): Promise<boolean> {
		if (!(await this.getAuthCredential(accountId))) return false;
		if (revision !== undefined) {
			const current = (
				await execute(this.db, {
					sql: 'SELECT revision FROM reminder_wake_revisions WHERE account_id=?',
					args: [accountId]
				})
			).rows[0];
			if (current && revision < Number(current.revision)) return false;
			if (current && revision === Number(current.revision)) return true;
		}
		const statements: SqlStatement[] = [
			{ sql: 'DELETE FROM reminder_wakes WHERE account_id=?', args: [accountId] },
			...wakes.slice(0, MAX_WAKES_PER_ACCOUNT).map((w) => ({
				sql: 'INSERT INTO reminder_wakes(account_id,wake_id,fire_at) VALUES(?,?,?)',
				args: [accountId, w.id, w.fireAt]
			}))
		];
		if (revision !== undefined)
			statements.push({
				sql: 'INSERT INTO reminder_wake_revisions(account_id,revision) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET revision=excluded.revision',
				args: [accountId, revision]
			});
		await batch(this.db, statements);
		await this.touchAccount(accountId);
		return true;
	}
	async claimDueWakes(now: number, limit = 100): Promise<DueWake[]> {
		const rows = (
			await execute(this.db, {
				sql: 'SELECT d.account_id accountId,d.device_id deviceId,w.wake_id wakeId,w.fire_at fireAt,d.endpoint,d.p256dh,d.auth FROM reminder_wakes w JOIN reminder_push_devices d ON d.account_id=w.account_id LEFT JOIN reminder_wake_deliveries x ON x.account_id=d.account_id AND x.device_id=d.device_id AND x.wake_id=w.wake_id WHERE w.fire_at<=? AND x.delivered_at IS NULL AND (x.claimed_at IS NULL OR x.claimed_at<=?) ORDER BY w.fire_at,w.wake_id,d.device_id LIMIT ?',
				args: [now, now - WAKE_CLAIM_LEASE_MS, limit]
			})
		).rows as unknown as DueWake[];
		await batch(
			this.db,
			rows.map((r) => ({
				sql: 'INSERT INTO reminder_wake_deliveries(account_id,device_id,wake_id,claimed_at,delivered_at) VALUES(?,?,?,?,NULL) ON CONFLICT(account_id,device_id,wake_id) DO UPDATE SET claimed_at=excluded.claimed_at,delivered_at=NULL',
				args: [r.accountId, r.deviceId, r.wakeId, now]
			}))
		);
		return rows;
	}
	async markWakeDelivered(
		w: Pick<DueWake, 'accountId' | 'deviceId' | 'wakeId'>,
		now: number
	): Promise<void> {
		await execute(this.db, {
			sql: 'UPDATE reminder_wake_deliveries SET delivered_at=? WHERE account_id=? AND device_id=? AND wake_id=?',
			args: [now, w.accountId, w.deviceId, w.wakeId]
		});
	}
	async releaseWakeClaim(w: Pick<DueWake, 'accountId' | 'deviceId' | 'wakeId'>): Promise<void> {
		await execute(this.db, {
			sql: 'DELETE FROM reminder_wake_deliveries WHERE account_id=? AND device_id=? AND wake_id=? AND delivered_at IS NULL',
			args: [w.accountId, w.deviceId, w.wakeId]
		});
	}
	async pruneStaleWakes(now: number, retainMs = WAKE_RETAIN_MS): Promise<void> {
		await batch(this.db, [
			{ sql: 'DELETE FROM reminder_wakes WHERE fire_at < ?', args: [now - retainMs] },
			{
				sql: 'DELETE FROM reminder_wake_deliveries WHERE COALESCE(delivered_at,claimed_at) < ?',
				args: [now - retainMs]
			}
		]);
	}
	async deletePushDevice(accountId: string, deviceId: string): Promise<void> {
		await execute(this.db, {
			sql: 'DELETE FROM reminder_push_devices WHERE account_id=? AND device_id=?',
			args: [accountId, deviceId]
		});
		await this.touchAccount(accountId);
	}
	async countPushDevices(accountId?: string): Promise<number> {
		const r = await execute(
			this.db,
			accountId
				? {
						sql: 'SELECT COUNT(*) count FROM reminder_push_devices WHERE account_id=?',
						args: [accountId]
					}
				: 'SELECT COUNT(*) count FROM reminder_push_devices'
		);
		return Number(r.rows[0]?.count ?? 0);
	}
	async createEventStream(
		accountId: string,
		signal?: AbortSignal,
		clientId?: string
	): Promise<Response> {
		const stub = this.bindings.ACCOUNT_COORDINATOR.get(
			this.bindings.ACCOUNT_COORDINATOR.idFromName(accountId)
		);
		const url = new URL('https://coordinator/events');
		if (clientId) url.searchParams.set('clientId', clientId);
		const res = await stub.fetch(url.toString(), {
			signal: (signal ?? null) as any
		});
		// A response that came back from fetch() has immutable headers, and the
		// server hook sets security headers on everything it returns. Hand back a
		// response this app owns rather than the coordinator's own object.
		return new Response(res.body as unknown as BodyInit | null, {
			status: res.status,
			statusText: res.statusText,
			headers: new Headers(res.headers as unknown as HeadersInit)
		});
	}

	async isReady(): Promise<boolean> {
		try {
			await execute(this.db, 'SELECT 1');
			return true;
		} catch (error) {
			console.error(
				JSON.stringify({
					level: 'error',
					event: 'cloudflare_storage_not_ready',
					message: error instanceof Error ? error.message : 'D1 readiness check failed'
				})
			);
			return false;
		}
	}
}

let singleton: SyncStore | undefined;
export function getSyncStore(): SyncStore {
	return (singleton ??= new SyncStore());
}
