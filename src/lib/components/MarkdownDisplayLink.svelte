<!-- Read-only link renderer for card previews: renders as span to preserve card dragging -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children
	}: {
		children?: Snippet;
		[key: string]: unknown;
	} = $props();
</script>

<span class="markdown-link">{@render children?.()}</span>
