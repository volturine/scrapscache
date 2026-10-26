<script lang="ts">
	// The phone's Labels tab: every label to open, make, rename (swipe a row) or
	// delete, then Archive and Trash. It takes the feed's place, between the top bar
	// and the tab bar, so it is a place like the other tabs rather than an overlay.
	import { labelsScreenStyles as styles } from '$panda/styles';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import Sidebar from './Sidebar.svelte';
</script>

<div class={styles.screen} data-span-screen>
	<p class={styles.hint}>Swipe a label to the left to rename or delete it.</p>
	<!-- Opening a label, Archive or Trash goes there and puts this screen away. -->
	<Sidebar labelsOnly onNavigate={() => (uiStore.labelsOpen = false)} />
</div>
