<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children
	}: {
		children?: Snippet;
		[key: string]: unknown;
	} = $props();
</script>

<del class="markdown-token-strikethrough">{@render children?.()}</del>
