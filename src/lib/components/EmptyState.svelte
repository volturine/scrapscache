<script lang="ts">
	import { emptyStateStyles, notesShell } from '$panda/styles';
	import { resolve } from '$app/paths';
	import type { LucideIcon } from '@lucide/svelte';
	import { cx } from 'styled-system/css';
	import { button } from 'styled-system/recipes';

	type Props = {
		icon: LucideIcon;
		description: string;
		actionLabel?: string;
		onAction?: () => void;
		href?: '/';
	};

	let { icon: Icon, description, actionLabel, onAction, href }: Props = $props();
</script>

<div class={cx(notesShell(), emptyStateStyles.root)}>
	<Icon size={24} strokeWidth={1.5} aria-hidden="true" />
	<p class={emptyStateStyles.description}>{description}</p>
	{#if actionLabel && href}
		<a
			href={resolve(href)}
			class={cx(button({ variant: 'secondary', size: 'sm' }), emptyStateStyles.action)}
		>
			{actionLabel}
		</a>
	{:else if actionLabel && onAction}
		<button
			type="button"
			onclick={onAction}
			class={cx(button({ variant: 'secondary', size: 'sm' }), emptyStateStyles.action)}
		>
			{actionLabel}
		</button>
	{/if}
</div>
