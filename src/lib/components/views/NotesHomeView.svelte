<script lang="ts">
	import { goto } from '$app/navigation';
	import NotesFeed from '#lib/components/NotesFeed.svelte';
	import SectionHeader from '#lib/components/SectionHeader.svelte';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import { pathForView } from '#lib/viewRoutes.js';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { SearchX, StickyNote } from '@lucide/svelte';
	import { css } from 'styled-system/css';
	import { button } from 'styled-system/recipes';
	import { viewHeading, viewPage } from '$panda/styles';

	const { openNote: openEditor, startNewNote } = useEditorActions();

	const pinned = $derived(notesStore.pinnedNotes);
	const others = $derived(notesStore.unpinnedNotes);
	const search = $derived(uiStore.search);
	const filteredPinned = $derived(search ? notesStore.search(search, pinned) : pinned);
	const filteredOthers = $derived(search ? notesStore.search(search, others) : others);

	/** Notes searches active notes only; Archive and Trash search their own, with the same query. */
	function searchIn(view: 'archive' | 'trash') {
		const path = pathForView(view);
		if (!path) return;
		uiStore.setView(view, null, search);
		void goto(path);
	}
</script>

<div class={viewPage}>
	<h1 class={viewHeading}>Notes</h1>
	{#if filteredPinned.length === 0 && filteredOthers.length === 0 && search}
		<EmptyState
			icon={SearchX}
			tagline={`No notes match “${search.trim()}”`}
			description="Archived and deleted notes are not searched here."
		>
			{#snippet actions()}
				<button
					type="button"
					class={button({ variant: 'secondary', size: 'sm' })}
					onclick={() => searchIn('archive')}>Look in Archive</button
				>
				<button
					type="button"
					class={button({ variant: 'secondary', size: 'sm' })}
					onclick={() => searchIn('trash')}>Look in Trash</button
				>
			{/snippet}
		</EmptyState>
	{:else if filteredPinned.length === 0 && filteredOthers.length === 0}
		<EmptyState
			icon={StickyNote}
			tagline="Private, offline-first notes with optional end-to-end encrypted sync."
			description="Capture an idea, task, or anything you want to keep."
			actionLabel="Take a note"
			onAction={startNewNote}
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
