<script lang="ts">
	// Shown over a note while files are dragged onto it.
	import { fileDropHintStyles as styles } from '$panda/styles';
	import { Paperclip } from '@lucide/svelte';
</script>

<div class={styles.root} data-file-drop-hint aria-hidden="true">
	<div class={styles.pill}>
		<Paperclip size={16} aria-hidden="true" />
		Drop to attach
	</div>
</div>
