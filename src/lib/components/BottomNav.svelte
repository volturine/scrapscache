<script lang="ts">
	import { useEditorActions } from '$lib/editorContext';
	import { Plus } from '@lucide/svelte';
	import { css, cx } from 'styled-system/css';
	import { iconButton } from 'styled-system/recipes';

	const { startNewNote } = useEditorActions();
</script>

<!-- Floating + button — bottom right on every device -->
<div
	class={`new-note-fab ${css({
		position: 'fixed',
		zIndex: 60,
		bottom: 'var(--app-fab-bottom)',
		right: '1.5rem'
	})}`}
>
	<button
		type="button"
		onclick={startNewNote}
		class={cx(
			iconButton({ variant: 'ghost', size: 'lg' }),
			css({
				h: 'var(--app-fab-size)',
				w: 'var(--app-fab-size)',
				borderWidth: '1px',
				borderColor: 'scrapscache.border',
				bg: 'scrapscache.surface',
				boxShadow: 'lg'
			})
		)}
		aria-label="New note"
		title="New note"
	>
		<Plus class={css({ w: '1.5rem', h: '1.5rem' })} strokeWidth={2.5} aria-hidden="true" />
	</button>
</div>
