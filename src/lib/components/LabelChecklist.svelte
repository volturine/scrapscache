<script lang="ts">
	// A searchable, height-capped list of labels to tick, for filters that pick
	// labels out of a workspace that may hold dozens of them.
	import { labelChecklistStyles as styles, labelMenuStyles } from '$panda/styles';
	import type { Label } from '$lib/types';
	import { Checkbox } from '@ark-ui/svelte/checkbox';
	import { Search } from '@lucide/svelte';
	import { cx } from 'styled-system/css';
	import { input } from 'styled-system/recipes';

	let {
		labels,
		selected,
		onToggle,
		label
	}: {
		labels: Label[];
		selected: string[];
		onToggle: (labelId: string) => void;
		/** Names the list for assistive technology, e.g. "Board filter labels". */
		label: string;
	} = $props();

	let query = $state('');
	const matches = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		return needle ? labels.filter((item) => item.name.toLowerCase().includes(needle)) : labels;
	});
</script>

<div class={styles.root}>
	<div class={labelMenuStyles.searchWrap}>
		<Search class={labelMenuStyles.searchIcon} strokeWidth={1.75} aria-hidden="true" />
		<input
			type="search"
			bind:value={query}
			placeholder="Search labels…"
			aria-label={`Search ${label.toLowerCase()}`}
			class={cx(input({ variant: 'outline', size: 'sm' }), labelMenuStyles.searchInput)}
			onkeydown={(event) => {
				// Escape clears the search first, and only then reaches whatever holds the list.
				if (event.key === 'Escape' && query) {
					event.stopPropagation();
					query = '';
				}
			}}
		/>
	</div>
	<div class={styles.list} role="group" aria-label={label}>
		{#each matches as item (item.id)}
			<Checkbox.Root
				checked={selected.includes(item.id)}
				onCheckedChange={() => onToggle(item.id)}
				class={styles.row}
			>
				<Checkbox.Control class={styles.control}>
					<Checkbox.Indicator class={styles.mark}>✓</Checkbox.Indicator>
				</Checkbox.Control>
				<Checkbox.Label class={styles.name}>{item.name}</Checkbox.Label>
				<Checkbox.HiddenInput />
			</Checkbox.Root>
		{/each}
		{#if matches.length === 0}
			<p class={styles.empty}>
				{labels.length === 0 ? 'No labels to choose from.' : `No labels match “${query.trim()}”.`}
			</p>
		{/if}
	</div>
</div>
