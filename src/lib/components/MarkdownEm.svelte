<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children
	}: {
		children?: Snippet;
		[key: string]: unknown;
	} = $props();
</script>

<em class="markdown-token-emphasis">{@render children?.()}</em>
