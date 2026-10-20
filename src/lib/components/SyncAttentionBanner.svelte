<script lang="ts">
	import { iconSizeSm, notesShell, syncAttentionStyles as styles } from '$panda/styles';
	import { CloudOff, TriangleAlert } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { resolveSyncAttention, type SyncAttentionTone } from '#lib/syncAttention.js';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { syncStore } from '#lib/stores/sync.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { button } from 'styled-system/recipes';

	let online = $state(typeof navigator === 'undefined' || navigator.onLine !== false);
	let now = $state(Date.now());
	/** The key of the banner the user put away; a different one shows again. */
	let dismissedKey = $state<string | null>(null);
	const titleId = $props.id();

	const attention = $derived(
		resolveSyncAttention({
			synced: syncStore.isLoggedIn,
			keyRetired: syncStore.keyRetired,
			lastError: syncStore.lastError,
			usage: syncStore.usage,
			online,
			lastSync: syncStore.lastSync,
			now
		})
	);
	const shown = $derived(attention && attention.key !== dismissedKey ? attention : null);

	$effect(() => {
		// Once the state clears, a return of it is news again.
		if (!attention) dismissedKey = null;
	});

	onMount(() => {
		const update = () => {
			online = navigator.onLine !== false;
			now = Date.now();
		};
		window.addEventListener('online', update);
		window.addEventListener('offline', update);
		// Keeps "Offline for 2 days" counting without a reload.
		const timer = setInterval(() => (now = Date.now()), 60_000);
		return () => {
			window.removeEventListener('online', update);
			window.removeEventListener('offline', update);
			clearInterval(timer);
		};
	});

	function act() {
		if (!shown) return;
		if (shown.action === 'retry') void notesStore.syncWithCloudManual().catch(() => undefined);
		else if (shown.action === 'open-settings') uiStore.syncOpen = true;
	}

	const icons: Record<SyncAttentionTone, typeof TriangleAlert> = {
		danger: TriangleAlert,
		warning: TriangleAlert,
		muted: CloudOff
	};
</script>

{#if shown}
	{@const Icon = icons[shown.tone]}
	<div class={styles.wrap}>
		<div class={notesShell(uiStore.layout)}>
			<section
				class={styles.banner({ tone: shown.tone })}
				aria-labelledby={titleId}
				data-sync-attention={shown.kind}
			>
				<Icon class={[iconSizeSm, styles.iconTone[shown.tone]]} aria-hidden="true" />
				<p class={styles.text}>
					<strong id={titleId} class={styles.title}>{shown.title}</strong>
					{shown.body}
				</p>
				<div class={styles.actions}>
					{#if shown.action}
						<button type="button" class={button({ variant: 'primary', size: 'xs' })} onclick={act}>
							{shown.actionLabel}
						</button>
					{/if}
					{#if shown.dismissible}
						<button
							type="button"
							class={button({ variant: 'quiet', size: 'xs' })}
							onclick={() => (dismissedKey = shown.key)}
						>
							Dismiss
						</button>
					{/if}
				</div>
			</section>
		</div>
	</div>
{/if}
