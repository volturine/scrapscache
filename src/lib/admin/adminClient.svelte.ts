/**
 * The dashboard's view of the admin API.
 *
 * The token lives in sessionStorage rather than localStorage so it dies with the
 * tab, and is never put in a URL. It is still readable by anything running on
 * this origin, which is why the deployment should keep Cloudflare Access in
 * front of /admin as well.
 */

const TOKEN_KEY = 'scrapscache-admin-token';

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

export type AccountDetail = AccountSummary & { flags: Record<string, boolean> };
export type FeatureFlag = { flag: string; defaultEnabled: boolean; description: string };

export type OperatorSnapshot = {
	generatedAt: number;
	storage: { ciphertextBytes: number; storageBytes: number; gigabytes: number; envelopes: number };
	accounts: { total: number; active: Record<string, number>; staleForRetention: number | null };
	activity: Record<string, number> | null;
	telemetry: { source: 'process' | 'dataset' };
	retention: {
		enabled: boolean;
		inactiveDays: number;
		lastRunAt: number;
		deletedAccountsTotal: number;
		failures: number;
		lastError: string | null;
	};
	quotas: { maxAccountBytes: number };
};

export type TelemetryReport = {
	available: boolean;
	source: 'process' | 'dataset';
	windowHours: number | null;
	activity: Record<string, number> | null;
	http: Array<{ route: string; status: string; count: number; durationMs: number }>;
	note?: string;
};

export class AdminUnauthorized extends Error {}

export class AdminClient {
	token = $state(
		typeof sessionStorage === 'undefined' ? '' : (sessionStorage.getItem(TOKEN_KEY) ?? '')
	);

	get signedIn(): boolean {
		return this.token.length > 0;
	}

	remember(token: string): void {
		this.token = token.trim();
		if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(TOKEN_KEY, this.token);
	}

	forget(): void {
		this.token = '';
		if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(TOKEN_KEY);
	}

	private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(path, {
			...init,
			headers: {
				...(init.headers ?? {}),
				authorization: `Bearer ${this.token}`,
				...(init.body ? { 'content-type': 'application/json' } : {})
			}
		});
		if (!response.ok) {
			const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
			// The admin guard answers a wrong token with a bare 404 and no JSON, so
			// the API gives no oracle for whether it exists. A 404 the app itself
			// produced — an unknown account, a gate already removed — carries an
			// error message, and must not sign the operator out.
			if (response.status === 404 && typeof body?.error !== 'string') {
				throw new AdminUnauthorized('Not authorised, or the admin API is disabled on this server');
			}
			throw new Error(
				typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`
			);
		}
		return (await response.json()) as T;
	}

	status(): Promise<OperatorSnapshot> {
		return this.call<OperatorSnapshot>('/api/admin/status');
	}

	telemetry(hours: number): Promise<TelemetryReport> {
		return this.call<TelemetryReport>(`/api/admin/telemetry?hours=${hours}`);
	}

	accounts(
		search: string,
		offset = 0,
		limit = 25
	): Promise<{ total: number; accounts: AccountSummary[] }> {
		const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
		if (search) query.set('search', search);
		return this.call(`/api/admin/accounts?${query}`);
	}

	account(accountId: string): Promise<AccountDetail> {
		return this.call(`/api/admin/accounts?accountId=${encodeURIComponent(accountId)}`);
	}

	updateAccount(patch: {
		accountId: string;
		maxBytes?: number | null;
		syncPerMinute?: number | null;
		flags?: Record<string, boolean | null>;
	}): Promise<AccountDetail> {
		return this.call('/api/admin/accounts', { method: 'PATCH', body: JSON.stringify(patch) });
	}

	flags(): Promise<{ flags: FeatureFlag[] }> {
		return this.call('/api/admin/flags');
	}

	saveFlag(flag: FeatureFlag): Promise<{ flags: FeatureFlag[] }> {
		return this.call('/api/admin/flags', { method: 'PUT', body: JSON.stringify(flag) });
	}

	deleteFlag(flag: string): Promise<{ flags: FeatureFlag[] }> {
		return this.call('/api/admin/flags', { method: 'DELETE', body: JSON.stringify({ flag }) });
	}
}

export const adminClient = new AdminClient();

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1_000_000) return `${(bytes / 1024).toFixed(0)} KB`;
	if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
	return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export function formatAgo(timestamp: number, now = Date.now()): string {
	if (!timestamp) return 'never';
	const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
	if (seconds < 90) return `${seconds}s ago`;
	if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
	if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`;
	return `${Math.round(seconds / 86400)}d ago`;
}
