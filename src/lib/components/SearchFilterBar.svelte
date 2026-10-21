<script lang="ts">
	// The chips under the search field: where to look, and which label, colour or
	// kind of note to keep. They show only while a query is committed, with the count
	// of what it found here.
	import { goto } from '$app/navigation';
	import { Menu } from '@ark-ui/svelte/menu';
	import { Check, ChevronDown, X } from '@lucide/svelte';
	import { cx } from 'styled-system/css';
	import { menuItem, noteSurface } from 'styled-system/recipes';
	import { popover, searchStyles as styles } from '$panda/styles';
	import { portalToAppOverlay } from '#lib/appViewport.js';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { NOTE_COLOR_NAMES, NOTE_COLOR_ORDER, type NoteColor } from '#lib/types.js';
	import {
		activeFilterCount,
		noteCount,
		SEARCH_TYPES,
		TYPE_NAMES,
		type SearchType
	} from '#lib/search.js';
	import { PLACE_NAMES, type SearchedView, type SearchPlace } from '#lib/searchElsewhere.js';
	import { pathForView } from '#lib/viewRoutes.js';

	let { here, count }: { here: SearchedView; count: number } = $props();

	type Scope = SearchPlace | 'notes-archive';
	const SCOPES: readonly Scope[] = ['notes', 'notes-archive', 'archive', 'trash'];
	const SCOPE_NAMES: Record<Scope, string> = {
		...PLACE_NAMES,
		'notes-archive': 'Notes and Archive'
	};

	const filters = $derived(uiStore.searchFilters);
	const scope = $derived<Scope>(
		here === 'notes' && uiStore.searchArchiveToo
			? 'notes-archive'
			: here === 'label'
				? 'notes'
				: here
	);
	const labels = $derived(
		[...notesStore.labels].sort((a, b) =>
			a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
		)
	);
	const labelName = $derived(
		filters.label === null ? null : (notesStore.labelsById.get(filters.label)?.name ?? null)
	);
	const itemClass = cx(menuItem({ density: 'compact' }), styles.item);

	/** Where to look: the archive joins Notes in place; another place is its own view. */
	function setScope(next: Scope) {
		if (next === scope) return;
		const place: SearchPlace = next === 'notes-archive' ? 'notes' : next;
		if (here === place) {
			uiStore.searchArchiveToo = next === 'notes-archive';
			return;
		}
		const path = pathForView(place);
		if (!path) return;
		uiStore.setView(place, null, uiStore.search, filters);
		uiStore.searchArchiveToo = next === 'notes-archive';
		void goto(path);
	}

	function chipText(name: string, value: string | null): string {
		return value === null ? name : `${name}: ${value}`;
	}
</script>

{#snippet chip(name: string, value: string | null)}
	<Menu.Trigger class={styles.chip} data-set={value === null ? undefined : ''}>
		{chipText(name, value)}
		<ChevronDown class={styles.chipGlyph} aria-hidden="true" />
	</Menu.Trigger>
{/snippet}

{#snippet check()}
	<Menu.ItemIndicator><Check size={14} aria-hidden="true" /></Menu.ItemIndicator>
{/snippet}

<div class={styles.bar} data-search-filters>
	<div class={styles.chips}>
		{#if here !== 'label'}
			<Menu.Root positioning={{ placement: 'bottom-start' }} lazyMount unmountOnExit>
				{@render chip('In', SCOPE_NAMES[scope])}
				<div {@attach portalToAppOverlay}>
					<Menu.Positioner>
						<Menu.Content class={cx(popover, styles.menu)} aria-label="Where to search">
							<Menu.RadioItemGroup
								value={scope}
								onValueChange={(details) => setScope(details.value as Scope)}
							>
								{#each SCOPES as option (option)}
									<Menu.RadioItem value={option} class={itemClass}>
										{@render check()}
										<Menu.ItemText>{SCOPE_NAMES[option]}</Menu.ItemText>
									</Menu.RadioItem>
								{/each}
							</Menu.RadioItemGroup>
						</Menu.Content>
					</Menu.Positioner>
				</div>
			</Menu.Root>
		{/if}

		<Menu.Root positioning={{ placement: 'bottom-start' }} lazyMount unmountOnExit>
			{@render chip('Label', labelName)}
			<div {@attach portalToAppOverlay}>
				<Menu.Positioner>
					<Menu.Content class={cx(popover, styles.menu)} aria-label="Filter by label">
						<Menu.RadioItemGroup
							value={filters.label ?? ''}
							onValueChange={(details) =>
								uiStore.setSearchFilter('label', details.value === '' ? null : details.value)}
						>
							<Menu.RadioItem value="" class={itemClass}>
								{@render check()}
								<Menu.ItemText>Any label</Menu.ItemText>
							</Menu.RadioItem>
							{#each labels as label (label.id)}
								<Menu.RadioItem value={label.id} class={itemClass}>
									{@render check()}
									<Menu.ItemText>{label.name}</Menu.ItemText>
								</Menu.RadioItem>
							{/each}
						</Menu.RadioItemGroup>
					</Menu.Content>
				</Menu.Positioner>
			</div>
		</Menu.Root>

		<Menu.Root positioning={{ placement: 'bottom-start' }} lazyMount unmountOnExit>
			{@render chip('Colour', filters.color === null ? null : NOTE_COLOR_NAMES[filters.color])}
			<div {@attach portalToAppOverlay}>
				<Menu.Positioner>
					<Menu.Content class={cx(popover, styles.menu)} aria-label="Filter by colour">
						<Menu.RadioItemGroup
							value={filters.color ?? ''}
							onValueChange={(details) =>
								uiStore.setSearchFilter(
									'color',
									details.value === '' ? null : (details.value as NoteColor)
								)}
						>
							<Menu.RadioItem value="" class={itemClass}>
								{@render check()}
								<Menu.ItemText>Any colour</Menu.ItemText>
							</Menu.RadioItem>
							{#each NOTE_COLOR_ORDER as color (color)}
								<Menu.RadioItem value={color} class={itemClass}>
									{@render check()}
									<span class={cx(styles.swatch, noteSurface({ color }))} aria-hidden="true"></span>
									<Menu.ItemText>{NOTE_COLOR_NAMES[color]}</Menu.ItemText>
								</Menu.RadioItem>
							{/each}
						</Menu.RadioItemGroup>
					</Menu.Content>
				</Menu.Positioner>
			</div>
		</Menu.Root>

		<Menu.Root positioning={{ placement: 'bottom-start' }} lazyMount unmountOnExit>
			{@render chip('Type', filters.type === null ? null : TYPE_NAMES[filters.type])}
			<div {@attach portalToAppOverlay}>
				<Menu.Positioner>
					<Menu.Content class={cx(popover, styles.menu)} aria-label="Filter by type">
						<Menu.RadioItemGroup
							value={filters.type ?? ''}
							onValueChange={(details) =>
								uiStore.setSearchFilter(
									'type',
									details.value === '' ? null : (details.value as SearchType)
								)}
						>
							<Menu.RadioItem value="" class={itemClass}>
								{@render check()}
								<Menu.ItemText>Any type</Menu.ItemText>
							</Menu.RadioItem>
							{#each SEARCH_TYPES as type (type)}
								<Menu.RadioItem value={type} class={itemClass}>
									{@render check()}
									<Menu.ItemText>{TYPE_NAMES[type]}</Menu.ItemText>
								</Menu.RadioItem>
							{/each}
						</Menu.RadioItemGroup>
					</Menu.Content>
				</Menu.Positioner>
			</div>
		</Menu.Root>

		{#if activeFilterCount(filters) > 0}
			<button type="button" class={styles.chip} onclick={() => uiStore.clearSearchFilters()}>
				<X class={styles.chipGlyph} aria-hidden="true" />Clear filters
			</button>
		{/if}
	</div>
	<span class={styles.count} data-search-count>{noteCount(count)}</span>
</div>
