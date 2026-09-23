<script lang="ts">
	import { onMount } from 'svelte';
	import { historyStyles as styles } from '$panda/styles';
	import { button } from 'styled-system/recipes';
	import { loadProfilePoints } from '$lib/historyClient';
	import { syncStore, type SyncAccount } from '$lib/stores/sync.svelte';

	let {
		account,
		onSelect,
		selectedAt
	}: { account: SyncAccount; onSelect: (at: number) => void; selectedAt?: number | null } =
		$props();
	let points = $state<number[]>([]);
	let nextBefore = $state<number | null | undefined>(undefined);
	let loading = $state(false);
	let error = $state('');

	async function loadMore() {
		if (loading || nextBefore === null) return;
		loading = true;
		error = '';
		try {
			const page = await loadProfilePoints(account, nextBefore);
			if (syncStore.account?.accountId !== account.accountId) return;
			points = [...points, ...page.points];
			nextBefore = page.nextBefore;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not load profile history.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void loadMore();
	});
	function refresh() {
		if (loading) return;
		points = [];
		nextBefore = undefined;
		void loadMore();
	}
</script>

<section class={styles.root} aria-label="Profile time travel">
	<div class={styles.header}>Profile history · up to 30 days</div>
	<button
		type="button"
		class={button({ variant: 'ghost', size: 'sm' })}
		onclick={refresh}
		disabled={loading}>Refresh</button
	>
	{#if error}<p class={styles.empty} role="alert">{error}</p>{/if}
	<div class={['scrollable', styles.list]}>
		{#each points as at (at)}
			<button
				type="button"
				class={[styles.entry, selectedAt === at && styles.entrySelected]}
				aria-current={selectedAt === at ? 'true' : undefined}
				onclick={() => onSelect(at)}
			>
				<span class={styles.dot} aria-hidden="true"></span>
				<span class={styles.entryContent}>
					<span class={styles.title}>{new Date(at).toLocaleDateString()}</span>
					<span class={styles.date}>{new Date(at).toLocaleTimeString()}</span>
				</span>
			</button>
		{/each}
		{#if !loading && points.length === 0 && nextBefore === null}
			<p class={styles.empty}>Profile checkpoints will appear here after this profile syncs.</p>
		{/if}
		{#if nextBefore !== null}
			<button
				type="button"
				class={button({ variant: 'ghost', size: 'sm' })}
				onclick={() => void loadMore()}
				disabled={loading}
			>
				{loading ? 'Loading…' : 'Load older checkpoints'}
			</button>
		{/if}
	</div>
</section>
