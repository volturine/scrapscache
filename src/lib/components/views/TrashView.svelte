<script lang="ts">
	import NotesFeed from '$lib/components/NotesFeed.svelte';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { useEditorActions } from '$lib/editorContext';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Trash2 } from '@lucide/svelte';
	import { css } from 'styled-system/css';

	const { openNote: openEditor } = useEditorActions();
	const trashed = $derived(notesStore.trashedNotes);

	let confirmEmpty = $state(false);

	function emptyTrash() {
		notesStore.emptyTrash();
		confirmEmpty = false;
	}

	const confirmText = css({ fontSize: 'xs', color: 'scrapscache.textMuted' });
	const dangerBtn = css({
		rounded: 'full',
		bg: 'red.600/10',
		px: '0.75rem',
		py: '0.25rem',
		fontSize: 'xs',
		fontWeight: 'medium',
		color: { base: 'red.600', _dark: 'red.400' },
		cursor: 'pointer',
		transition: 'colors 150ms ease',
		_hover: { bg: 'red.600', color: 'white' }
	});
	const subtleBtn = css({
		rounded: 'full',
		px: '0.75rem',
		py: '0.25rem',
		fontSize: 'xs',
		color: 'scrapscache.textMuted',
		cursor: 'pointer',
		transition: 'colors 150ms ease',
		_hover: { bg: { base: 'black/5', _dark: 'white/10' } }
	});
</script>

<div class={css({ pt: '1rem', pb: '2rem' })}>
	{#if trashed.length === 0}
		<EmptyState
			icon={Trash2}
			description="Deleted notes stay here for 7 days before they are deleted forever."
		/>
	{:else}
		<SectionHeader label="Trash" count={trashed.length}>
			{#if confirmEmpty}
				<span class={confirmText}>Delete all?</span>
				<button type="button" onclick={emptyTrash} class={dangerBtn}>Yes</button>
				<button type="button" onclick={() => (confirmEmpty = false)} class={subtleBtn}>No</button>
			{:else}
				<button type="button" onclick={() => (confirmEmpty = true)} class={subtleBtn}>Empty</button>
			{/if}
		</SectionHeader>
		<NotesFeed notes={trashed} onOpen={openEditor} />
	{/if}
</div>
