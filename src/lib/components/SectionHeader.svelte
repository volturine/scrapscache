<script lang="ts">
	import type { Snippet } from 'svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { Format } from '@ark-ui/svelte/format';
	import { notesShell, sectionHeaderStyles as classes } from '$panda/styles';

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

	const shell = $derived(notesShell(uiStore.layout));
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
