<script lang="ts">
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
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { Archive } from '@lucide/svelte';
	import { viewHeading, viewPage } from '$panda/styles';

	const { openNote: openEditor } = useEditorActions();
	const archived = $derived(notesStore.archivedNotes);
	const search = $derived(uiStore.searchFor('archive'));
	const filters = $derived(uiStore.searchFilters);
	const visible = $derived(search ? notesStore.search(search, archived, filters) : archived);
	const noMatches = $derived(archived.length > 0 && visible.length === 0);
	const elsewhere = $derived(noMatches ? matchesElsewhere('archive', search, filters) : []);
	const announcement = $derived(
		!search
			? ''
			: noMatches
				? noMatchCopy('archive', search, elsewhere, activeFilterCount(filters)).announcement
				: `${noteCount(visible.length)} match “${search.trim()}”.`
	);
</script>

<div class={viewPage}>
	<h1 class={viewHeading}>Archive</h1>
	{#if search && archived.length > 0}
		<SearchFilterBar here="archive" count={visible.length} />
	{/if}
	{#if archived.length === 0}
		<EmptyState
			icon={Archive}
			description="Archive notes you want to keep without showing them in Notes."
		/>
	{:else if visible.length === 0}
		<SearchNoMatches here="archive" query={search} {elsewhere} />
	{:else}
		<SectionHeader label="Archive" count={visible.length} />
		<NotesFeed notes={visible} onOpen={openEditor} />
	{/if}
	<SearchAnnouncer message={announcement} />
</div>
