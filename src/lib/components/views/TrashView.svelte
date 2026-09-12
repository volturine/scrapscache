<script lang="ts">
	import NotesFeed from '$lib/components/NotesFeed.svelte';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { useEditorActions } from '$lib/editorContext';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Trash2 } from '@lucide/svelte';
	import { css } from 'styled-system/css';
	import { button } from 'styled-system/recipes';
	import { viewPage } from '$lib/components/viewStyles';

	const { openNote: openEditor } = useEditorActions();
	const trashed = $derived(notesStore.trashedNotes);

	let confirmEmpty = $state(false);

	function emptyTrash() {
		notesStore.emptyTrash();
		confirmEmpty = false;
	}
</script>

<div class={viewPage}>
	{#if trashed.length === 0}
		<EmptyState
			icon={Trash2}
			description="Deleted notes stay here for 7 days before they are deleted forever."
		/>
	{:else}
		<SectionHeader label="Trash" count={trashed.length}>
			{#if confirmEmpty}
				<span class={css({ fontSize: 'xs', color: 'scrapscache.textMuted' })}>Delete all?</span>
				<button type="button" onclick={emptyTrash} class={button({ variant: 'danger', size: 'xs' })}
					>Yes</button
				>
				<button
					type="button"
					onclick={() => (confirmEmpty = false)}
					class={button({ variant: 'quiet', size: 'xs' })}>No</button
				>
			{:else}
				<button
					type="button"
					onclick={() => (confirmEmpty = true)}
					class={button({ variant: 'quiet', size: 'xs' })}>Empty</button
				>
			{/if}
		</SectionHeader>
		<NotesFeed notes={trashed} onOpen={openEditor} />
	{/if}
</div>
