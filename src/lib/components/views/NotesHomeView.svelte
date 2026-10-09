<script lang="ts">
	import NotesFeed from '#lib/components/NotesFeed.svelte';
	import SectionHeader from '#lib/components/SectionHeader.svelte';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { StickyNote } from '@lucide/svelte';
	import { css } from 'styled-system/css';
	import { viewHeading, viewPage } from '$panda/styles';

	const { openNote: openEditor, startNewNote } = useEditorActions();

	const pinned = $derived(notesStore.pinnedNotes);
	const others = $derived(notesStore.unpinnedNotes);
	const search = $derived(uiStore.search);
	const filteredPinned = $derived(search ? notesStore.search(search, pinned) : pinned);
	const filteredOthers = $derived(search ? notesStore.search(search, others) : others);
</script>

<div class={viewPage}>
	<h1 class={viewHeading}>Notes</h1>
	{#if filteredPinned.length === 0 && filteredOthers.length === 0}
		<EmptyState
			icon={StickyNote}
			tagline={search
				? undefined
				: 'Private, offline-first notes with optional end-to-end encrypted sync.'}
			description={search
				? 'No notes found'
				: 'Capture an idea, task, or anything you want to keep.'}
			actionLabel={search ? undefined : 'Take a note'}
			onAction={search ? undefined : startNewNote}
		/>
	{:else}
		{#if filteredPinned.length > 0}
			<SectionHeader label="Pinned" count={filteredPinned.length} />
			<NotesFeed
				notes={filteredPinned}
				onOpen={openEditor}
				class={filteredOthers.length > 0 ? css({ mb: '3xl' }) : ''}
			/>
		{/if}

		{#if filteredOthers.length > 0}
			{#if filteredPinned.length > 0}
				<SectionHeader label="Others" count={filteredOthers.length} class={css({ mt: '2xl' })} />
			{/if}
			<NotesFeed notes={filteredOthers} onOpen={openEditor} />
		{/if}
	{/if}
</div>
