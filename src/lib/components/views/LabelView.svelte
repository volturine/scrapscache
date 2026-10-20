<script lang="ts">
	import { resolve } from '$app/paths';
	import NotesFeed from '#lib/components/NotesFeed.svelte';
	import SearchAnnouncer from '#lib/components/SearchAnnouncer.svelte';
	import SearchNoMatches from '#lib/components/SearchNoMatches.svelte';
	import { matchesElsewhere, noMatchCopy } from '#lib/searchElsewhere.js';
	import { activeFilterCount, noteCount } from '#lib/search.js';
	import SearchFilterBar from '#lib/components/SearchFilterBar.svelte';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { Tag } from '@lucide/svelte';
	import { css } from 'styled-system/css';
	import { hstack } from 'styled-system/patterns';
	import { text } from 'styled-system/recipes';
	import { notesShell, sectionHeaderStyles as sec, viewPage } from '$panda/styles';

	const { openNote: openEditor } = useEditorActions();

	const labelId = $derived(uiStore.activeLabelId);
	const label = $derived(labelId ? notesStore.labelsById.get(labelId) : undefined);
	const notes = $derived(
		label ? notesStore.activeNotes.filter((n) => n.labels.includes(label.id)) : []
	);
	const search = $derived(uiStore.searchFor('label'));
	const filters = $derived(uiStore.searchFilters);
	const visible = $derived(search ? notesStore.search(search, notes, filters) : notes);
	const noMatches = $derived(notes.length > 0 && visible.length === 0);
	const elsewhere = $derived(noMatches ? matchesElsewhere('label', search, filters) : []);
	const announcement = $derived(
		!search
			? ''
			: noMatches
				? noMatchCopy('label', search, elsewhere, activeFilterCount(filters)).announcement
				: `${noteCount(visible.length)} match “${search.trim()}”.`
	);
	const pinned = $derived(visible.filter((n) => n.pinned));
	const others = $derived(visible.filter((n) => !n.pinned));
	const shell = $derived(notesShell(uiStore.layout));
</script>

<div class={viewPage}>
	{#if !label}
		<EmptyState
			icon={Tag}
			description="This label no longer exists."
			actionLabel="Go to Notes"
			href={resolve('')}
		/>
	{:else if notes.length === 0}
		<EmptyState
			icon={Tag}
			description="Create a note to start collecting ideas under this label."
		/>
	{:else}
		<div class={shell}>
			<h1 class={[hstack({ mb: 'lg', px: 'sm' }), text({ style: 'heading' })]}>{label.name}</h1>
			{#if search}
				<SearchFilterBar here="label" count={visible.length} />
			{/if}
		</div>

		{#if visible.length === 0}
			<SearchNoMatches here="label" query={search} {elsewhere} />
		{:else}
			{#if pinned.length > 0}
				<div class={shell}>
					<h2 class={sec.label}>Pinned</h2>
				</div>
				<NotesFeed notes={pinned} onOpen={openEditor} class={css({ mb: '2xl' })} />
			{/if}

			{#if pinned.length > 0 && others.length > 0}
				<div class={shell}>
					<h2 class={sec.label}>Others</h2>
				</div>
			{/if}

			{#if others.length > 0}
				<NotesFeed notes={others} onOpen={openEditor} />
			{/if}
		{/if}
	{/if}
	<SearchAnnouncer message={announcement} />
</div>
