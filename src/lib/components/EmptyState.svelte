<script lang="ts">
	import { emptyStateStyles, notesShell } from '$panda/styles';
	import { resolve } from '$app/paths';
	import type { LucideIcon } from '@lucide/svelte';
	import { cx } from 'styled-system/css';
	import { button } from 'styled-system/recipes';

	type Props = {
		icon: LucideIcon;
		/** What the product is, in one line; shown above the description. */
		tagline?: string;
		description: string;
		actionLabel?: string;
		onAction?: () => void;
		href?: string;
	};

	let { icon: Icon, tagline, description, actionLabel, onAction, href }: Props = $props();
</script>

<div class={cx(notesShell(), emptyStateStyles.root)}>
	<Icon size={24} strokeWidth={1.5} aria-hidden="true" />
	{#if tagline}
		<p class={emptyStateStyles.tagline}>{tagline}</p>
	{/if}
	<p class={emptyStateStyles.description}>{description}</p>
	{#if actionLabel && href}
		<a
			href={href === '/' || href === '' ? resolve('') : href}
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
