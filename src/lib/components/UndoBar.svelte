<script lang="ts">
	import { actionUndo } from '#lib/stores/actionUndo.svelte.js';
	import { undoBarStyles as styles } from '$panda/styles';
	import { button } from 'styled-system/recipes';
</script>

<!-- Always mounted: screen readers announce what changes inside a live region that
     already exists, not one created together with its text. -->
<div class={actionUndo.bar ? styles.bar : undefined} data-undo-bar role="status">
	{#if actionUndo.bar}
		<span class={styles.message}>{actionUndo.bar}</span>
		<button
			type="button"
			class={button({ variant: 'ghost', size: 'xs' })}
			onclick={() => actionUndo.undo()}
		>
			Undo
		</button>
	{/if}
</div>
