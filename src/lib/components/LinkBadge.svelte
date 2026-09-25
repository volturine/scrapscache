<script lang="ts">
	import { linkBadge } from '$panda/styles';
	import { cx } from 'styled-system/css';
	import { noteSurface } from 'styled-system/recipes';
	import type { LocalLinkCard } from '$lib/linkPreview';
	import { siteIcon } from '$lib/siteIcons';

	let { card, size }: { card: LocalLinkCard; size: 'editor' | 'display' } = $props();

	const icon = $derived(siteIcon(card.hostname));
</script>

{#if icon}
	<span class={cx(linkBadge[size], linkBadge.brand)} aria-hidden="true">
		<svg viewBox="0 0 24 24" class={linkBadge.glyph}><path d={icon.path} /></svg>
	</span>
{:else}
	<span class={cx(linkBadge[size], noteSurface({ color: card.tone }))} aria-hidden="true">
		{card.badge}
	</span>
{/if}
