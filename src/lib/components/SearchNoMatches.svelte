<script lang="ts">
	import { goto } from '$app/navigation';
	import { SearchX } from '@lucide/svelte';
	import { button } from 'styled-system/recipes';
	import EmptyState from './EmptyState.svelte';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import { pathForView } from '#lib/viewRoutes.js';
	import { activeFilterCount } from '#lib/search.js';
	import {
		noMatchCopy,
		PLACE_NAMES,
		shownQuery,
		type Elsewhere,
		type SearchedView,
		type SearchPlace
	} from '#lib/searchElsewhere.js';

	let {
		here,
		query,
		elsewhere
	}: {
		here: SearchedView;
		query: string;
		/** The other places and how many notes the query finds in each. */
		elsewhere: Elsewhere[];
	} = $props();

	const { startNewNote } = useEditorActions();
	const filterCount = $derived(activeFilterCount(uiStore.searchFilters));
	const copy = $derived(noMatchCopy(here, query, elsewhere, filterCount));
	const found = $derived(elsewhere.filter((entry) => entry.count > 0));
	/** A query that found nothing is a fair title for the note that should exist. */
	const canCreate = $derived(here === 'notes' || here === 'label');

	/** Each place searches its own notes, so the query and its chips go along. */
	function lookIn(place: SearchPlace) {
		const path = pathForView(place);
		if (!path) return;
		uiStore.setView(place, null, query, uiStore.searchFilters);
		void goto(path);
	}

	function create() {
		const title = query.trim();
		uiStore.clearSearch();
		startNewNote({ title });
	}
</script>

{#snippet nextSteps()}
	{#each found as entry (entry.place)}
		<button
			type="button"
			class={button({ variant: 'primary', size: 'sm' })}
			onclick={() => lookIn(entry.place)}>Show {entry.count} in {PLACE_NAMES[entry.place]}</button
		>
	{/each}
	{#if filterCount > 0}
		<button
			type="button"
			class={button({ variant: 'secondary', size: 'sm' })}
			onclick={() => uiStore.clearSearchFilters()}>Clear filters</button
		>
	{/if}
	{#if canCreate}
		<button type="button" class={button({ variant: 'secondary', size: 'sm' })} onclick={create}
			>Create a note titled “{shownQuery(query)}”</button
		>
	{/if}
{/snippet}

<EmptyState
	icon={SearchX}
	tagline={copy.title}
	description={copy.description}
	actions={found.length || filterCount > 0 || canCreate ? nextSteps : undefined}
/>
