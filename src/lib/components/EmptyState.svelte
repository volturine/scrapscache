<script lang="ts">
	import { emptyStateStyles, notesShell } from '$panda/styles';
	import type { ResolvedPathname } from '$app/types';
	import type { LucideIcon } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { cx } from 'styled-system/css';
	import { button } from 'styled-system/recipes';

	type Props = {
		icon: LucideIcon;
		/** The headline, above the description: what the product is, or what a search found. */
		tagline?: string;
		description: string;
		actionLabel?: string;
		onAction?: () => void;
		/** Where the action goes, already passed through `resolve`. */
		href?: ResolvedPathname;
		/** Several ways forward, side by side, in place of the single action. */
		actions?: Snippet;
	};

	let { icon: Icon, tagline, description, actionLabel, onAction, href, actions }: Props = $props();
</script>

<div class={cx(notesShell(), emptyStateStyles.root)} data-span-screen>
	<Icon size={24} strokeWidth={1.5} aria-hidden="true" />
	{#if tagline}
		<p class={emptyStateStyles.tagline}>{tagline}</p>
	{/if}
	<p class={emptyStateStyles.description}>{description}</p>
	{#if actions}
		<div class={emptyStateStyles.actions}>{@render actions()}</div>
	{:else if actionLabel && href}
		<a {href} class={cx(button({ variant: 'secondary', size: 'sm' }), emptyStateStyles.action)}>
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
