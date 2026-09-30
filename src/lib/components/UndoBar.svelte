<script lang="ts">
	import { actionUndo } from '$lib/stores/actionUndo.svelte';
	import { css } from 'styled-system/css';
	import { button } from 'styled-system/recipes';

	const bar = css({
		position: 'fixed',
		zIndex: 70,
		left: 'lg',
		bottom: 'var(--app-fab-bottom)',
		display: 'flex',
		alignItems: 'center',
		gap: 'sm',
		maxW: 'calc(100vw - var(--app-fab-size) - 3rem)',
		px: 'md',
		py: 'xs',
		borderWidth: 'hairline',
		borderColor: 'scrapscache.border',
		rounded: 'md',
		bg: 'scrapscache.surface',
		color: 'scrapscache.text',
		boxShadow: 'lg',
		fontSize: 'label'
	});

	const message = css({
		minW: 0,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap'
	});
</script>

{#if actionUndo.bar}
	<div class={bar} data-undo-bar role="status">
		<span class={message}>{actionUndo.bar}</span>
		<button
			type="button"
			class={button({ variant: 'ghost', size: 'xs' })}
			onclick={() => actionUndo.undo()}
		>
			Undo
		</button>
	</div>
{/if}
