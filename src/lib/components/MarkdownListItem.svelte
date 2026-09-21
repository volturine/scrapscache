<!-- Custom listitem renderer for @humanspeak/svelte-markdown to support task lists -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		task = false,
		checked = false
	}: {
		children?: Snippet;
		task?: boolean;
		checked?: boolean;
		[key: string]: unknown;
	} = $props();
</script>

<li class={task ? 'task-list-item' : undefined}>
	{#if task}
		<input type="checkbox" {checked} disabled />
	{/if}
	{@render children?.()}
</li>
