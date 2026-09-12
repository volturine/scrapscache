<script lang="ts">
	import { useEditorActions } from '$lib/editorContext';
	import { Plus } from '@lucide/svelte';
	import { cx, sva } from 'styled-system/css';
	import { iconButton } from 'styled-system/recipes';

	const { startNewNote } = useEditorActions();
	const styles = sva({
		slots: ['root', 'button', 'icon'],
		base: {
			root: {
				position: 'fixed',
				zIndex: 60,
				bottom: 'var(--app-fab-bottom)',
				right: '1.5rem'
			},
			button: {
				h: 'var(--app-fab-size)',
				w: 'var(--app-fab-size)',
				borderWidth: '1px',
				borderColor: 'scrapscache.border',
				bg: 'scrapscache.surface',
				boxShadow: 'lg'
			},
			icon: { w: '1.5rem', h: '1.5rem' }
		}
	})();
</script>

<!-- Floating + button — bottom right on every device -->
<div class={`new-note-fab ${styles.root}`}>
	<button
		type="button"
		onclick={startNewNote}
		class={cx(iconButton({ variant: 'ghost', size: 'lg' }), styles.button)}
		aria-label="New note"
		title="New note"
	>
		<Plus class={styles.icon} strokeWidth={2.5} aria-hidden="true" />
	</button>
</div>
