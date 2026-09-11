<script lang="ts">
	import type { LucideIcon } from '@lucide/svelte';
	import { emptyState } from 'styled-system/recipes';

	type Props = {
		icon: LucideIcon;
		description: string;
		actionLabel?: string;
		onAction?: () => void;
		href?: string;
	};

	let { icon: Icon, description, actionLabel, onAction, href }: Props = $props();
	const classes = emptyState();
</script>

<div class={`notes-content ${classes.root}`}>
	<Icon size={24} strokeWidth={1.5} aria-hidden="true" />
	<p class={classes.description}>{description}</p>
	{#if actionLabel && href}
		<a {href} class={classes.action}>
			{actionLabel}
		</a>
	{:else if actionLabel && onAction}
		<button type="button" onclick={onAction} class={classes.action}>
			{actionLabel}
		</button>
	{/if}
</div>
