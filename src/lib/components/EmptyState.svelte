<script lang="ts">
	import { resolve } from '$app/paths';
	import type { LucideIcon } from '@lucide/svelte';
	import { cx } from 'styled-system/css';
	import { emptyState, notesShell } from 'styled-system/recipes';

	type Props = {
		icon: LucideIcon;
		description: string;
		actionLabel?: string;
		onAction?: () => void;
		href?: '/';
	};

	let { icon: Icon, description, actionLabel, onAction, href }: Props = $props();
	const classes = emptyState();
</script>

<div class={cx(notesShell(), classes.root)}>
	<Icon size={24} strokeWidth={1.5} aria-hidden="true" />
	<p class={classes.description}>{description}</p>
	{#if actionLabel && href}
		<a href={resolve(href)} class={classes.action}>
			{actionLabel}
		</a>
	{:else if actionLabel && onAction}
		<button type="button" onclick={onAction} class={classes.action}>
			{actionLabel}
		</button>
	{/if}
</div>
