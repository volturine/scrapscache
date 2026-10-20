<script lang="ts">
	import { resolve } from '$app/paths';
	import NotesFeed from '#lib/components/NotesFeed.svelte';
	import SearchAnnouncer from '#lib/components/SearchAnnouncer.svelte';
	import SearchNoMatches from '#lib/components/SearchNoMatches.svelte';
	import { matchesElsewhere, noMatchCopy } from '#lib/searchElsewhere.js';
	import { activeFilterCount, noteCount } from '#lib/search.js';
	import SearchFilterBar from '#lib/components/SearchFilterBar.svelte';
	import SectionHeader from '#lib/components/SectionHeader.svelte';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import { TRASH_PURGE_DAYS } from '#lib/utils.js';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { Info, Trash2 } from '@lucide/svelte';
	import { css } from 'styled-system/css';
	import { button, text } from 'styled-system/recipes';
	import { iconSizeSm, notesShell, trashViewStyles, viewHeading, viewPage } from '$panda/styles';

	const { openNote: openEditor } = useEditorActions();
	const trashed = $derived(notesStore.trashedNotes);
	const search = $derived(uiStore.searchFor('trash'));
	const filters = $derived(uiStore.searchFilters);
	const visible = $derived(search ? notesStore.search(search, trashed, filters) : trashed);
	const noMatches = $derived(trashed.length > 0 && visible.length === 0);
	const elsewhere = $derived(noMatches ? matchesElsewhere('trash', search, filters) : []);
	const announcement = $derived(
		!search
			? ''
			: noMatches
				? noMatchCopy('trash', search, elsewhere, activeFilterCount(filters)).announcement
				: `${noteCount(visible.length)} match “${search.trim()}”.`
	);

	let confirmEmpty = $state(false);

	function emptyTrash() {
		notesStore.emptyTrash();
		confirmEmpty = false;
	}
</script>

<div class={viewPage}>
	<h1 class={viewHeading}>Trash</h1>
	{#if search && trashed.length > 0}
		<SearchFilterBar here="trash" count={visible.length} />
	{/if}
	{#if trashed.length === 0}
		<EmptyState
			icon={Trash2}
			description="Deleted notes stay here for {TRASH_PURGE_DAYS} days before they are deleted forever."
			actionLabel="Back to notes"
			href={resolve('')}
		/>
	{:else if visible.length === 0}
		<SearchNoMatches here="trash" query={search} {elsewhere} />
	{:else}
		<div class={notesShell(uiStore.layout)}>
			<p class={trashViewStyles.banner}>
				<Info class={iconSizeSm} aria-hidden="true" />Notes are deleted forever after {TRASH_PURGE_DAYS}
				days.
			</p>
		</div>
		<SectionHeader label="Trash" count={visible.length}>
			<!-- Empty deletes every trashed note, including ones the search hides. -->
			{#if !search}
				{#if confirmEmpty}
					<span class={text({ style: 'caption' })}>Delete all?</span>
					<button
						type="button"
						onclick={emptyTrash}
						class={button({ variant: 'danger', size: 'xs' })}>Yes</button
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
						class={button({ variant: 'quiet', size: 'xs' })}
						><Trash2 class={iconSizeSm} aria-hidden="true" />Empty trash</button
					>
				{/if}
			{/if}
		</SectionHeader>
		<NotesFeed notes={visible} onOpen={openEditor} />
	{/if}
	<SearchAnnouncer message={announcement} />
</div>
