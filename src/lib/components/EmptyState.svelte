<script lang="ts">
	import { resolve } from '$app/paths';
	import type { LucideIcon } from '@lucide/svelte';
	import { css, cx } from 'styled-system/css';
	import { notesShell } from '$panda/styles';

	type Props = {
		icon: LucideIcon;
		description: string;
		actionLabel?: string;
		onAction?: () => void;
		href?: '/';
	};

	let { icon: Icon, description, actionLabel, onAction, href }: Props = $props();
	const action = css({
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
	});
</script>

<div
	class={cx(
		notesShell(),
		css({
			mx: 'auto',
			mt: '4xl',
			display: 'flex',
			maxW: '24rem',
			flexDirection: 'column',
			alignItems: 'center',
			px: 'lg',
			textAlign: 'center',
			color: 'scrapscache.textMuted'
		})
	)}
>
	<Icon size={24} strokeWidth={1.5} aria-hidden="true" />
	<p class={css({ mt: 'md', textStyle: 'bodyMuted' })}>{description}</p>
	{#if actionLabel && href}
		<a href={resolve(href)} class={action}>
			{actionLabel}
		</a>
	{:else if actionLabel && onAction}
		<button type="button" onclick={onAction} class={action}>
			{actionLabel}
		</button>
	{/if}
</div>
