<script lang="ts">
	import type { Snippet } from 'svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { Format } from '@ark-ui/svelte/format';
	import { notesShell, sectionHeader } from 'styled-system/recipes';

	let {
		label,
		count,
		class: className = '',
		children
	}: {
		label: string;
		count: number;
		class?: string;
		children?: Snippet;
	} = $props();

	const shell = $derived(notesShell({ layout: uiStore.layout }));
	const classes = sectionHeader();
</script>

<div class={[shell, className]}>
	<div class={classes.row}>
		<h2 class={classes.label}>
			{label}
		</h2>
		<span class={classes.count}>
			<Format.Number value={count} />
		</span>
		{#if children}
			<div class={classes.spacer}></div>
			{@render children()}
		{/if}
	</div>
</div>
