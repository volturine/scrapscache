<script lang="ts">
	import { onMount } from 'svelte';
	import { adminPageStyles as styles } from '$panda/styles';
	import { css, cx } from 'styled-system/css';
	import { button, input } from 'styled-system/recipes';
	import {
		adminClient,
		AdminUnauthorized,
		formatAgo,
		formatBytes,
		type AccountDetail,
		type AccountSummary,
		type OperatorSnapshot,
		type RuntimeSettingsState,
		type TelemetryReport
	} from '$lib/admin/adminClient.svelte';

	const PAGE_SIZE = 25;
	const primaryButton = button({ variant: 'primary', size: 'sm' });
	const secondaryButton = button({ variant: 'secondary', size: 'sm' });
	const compactInput = input({ variant: 'outline', size: 'sm' });
	const wideInput = cx(input({ variant: 'outline', size: 'md' }), css({ w: 'full' }));

	let tokenInput = $state('');
	let error = $state('');
	let loading = $state(false);

	let snapshot = $state<OperatorSnapshot | null>(null);
	let telemetry = $state<TelemetryReport | null>(null);
	let settings = $state<RuntimeSettingsState | null>(null);
	const hours = 24;

	let accounts = $state<AccountSummary[]>([]);
	let accountTotal = $state(0);
	let offset = $state(0);
	let search = $state('');
	let selected = $state<AccountDetail | null>(null);

	async function guard(run: () => Promise<void>) {
		loading = true;
		error = '';
		try {
			await run();
		} catch (err) {
			if (err instanceof AdminUnauthorized) {
				adminClient.forget();
				error = err.message;
			} else {
				error = err instanceof Error ? err.message : 'Something went wrong';
			}
		} finally {
			loading = false;
		}
	}

	async function loadAll() {
		await guard(async () => {
			[snapshot, telemetry, settings] = await Promise.all([
				adminClient.status(),
				adminClient.telemetry(hours),
				adminClient.settings()
			]);
			const page = await adminClient.accounts(search, offset, PAGE_SIZE);
			accounts = page.accounts;
			accountTotal = page.total;
		});
	}

	function signIn(event: SubmitEvent) {
		event.preventDefault();
		if (!tokenInput.trim()) return;
		adminClient.remember(tokenInput);
		tokenInput = '';
		void loadAll();
	}

	async function reloadAccounts() {
		await guard(async () => {
			const page = await adminClient.accounts(search, offset, PAGE_SIZE);
			accounts = page.accounts;
			accountTotal = page.total;
		});
	}

	async function open(accountId: string) {
		await guard(async () => {
			selected = await adminClient.account(accountId);
		});
	}

	/** Empty means "back to the shared default", which the API reads as null. */
	function limitFrom(value: string): number | null | undefined {
		const trimmed = value.trim();
		if (!trimmed) return null;
		const parsed = Number(trimmed);
		return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
	}

	async function saveLimits(form: HTMLFormElement) {
		if (!selected) return;
		const data = new FormData(form);
		const maxBytes = limitFrom(String(data.get('maxBytes') ?? ''));
		const syncPerMinute = limitFrom(String(data.get('syncPerMinute') ?? ''));
		if (maxBytes === undefined || syncPerMinute === undefined) {
			error = 'Limits must be whole numbers above zero, or blank for the default';
			return;
		}
		await guard(async () => {
			selected = await adminClient.updateAccount({
				accountId: selected!.accountId,
				maxBytes,
				syncPerMinute
			});
			await reloadAccounts();
		});
	}

	function nonNegativeFrom(value: string): number | null | undefined {
		const trimmed = value.trim();
		if (!trimmed) return null;
		const parsed = Number(trimmed);
		return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
	}

	async function saveRuntimeSettings(form: HTMLFormElement) {
		const data = new FormData(form);
		const maxAccountBytes = limitFrom(String(data.get('maxAccountBytes') ?? ''));
		const syncPerMinute = limitFrom(String(data.get('syncPerMinute') ?? ''));
		const maxConcurrentSyncRequests = limitFrom(
			String(data.get('maxConcurrentSyncRequests') ?? '')
		);
		const retentionInactiveDays = nonNegativeFrom(String(data.get('retentionInactiveDays') ?? ''));
		if (
			maxAccountBytes === undefined ||
			syncPerMinute === undefined ||
			maxConcurrentSyncRequests === undefined ||
			retentionInactiveDays === undefined
		) {
			error = 'Numeric settings must be whole numbers; only retention may be zero';
			return;
		}
		const indexing = String(data.get('allowIndexing') ?? '');
		const vapidSubject = String(data.get('vapidSubject') ?? '').trim() || null;
		await guard(async () => {
			settings = await adminClient.updateSettings({
				maxAccountBytes,
				syncPerMinute,
				maxConcurrentSyncRequests,
				retentionInactiveDays,
				allowIndexing: indexing === '' ? null : indexing === 'true',
				vapidSubject
			});
			const [nextSnapshot, page] = await Promise.all([
				adminClient.status(),
				adminClient.accounts(search, offset, PAGE_SIZE)
			]);
			snapshot = nextSnapshot;
			accounts = page.accounts;
			accountTotal = page.total;
		});
	}

	const storageShare = $derived(
		snapshot ? Math.min(100, (snapshot.storage.storageBytes / 10_000_000_000) * 100) : 0
	);

	onMount(() => {
		if (adminClient.signedIn) void loadAll();
	});
</script>

<svelte:head><title>Scraps Cache operations</title></svelte:head>

<div class={styles.root}>
	<div class={styles.content}>
		<header class={styles.header}>
			<h1 class={styles.title}>Operations</h1>
			{#if adminClient.signedIn}
				<div class={styles.headerActions}>
					{#if loading}<span class={styles.loading}>Loading…</span>{/if}
					<button class={secondaryButton} onclick={() => void loadAll()}>Refresh</button>
					<button
						class={secondaryButton}
						onclick={() => {
							adminClient.forget();
							snapshot = null;
							settings = null;
						}}>Sign out</button
					>
				</div>
			{/if}
		</header>

		{#if error}
			<p class={styles.error} role="alert">{error}</p>
		{/if}

		{#if !adminClient.signedIn}
			<form class={styles.signIn} onsubmit={signIn}>
				<label class={styles.field}>
					<span class={styles.fieldLabel}>Admin token</span>
					<input bind:value={tokenInput} type="password" autocomplete="off" class={wideInput} />
				</label>
				<button class={primaryButton} type="submit">Sign in</button>
			</form>
		{:else if snapshot}
			<section class={styles.statGrid}>
				<div class={styles.statCard}>
					<div class={styles.statLabel}>Stored</div>
					<div class={styles.statValue}>{formatBytes(snapshot.storage.storageBytes)}</div>
					<div class={styles.statCaption}>
						{storageShare.toFixed(1)}% of the 10 GB database ceiling
					</div>
				</div>
				<div class={styles.statCard}>
					<div class={styles.statLabel}>Accounts</div>
					<div class={styles.statValue}>{snapshot.accounts.total}</div>
					<div class={styles.statCaption}>
						{snapshot.accounts.active['1'] ?? 0} active today
					</div>
				</div>
				<div class={styles.statCard}>
					<div class={styles.statLabel}>Envelopes</div>
					<div class={styles.statValue}>{snapshot.storage.envelopes}</div>
					<div class={styles.statCaption}>
						retention {snapshot.retention.enabled ? `${snapshot.retention.inactiveDays}d` : 'off'},
						swept {formatAgo(snapshot.retention.lastRunAt)}
					</div>
				</div>
				<div class={styles.statCard}>
					<div class={styles.statLabel}>
						Activity, last {hours}h
					</div>
					{#if telemetry?.available && telemetry.activity}
						<div class={styles.statValue}>{telemetry.activity.syncRequests ?? 0} syncs</div>
						<div class={styles.statCaption}>
							{telemetry.activity.syncUploadEnvelopes ?? 0} uploads · {telemetry.throttledNow ??
								'?'} callers throttled now
						</div>
					{:else}
						<div class={styles.statLabel}>Not available</div>
						<div class={styles.statCaption}>
							{telemetry?.note ?? ''}
						</div>
					{/if}
				</div>
			</section>

			{#if settings}
				<section class={styles.section}>
					<div>
						<h2 class={styles.sectionTitle}>Runtime settings</h2>
						<p class={styles.sectionDescription}>
							Blank fields use the deployment default. Changes apply without a redeploy.
						</p>
					</div>
					<form
						class={styles.settingsForm}
						onsubmit={(event) => {
							event.preventDefault();
							void saveRuntimeSettings(event.currentTarget);
						}}
					>
						<label class={styles.field}>
							<span class={styles.fieldLabel}>Default storage bytes</span>
							<input
								name="maxAccountBytes"
								type="number"
								min="1"
								step="1"
								class={cx(compactInput, styles.fieldInput)}
								placeholder={`Default: ${settings.defaults.maxAccountBytes}`}
								value={settings.overrides.maxAccountBytes ?? ''}
							/>
						</label>
						<label class={styles.field}>
							<span class={styles.fieldLabel}>Default syncs per minute</span>
							<input
								name="syncPerMinute"
								type="number"
								min="1"
								step="1"
								class={cx(compactInput, styles.fieldInput)}
								placeholder={`Default: ${settings.defaults.syncPerMinute}`}
								value={settings.overrides.syncPerMinute ?? ''}
							/>
						</label>
						<label class={styles.field}>
							<span class={styles.fieldLabel}>Concurrent sync requests</span>
							<input
								name="maxConcurrentSyncRequests"
								type="number"
								min="1"
								step="1"
								class={cx(compactInput, styles.fieldInput)}
								placeholder={`Default: ${settings.defaults.maxConcurrentSyncRequests}`}
								value={settings.overrides.maxConcurrentSyncRequests ?? ''}
							/>
						</label>
						<label class={styles.field}>
							<span class={styles.fieldLabel}>Inactive retention days</span>
							<input
								name="retentionInactiveDays"
								type="number"
								min="0"
								step="1"
								class={cx(compactInput, styles.fieldInput)}
								placeholder={`Default: ${settings.defaults.retentionInactiveDays}`}
								value={settings.overrides.retentionInactiveDays ?? ''}
							/>
							<span class={styles.statCaption}>0 disables it.</span>
						</label>
						<label class={styles.field}>
							<span class={styles.fieldLabel}>Search indexing</span>
							<select
								name="allowIndexing"
								class={cx(compactInput, styles.fieldInput)}
								value={settings.overrides.allowIndexing === undefined
									? ''
									: String(settings.overrides.allowIndexing)}
							>
								<option value=""
									>Default: {settings.defaults.allowIndexing ? 'allowed' : 'blocked'}</option
								>
								<option value="true">Allowed</option>
								<option value="false">Blocked</option>
							</select>
						</label>
						<label class={styles.field}>
							<span class={styles.fieldLabel}>VAPID subject</span>
							<input
								name="vapidSubject"
								class={cx(compactInput, styles.fieldInput)}
								placeholder={`Default: ${settings.defaults.vapidSubject}`}
								value={settings.overrides.vapidSubject ?? ''}
							/>
						</label>
						<div class={styles.settingsSubmit}>
							<button class={primaryButton} type="submit">Save settings</button>
						</div>
					</form>
				</section>
			{/if}

			<section class={styles.accounts}>
				<div class={styles.accountControls}>
					<h2 class={styles.sectionTitle}>Accounts</h2>
					<input
						bind:value={search}
						placeholder="Account id starts with…"
						class={compactInput}
						oninput={() => {
							offset = 0;
							void reloadAccounts();
						}}
					/>
					<span class={styles.loading}>{accountTotal} total</span>
				</div>

				<div class={styles.tableWrap}>
					<table class={styles.table}>
						<thead class={styles.tableHead}>
							<tr>
								<th class={styles.tableHeading}>Account</th>
								<th class={styles.tableHeading}>Stored</th>
								<th class={styles.tableHeading}>Quota</th>
								<th class={styles.tableHeading}>Syncs/min</th>
								<th class={styles.tableHeading}>Last seen</th>
							</tr>
						</thead>
						<tbody>
							{#each accounts as account (account.accountId)}
								<tr class={styles.tableRow} onclick={() => void open(account.accountId)}>
									<td class={cx(styles.tableCell, styles.accountId)}>{account.accountId}</td>
									<td class={styles.tableCell}>{formatBytes(account.storageBytes)}</td>
									<td class={styles.tableCell}>
										{formatBytes(account.maxBytes)}{account.maxBytesOverridden ? ' *' : ''}
									</td>
									<td class={styles.tableCell}>
										{account.syncPerMinute}{account.syncPerMinuteOverridden ? ' *' : ''}
									</td>
									<td class={styles.tableCell}>{formatAgo(account.lastSeenAt)}</td>
								</tr>
							{:else}
								<tr><td class={styles.emptyCell} colspan="5">No accounts match.</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
				<div class={styles.pagination}>
					<button
						class={secondaryButton}
						disabled={offset === 0}
						onclick={() => {
							offset = Math.max(0, offset - PAGE_SIZE);
							void reloadAccounts();
						}}>Previous</button
					>
					<button
						class={secondaryButton}
						disabled={offset + PAGE_SIZE >= accountTotal}
						onclick={() => {
							offset += PAGE_SIZE;
							void reloadAccounts();
						}}>Next</button
					>
					<span class={styles.loading}>* overridden</span>
				</div>
			</section>

			{#if selected}
				<section class={styles.selected}>
					<div class={styles.selectedHeader}>
						<h2 class={styles.selectedId}>{selected.accountId}</h2>
						<button class={secondaryButton} onclick={() => (selected = null)}>Close</button>
					</div>
					<p class={styles.sectionDescription}>
						{formatBytes(selected.storageBytes)} across {selected.envelopeCount} records, last seen {formatAgo(
							selected.lastSeenAt
						)}.
					</p>

					<form
						class={styles.selectedForm}
						onsubmit={(event) => {
							event.preventDefault();
							void saveLimits(event.currentTarget);
						}}
					>
						<label class={styles.field}>
							<span class={styles.fieldLabel}>Storage bytes</span>
							<input
								name="maxBytes"
								class={compactInput}
								placeholder="default"
								value={selected.maxBytesOverridden ? String(selected.maxBytes) : ''}
							/>
						</label>
						<label class={styles.field}>
							<span class={styles.fieldLabel}>Syncs per minute</span>
							<input
								name="syncPerMinute"
								class={compactInput}
								placeholder="default"
								value={selected.syncPerMinuteOverridden ? String(selected.syncPerMinute) : ''}
							/>
						</label>
						<button class={primaryButton} type="submit">Save limits</button>
						<span class={styles.selectedHint}>Blank restores the shared default.</span>
					</form>
				</section>
			{/if}
		{/if}
	</div>
</div>
