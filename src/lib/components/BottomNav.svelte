<script lang="ts">
	import { useEditorActions } from '$lib/editorContext';
	import { Plus } from '@lucide/svelte';
	import { css } from 'styled-system/css';

	const { startNewNote } = useEditorActions();

	const fabContainerClass = css({
		position: 'fixed',
		zIndex: 60,
		bottom: 'var(--app-fab-bottom)',
		right: '1.5rem'
	});

	const fabButtonClass = css({
		display: 'flex',
		h: 'var(--app-fab-size)',
		w: 'var(--app-fab-size)',
		alignItems: 'center',
		justifyContent: 'center',
		rounded: 'full',
		borderWidth: '1px',
		borderColor: 'scrapscache.border',
		bg: 'scrapscache.surface',
		boxShadow: 'lg',
		cursor: 'pointer'
	});

	const plusIconClass = css({
		w: '1.5rem',
		h: '1.5rem'
	});
</script>

<!-- Floating + button — bottom right on every device -->
<div class={`new-note-fab ${fabContainerClass}`}>
	<button
		type="button"
		onclick={startNewNote}
		class={fabButtonClass}
		aria-label="New note"
		title="New note"
	>
		<Plus class={plusIconClass} strokeWidth={2.5} aria-hidden="true" />
	</button>
</div>
