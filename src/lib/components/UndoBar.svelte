<script lang="ts">
	import { actionUndo } from '#lib/stores/actionUndo.svelte.js';
	import { undoBarStyles as styles } from '$panda/styles';
	import { button } from 'styled-system/recipes';
</script>

{#if actionUndo.bar}
	<div class={styles.bar} data-undo-bar role="status">
		<span class={styles.message}>{actionUndo.bar}</span>
		<button
			type="button"
			class={button({ variant: 'ghost', size: 'xs' })}
			onclick={() => actionUndo.undo()}
		>
			Undo
		</button>
	</div>
{/if}
