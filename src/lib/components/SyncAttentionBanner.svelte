<script lang="ts">
	import { iconSizeSm, notesShell, syncAttentionStyles as styles } from '$panda/styles';
	import { CloudOff, TriangleAlert } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { syncAttentions, type SyncAttentionTone } from '#lib/syncAttention.js';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { syncStore } from '#lib/stores/sync.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { button } from 'styled-system/recipes';

	let online = $state(typeof navigator === 'undefined' || navigator.onLine !== false);
	let now = $state(Date.now());
	/** The banners the user put away. One is forgotten once its state has cleared. */
	let dismissed = $state<ReadonlySet<string>>(new Set());
	const titleId = $props.id();

	const active = $derived(
		syncAttentions({
			synced: syncStore.isLoggedIn,
			keyRetired: syncStore.keyRetired,
			lastError: syncStore.lastError,
			usage: syncStore.usage,
			online,
			lastSync: syncStore.lastSync,
			now
		})
	);
	// The most pressing state that was not put away, so a dismissed warning stays away
	// while a later error comes and goes above it.
	const shown = $derived(active.find((candidate) => !dismissed.has(candidate.key)) ?? null);

	$effect(() => {
		// Once a state clears, a return of it is news again.
		const keys = new Set(active.map((candidate) => candidate.key));
		if ([...dismissed].some((key) => !keys.has(key)))
			dismissed = new Set([...dismissed].filter((key) => keys.has(key)));
	});

	function dismiss(key: string) {
		dismissed = new Set([...dismissed, key]);
	}

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

<!-- Always mounted: screen readers announce what changes inside a live region that
     already exists, not one created together with its text. A polite region of its
     own, not role="status", so it stays apart from the undo bar's. -->
<div
	class={shown ? styles.wrap : undefined}
	aria-live="polite"
	aria-atomic="true"
	data-sync-attention-region
>
	{#if shown}
		{@const Icon = icons[shown.tone]}
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
							onclick={() => dismiss(shown.key)}
						>
							Dismiss
						</button>
					{/if}
				</div>
			</section>
		</div>
	{/if}
</div>
