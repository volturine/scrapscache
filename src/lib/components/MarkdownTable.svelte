<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children
	}: {
		children?: Snippet;
		[key: string]: unknown;
	} = $props();
</script>

<div
	class="markdown-block-surface markdown-table-scroll note-scrollbar-hidden"
	data-markdown-table-container
>
	<table class="markdown-table" data-markdown-table>
		{@render children?.()}
	</table>
</div>
