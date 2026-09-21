<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children
	}: {
		children?: Snippet;
		[key: string]: unknown;
	} = $props();
</script>

<strong class="markdown-token-strong">{@render children?.()}</strong>
