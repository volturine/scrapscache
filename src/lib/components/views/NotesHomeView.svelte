<script lang="ts">
	import NotesFeed from '#lib/components/NotesFeed.svelte';
	import SearchAnnouncer from '#lib/components/SearchAnnouncer.svelte';
	import SearchNoMatches from '#lib/components/SearchNoMatches.svelte';
	import SectionHeader from '#lib/components/SectionHeader.svelte';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import { matchesElsewhere, noMatchCopy } from '#lib/searchElsewhere.js';
	import { activeFilterCount, noteCount } from '#lib/search.js';
	import SearchFilterBar from '#lib/components/SearchFilterBar.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { StickyNote } from '@lucide/svelte';
	import { css } from 'styled-system/css';
	import { viewHeading, viewPage } from '$panda/styles';

	const { openNote: openEditor, startNewNote } = useEditorActions();

	const pinned = $derived(notesStore.pinnedNotes);
	const others = $derived(notesStore.unpinnedNotes);
	const search = $derived(uiStore.searchFor('notes'));
	const filters = $derived(uiStore.searchFilters);
	const filteredPinned = $derived(search ? notesStore.search(search, pinned, filters) : pinned);
	const filteredOthers = $derived(search ? notesStore.search(search, others, filters) : others);
	/** Archived matches, listed under the active ones when the In chip says "Notes and Archive". */
	const archivedMatches = $derived(
		search && uiStore.searchArchiveToo
			? notesStore.search(search, notesStore.archivedNotes, filters)
			: []
	);
	const found = $derived(filteredPinned.length + filteredOthers.length + archivedMatches.length);
	const noMatches = $derived(Boolean(search) && found === 0);
	const elsewhere = $derived(noMatches ? matchesElsewhere('notes', search, filters) : []);
	const announcement = $derived(
		!search
			? ''
			: noMatches
				? noMatchCopy('notes', search, elsewhere, activeFilterCount(filters)).announcement
				: `${noteCount(found)} match “${search.trim()}”.`
	);
</script>

<div class={viewPage}>
	<h1 class={viewHeading}>Notes</h1>
	{#if search}
		<SearchFilterBar here="notes" count={found} />
	{/if}
	{#if noMatches}
		<SearchNoMatches here="notes" query={search} {elsewhere} />
	{:else if found === 0}
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

		{#if archivedMatches.length > 0}
			<SectionHeader
				label="In Archive"
				count={archivedMatches.length}
				class={filteredPinned.length + filteredOthers.length > 0 ? css({ mt: '2xl' }) : ''}
			/>
			<NotesFeed notes={archivedMatches} onOpen={openEditor} />
		{/if}
	{/if}
	<SearchAnnouncer message={announcement} />
</div>
