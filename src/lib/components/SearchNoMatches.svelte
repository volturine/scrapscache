<script lang="ts">
	import { goto } from '$app/navigation';
	import { SearchX } from '@lucide/svelte';
	import { button } from 'styled-system/recipes';
	import EmptyState from './EmptyState.svelte';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { pathForView } from '#lib/viewRoutes.js';
	import {
		noMatchCopy,
		PLACE_NAMES,
		type SearchedView,
		type SearchPlace
	} from '#lib/searchElsewhere.js';

	let {
		here,
		query,
		places
	}: {
		here: SearchedView;
		query: string;
		/** The other places the query finds notes in; each gets a button. */
		places: SearchPlace[];
	} = $props();

	const copy = $derived(noMatchCopy(here, query, places));

	/** Each place searches its own notes, so the query goes along. */
	function lookIn(place: SearchPlace) {
		const path = pathForView(place);
		if (!path) return;
		uiStore.setView(place, null, query);
		void goto(path);
	}
</script>

{#snippet lookElsewhere()}
	{#each places as place (place)}
		<button
			type="button"
			class={button({ variant: 'secondary', size: 'sm' })}
			onclick={() => lookIn(place)}>Look in {PLACE_NAMES[place]}</button
		>
	{/each}
{/snippet}

<EmptyState
	icon={SearchX}
	tagline={copy.title}
	description={copy.description}
	actions={places.length ? lookElsewhere : undefined}
/>
