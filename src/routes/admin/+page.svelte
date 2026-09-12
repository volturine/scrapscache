<script lang="ts">
	import '../../app.css';
	import { onMount } from 'svelte';
	import {
		adminClient,
		AdminUnauthorized,
		formatAgo,
		formatBytes,
		type AccountDetail,
		type AccountSummary,
		type FeatureFlag,
		type OperatorSnapshot,
		type TelemetryReport
	} from '$lib/admin/adminClient.svelte';

	const PAGE_SIZE = 25;

	let tokenInput = $state('');
	let error = $state('');
	let loading = $state(false);

	let snapshot = $state<OperatorSnapshot | null>(null);
	let telemetry = $state<TelemetryReport | null>(null);
	const hours = 24;

	let accounts = $state<AccountSummary[]>([]);
	let accountTotal = $state(0);
	let offset = $state(0);
	let search = $state('');
	let selected = $state<AccountDetail | null>(null);

	let flags = $state<FeatureFlag[]>([]);
	let newFlag = $state({ flag: '', defaultEnabled: false, description: '' });

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
			[snapshot, telemetry] = await Promise.all([
				adminClient.status(),
				adminClient.telemetry(hours)
			]);
			const page = await adminClient.accounts(search, offset, PAGE_SIZE);
			accounts = page.accounts;
			accountTotal = page.total;
			flags = (await adminClient.flags()).flags;
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

	async function setFlag(flag: string, value: boolean | null) {
		if (!selected) return;
		await guard(async () => {
			selected = await adminClient.updateAccount({
				accountId: selected!.accountId,
				flags: { [flag]: value }
			});
		});
	}

	async function saveFlag(event: SubmitEvent) {
		event.preventDefault();
		await guard(async () => {
			flags = (await adminClient.saveFlag({ ...newFlag })).flags;
			newFlag = { flag: '', defaultEnabled: false, description: '' };
		});
	}

	async function removeFlag(flag: string) {
		await guard(async () => {
			flags = (await adminClient.deleteFlag(flag)).flags;
			if (selected) selected = await adminClient.account(selected.accountId);
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

<div class="min-h-dvh bg-[var(--scrapscache-bg)] p-4 text-[var(--scrapscache-text)] sm:p-8">
	<div class="mx-auto max-w-5xl space-y-6">
		<header class="flex items-baseline justify-between gap-4">
			<h1 class="text-xl font-semibold">Operations</h1>
			{#if adminClient.signedIn}
				<div class="flex items-center gap-3 text-sm">
					{#if loading}<span class="text-[var(--scrapscache-text-muted)]">Loading…</span>{/if}
					<button class="scrapscache-button px-3 py-1.5" onclick={() => void loadAll()}
						>Refresh</button
					>
					<button
						class="scrapscache-button scrapscache-button-secondary px-3 py-1.5"
						onclick={() => {
							adminClient.forget();
							snapshot = null;
						}}>Sign out</button
					>
				</div>
			{/if}
		</header>

		{#if error}
			<p class="text-sm text-[var(--scrapscache-danger)]" role="alert">{error}</p>
		{/if}

		{#if !adminClient.signedIn}
			<form class="max-w-sm space-y-3" onsubmit={signIn}>
				<label class="block space-y-2 text-sm">
					<span class="text-[var(--scrapscache-text-muted)]">Admin token</span>
					<input
						bind:value={tokenInput}
						type="password"
						autocomplete="off"
						class="scrapscache-input w-full px-3 py-2"
					/>
				</label>
				<button class="scrapscache-button scrapscache-button-primary px-3 py-2" type="submit"
					>Sign in</button
				>
			</form>
		{:else if snapshot}
			<section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<div class="rounded-lg border border-[var(--scrapscache-border)] p-3">
					<div class="text-sm text-[var(--scrapscache-text-muted)]">Stored</div>
					<div class="text-lg font-semibold">{formatBytes(snapshot.storage.storageBytes)}</div>
					<div class="text-xs text-[var(--scrapscache-text-muted)]">
						{storageShare.toFixed(1)}% of the 10 GB database ceiling
					</div>
				</div>
				<div class="rounded-lg border border-[var(--scrapscache-border)] p-3">
					<div class="text-sm text-[var(--scrapscache-text-muted)]">Accounts</div>
					<div class="text-lg font-semibold">{snapshot.accounts.total}</div>
					<div class="text-xs text-[var(--scrapscache-text-muted)]">
						{snapshot.accounts.active['1'] ?? 0} active today
					</div>
				</div>
				<div class="rounded-lg border border-[var(--scrapscache-border)] p-3">
					<div class="text-sm text-[var(--scrapscache-text-muted)]">Envelopes</div>
					<div class="text-lg font-semibold">{snapshot.storage.envelopes}</div>
					<div class="text-xs text-[var(--scrapscache-text-muted)]">
						retention {snapshot.retention.enabled ? `${snapshot.retention.inactiveDays}d` : 'off'},
						swept {formatAgo(snapshot.retention.lastRunAt)}
					</div>
				</div>
				<div class="rounded-lg border border-[var(--scrapscache-border)] p-3">
					<div class="text-sm text-[var(--scrapscache-text-muted)]">
						Activity, last {hours}h
					</div>
					{#if telemetry?.available && telemetry.activity}
						<div class="text-lg font-semibold">{telemetry.activity.syncRequests ?? 0} syncs</div>
						<div class="text-xs text-[var(--scrapscache-text-muted)]">
							{telemetry.activity.rateLimited ?? 0} rate limited
						</div>
					{:else}
						<div class="text-sm">Not available</div>
						<div class="text-xs text-[var(--scrapscache-text-muted)]">
							{telemetry?.note ?? ''}
						</div>
					{/if}
				</div>
			</section>

			<section class="space-y-3">
				<div class="flex flex-wrap items-center gap-2">
					<h2 class="text-lg font-semibold">Accounts</h2>
					<input
						bind:value={search}
						placeholder="Account id starts with…"
						class="scrapscache-input px-3 py-1.5 text-sm"
						oninput={() => {
							offset = 0;
							void reloadAccounts();
						}}
					/>
					<span class="text-sm text-[var(--scrapscache-text-muted)]">{accountTotal} total</span>
				</div>

				<div class="overflow-x-auto rounded-lg border border-[var(--scrapscache-border)]">
					<table class="w-full text-left text-sm">
						<thead class="text-[var(--scrapscache-text-muted)]">
							<tr>
								<th class="p-2 font-medium">Account</th>
								<th class="p-2 font-medium">Stored</th>
								<th class="p-2 font-medium">Quota</th>
								<th class="p-2 font-medium">Syncs/min</th>
								<th class="p-2 font-medium">Last seen</th>
							</tr>
						</thead>
						<tbody>
							{#each accounts as account (account.accountId)}
								<tr
									class="cursor-pointer border-t border-[var(--scrapscache-border)] hover:bg-[var(--scrapscache-interactive-hover)]"
									onclick={() => void open(account.accountId)}
								>
									<td class="p-2 font-mono text-xs">{account.accountId}</td>
									<td class="p-2">{formatBytes(account.storageBytes)}</td>
									<td class="p-2"
										>{formatBytes(account.maxBytes)}{account.maxBytesOverridden ? ' *' : ''}</td
									>
									<td class="p-2"
										>{account.syncPerMinute}{account.syncPerMinuteOverridden ? ' *' : ''}</td
									>
									<td class="p-2">{formatAgo(account.lastSeenAt)}</td>
								</tr>
							{:else}
								<tr
									><td class="p-3 text-[var(--scrapscache-text-muted)]" colspan="5"
										>No accounts match.</td
									></tr
								>
							{/each}
						</tbody>
					</table>
				</div>
				<div class="flex items-center gap-2 text-sm">
					<button
						class="scrapscache-button scrapscache-button-secondary px-3 py-1.5"
						disabled={offset === 0}
						onclick={() => {
							offset = Math.max(0, offset - PAGE_SIZE);
							void reloadAccounts();
						}}>Previous</button
					>
					<button
						class="scrapscache-button scrapscache-button-secondary px-3 py-1.5"
						disabled={offset + PAGE_SIZE >= accountTotal}
						onclick={() => {
							offset += PAGE_SIZE;
							void reloadAccounts();
						}}>Next</button
					>
					<span class="text-[var(--scrapscache-text-muted)]">* overridden</span>
				</div>
			</section>

			{#if selected}
				<section class="space-y-3 rounded-lg border border-[var(--scrapscache-border)] p-4">
					<div class="flex items-baseline justify-between gap-3">
						<h2 class="font-mono text-sm break-all">{selected.accountId}</h2>
						<button
							class="scrapscache-button scrapscache-button-secondary px-3 py-1.5 text-sm"
							onclick={() => (selected = null)}>Close</button
						>
					</div>
					<p class="text-sm text-[var(--scrapscache-text-muted)]">
						{formatBytes(selected.storageBytes)} across {selected.envelopeCount} records, last seen {formatAgo(
							selected.lastSeenAt
						)}.
					</p>

					<form
						class="flex flex-wrap items-end gap-3"
						onsubmit={(event) => {
							event.preventDefault();
							void saveLimits(event.currentTarget);
						}}
					>
						<label class="space-y-1 text-sm">
							<span class="block text-[var(--scrapscache-text-muted)]">Storage bytes</span>
							<input
								name="maxBytes"
								class="scrapscache-input px-3 py-1.5"
								placeholder="default"
								value={selected.maxBytesOverridden ? String(selected.maxBytes) : ''}
							/>
						</label>
						<label class="space-y-1 text-sm">
							<span class="block text-[var(--scrapscache-text-muted)]">Syncs per minute</span>
							<input
								name="syncPerMinute"
								class="scrapscache-input px-3 py-1.5"
								placeholder="default"
								value={selected.syncPerMinuteOverridden ? String(selected.syncPerMinute) : ''}
							/>
						</label>
						<button class="scrapscache-button scrapscache-button-primary px-3 py-2" type="submit"
							>Save limits</button
						>
						<span class="text-xs text-[var(--scrapscache-text-muted)]"
							>Blank restores the shared default.</span
						>
					</form>

					{#if flags.length}
						<div class="space-y-2">
							<h3 class="text-sm font-medium">Features</h3>
							{#each flags as flag (flag.flag)}
								<div class="flex flex-wrap items-center gap-2 text-sm">
									<span class="font-mono text-xs">{flag.flag}</span>
									<span class="text-[var(--scrapscache-text-muted)]"
										>{selected.flags[flag.flag] ? 'on' : 'off'}</span
									>
									<button
										class="scrapscache-button scrapscache-button-secondary px-2 py-1 text-xs"
										onclick={() => void setFlag(flag.flag, true)}>On</button
									>
									<button
										class="scrapscache-button scrapscache-button-secondary px-2 py-1 text-xs"
										onclick={() => void setFlag(flag.flag, false)}>Off</button
									>
									<button
										class="scrapscache-button scrapscache-button-secondary px-2 py-1 text-xs"
										onclick={() => void setFlag(flag.flag, null)}
										>Default ({flag.defaultEnabled ? 'on' : 'off'})</button
									>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{/if}

			<section class="space-y-3">
				<h2 class="text-lg font-semibold">Feature gates</h2>
				<p class="text-sm text-[var(--scrapscache-text-muted)]">
					A gate that is not listed here is off for everyone. Removing one takes every per-account
					setting with it.
				</p>
				{#each flags as flag (flag.flag)}
					<div
						class="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--scrapscache-border)] p-2 text-sm"
					>
						<span class="font-mono text-xs">{flag.flag}</span>
						<span class="text-[var(--scrapscache-text-muted)]">{flag.description}</span>
						<span class="ml-auto">default {flag.defaultEnabled ? 'on' : 'off'}</span>
						<button
							class="scrapscache-button scrapscache-button-secondary px-2 py-1 text-xs"
							onclick={() =>
								void guard(async () => {
									flags = (
										await adminClient.saveFlag({ ...flag, defaultEnabled: !flag.defaultEnabled })
									).flags;
								})}>Flip default</button
						>
						<button
							class="scrapscache-button px-2 py-1 text-xs text-[var(--scrapscache-danger)]"
							onclick={() => void removeFlag(flag.flag)}>Remove</button
						>
					</div>
				{/each}

				<form class="flex flex-wrap items-end gap-3" onsubmit={saveFlag}>
					<label class="space-y-1 text-sm">
						<span class="block text-[var(--scrapscache-text-muted)]">Gate</span>
						<input
							bind:value={newFlag.flag}
							placeholder="canvas-beta"
							class="scrapscache-input px-3 py-1.5"
						/>
					</label>
					<label class="space-y-1 text-sm">
						<span class="block text-[var(--scrapscache-text-muted)]">What it gates</span>
						<input bind:value={newFlag.description} class="scrapscache-input px-3 py-1.5" />
					</label>
					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" bind:checked={newFlag.defaultEnabled} />
						<span>On by default</span>
					</label>
					<button class="scrapscache-button scrapscache-button-primary px-3 py-2" type="submit"
						>Add gate</button
					>
				</form>
			</section>
		{/if}
	</div>
</div>
