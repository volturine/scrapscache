<script lang="ts">
	import type { Snippet } from 'svelte';

	// Deliberately bare. The notes app lives under (app) with its own layout that
	// boots its stores; anything outside that group — the operator dashboard —
	// must not drag the whole app in behind it.
	let { children }: { children: Snippet } = $props();
</script>

{@render children()}
