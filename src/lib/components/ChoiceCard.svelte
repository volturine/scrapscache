<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronRight } from '@lucide/svelte';
	import { choiceCard } from 'styled-system/recipes';

	let {
		title,
		caption,
		badge = '',
		danger = false,
		disabled = false,
		element = $bindable(null),
		icon,
		onclick
	}: {
		title: string;
		caption: string;
		badge?: string;
		danger?: boolean;
		disabled?: boolean;
		element?: HTMLButtonElement | null;
		icon: Snippet;
		onclick: () => void;
	} = $props();

	const styles = $derived(choiceCard({ interactive: true, compact: true, danger }));
</script>

<button bind:this={element} type="button" class={styles.root} {disabled} {onclick}>
	<span class={styles.icon} aria-hidden="true">{@render icon()}</span>
	<span class={styles.body}>
		<span class={styles.title}
			>{title}{#if badge}<span class={styles.badge}>{badge}</span>{/if}</span
		>
		<span class={styles.description}>{caption}</span>
	</span>
	<ChevronRight size={18} class={styles.arrow} aria-hidden="true" />
</button>
