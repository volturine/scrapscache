<script lang="ts">
	import NotesFeed from '#lib/components/NotesFeed.svelte';
	import SearchAnnouncer from '#lib/components/SearchAnnouncer.svelte';
	import SearchNoMatches from '#lib/components/SearchNoMatches.svelte';
	import SectionHeader from '#lib/components/SectionHeader.svelte';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import { noMatchCopy, placesWithMatches } from '#lib/searchElsewhere.js';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { StickyNote } from '@lucide/svelte';
	import { css } from 'styled-system/css';
	import { viewHeading, viewPage } from '$panda/styles';

	const { openNote: openEditor, startNewNote } = useEditorActions();

	const pinned = $derived(notesStore.pinnedNotes);
	const others = $derived(notesStore.unpinnedNotes);
	const search = $derived(uiStore.searchFor('notes'));
	const filteredPinned = $derived(search ? notesStore.search(search, pinned) : pinned);
	const filteredOthers = $derived(search ? notesStore.search(search, others) : others);
	const noMatches = $derived(
		Boolean(search) && filteredPinned.length === 0 && filteredOthers.length === 0
	);
	const places = $derived(noMatches ? placesWithMatches('notes', search) : []);
</script>

<div class={viewPage}>
	<h1 class={viewHeading}>Notes</h1>
	{#if noMatches}
		<SearchNoMatches here="notes" query={search} {places} />
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
	<SearchAnnouncer message={noMatches ? noMatchCopy('notes', search, places).announcement : ''} />
</div>
