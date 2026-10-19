<script lang="ts">
	import { liveStatus } from '$panda/styles';

	/** What to say once the search settles; empty says nothing and clears what was said. */
	let { message }: { message: string } = $props();

	// The query commits 120 ms after each key, so speaking every result would narrate typing.
	const SETTLE_MS = 700;
	let spoken = $state('');

	$effect(() => {
		const next = message;
		if (!next) {
			spoken = '';
			return;
		}
		const timer = setTimeout(() => (spoken = next), SETTLE_MS);
		return () => clearTimeout(timer);
	});
</script>

<!-- Always mounted: screen readers announce changes inside a live region that already
     exists. Polite and not a status role, so it stays apart from the undo bar. -->
<p class={liveStatus} aria-live="polite" aria-atomic="true">{spoken}</p>
