<script lang="ts">
	import { resolve } from '$app/paths';
	import type { LucideIcon } from '@lucide/svelte';
	import { cx, sva } from 'styled-system/css';
	import { notesShell } from '$lib/uiStyles';

	type Props = {
		icon: LucideIcon;
		description: string;
		actionLabel?: string;
		onAction?: () => void;
		href?: '/';
	};

	let { icon: Icon, description, actionLabel, onAction, href }: Props = $props();
	const emptyState = sva({
		slots: ['root', 'description', 'action'],
		base: {
			root: {
				mx: 'auto',
				mt: '4xl',
				display: 'flex',
				maxW: '24rem',
				flexDirection: 'column',
				alignItems: 'center',
				px: 'lg',
				textAlign: 'center',
				color: 'scrapscache.textMuted'
			},
			description: { mt: 'md', textStyle: 'bodyMuted' },
			action: {
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				mt: 'md',
				rounded: 'pill',
				borderWidth: 'hairline',
				borderColor: 'scrapscache.border',
				px: 'md',
				py: 'xs',
				textStyle: 'button',
				color: 'scrapscache.text',
				cursor: 'pointer',
				transition: 'background-color 150ms ease',
				_hoverable: { bg: 'scrapscache.borderFaint' }
			}
		}
	});
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
