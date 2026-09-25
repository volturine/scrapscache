<script lang="ts">
	import { linkBadge } from '$panda/styles';
	import { Globe } from '@lucide/svelte';
	import type { LocalLinkCard } from '$lib/linkPreview';

	let { card: _card, size }: { card?: LocalLinkCard; size: 'editor' | 'display' } = $props();
</script>

<span class={linkBadge[size]} aria-hidden="true">
	<Globe size={size === 'editor' ? 16 : 13} class={linkBadge.glyph} />
</span>
