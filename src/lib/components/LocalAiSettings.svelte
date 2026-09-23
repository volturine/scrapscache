<script lang="ts">
	import { localAiSettingsStyles as styles, reminderSettingsRow } from '$panda/styles';
	import { ChevronRight, Sparkles, Trash2, X } from '@lucide/svelte';
	import { cx } from 'styled-system/css';
	import { iconButton, menuItem } from 'styled-system/recipes';
	import { localAiStore, LocalAiStatus } from '$lib/stores/localAi.svelte';

	let { onChoose }: { onChoose: () => void } = $props();

	const percent = $derived(Math.round(localAiStore.progress * 100));
</script>

<section aria-label="Local AI">
	{#if localAiStore.status === LocalAiStatus.Absent}
		<button
			type="button"
			onclick={onChoose}
			class={cx(
				menuItem({ density: 'compact' }),
				reminderSettingsRow.base,
				reminderSettingsRow.interactive
			)}
			aria-label="Choose a local AI model"
		>
			<Sparkles class={styles.icon} aria-hidden="true" />
			<span class={styles.label}>Local AI</span>
			<span class={styles.status}>Choose model</span>
			<ChevronRight class={styles.chevron} aria-hidden="true" />
		</button>
	{:else}
		<div class={reminderSettingsRow.base}>
			<Sparkles class={styles.icon} aria-hidden="true" />
			<span class={styles.label}>Local AI</span>
			{#if localAiStore.status === LocalAiStatus.Downloading}
				<span class={styles.status} role="status">{localAiStore.model?.name} · {percent}%</span>
				<button
					type="button"
					class={iconButton({ variant: 'ghost', size: 'xs' })}
					onclick={() => localAiStore.cancel()}
					aria-label="Cancel download"
					title="Cancel download"
				>
					<X class={styles.action} aria-hidden="true" />
				</button>
			{:else if localAiStore.status === LocalAiStatus.Ready}
				<span class={styles.status}>{localAiStore.model?.name}</span>
				<button
					type="button"
					class={iconButton({ variant: 'danger', size: 'xs' })}
					onclick={() => localAiStore.remove()}
					aria-label="Remove local AI model"
					title="Remove model"
				>
					<Trash2 class={styles.action} aria-hidden="true" />
				</button>
			{:else}
				<span class={styles.status}>Needs WebGPU</span>
			{/if}
		</div>
	{/if}
	{#if localAiStore.error}
		<p class={styles.error} role="alert">{localAiStore.error}</p>
	{/if}
</section>
