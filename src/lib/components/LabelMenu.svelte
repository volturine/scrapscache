<script lang="ts">
	import { Checkbox } from '@ark-ui/svelte/checkbox';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { Check, Plus, Search, Tag } from '@lucide/svelte';

	let {
		noteId,
		onClose
	}: {
		noteId: string;
		onClose: () => void;
	} = $props();

	let query = $state('');
	let queryInput = $state<HTMLInputElement | null>(null);

	const note = $derived(notesStore.notes.find((n) => n.id === noteId));
	const trimmed = $derived(query.trim());
	const matches = $derived(
		trimmed
			? notesStore.labels.filter((label) =>
					label.name.toLowerCase().includes(trimmed.toLowerCase())
				)
			: notesStore.labels
	);
	const exact = $derived(
		notesStore.labels.find((label) => label.name.toLowerCase() === trimmed.toLowerCase())
	);
	const canCreate = $derived(trimmed !== '' && !exact);
	// Hold the height the full list needs (capped at the scroll height) so filtering
	// never shrinks the popover and shifts it under the pointer on every keystroke.
	const listMinHeight = $derived(`${Math.min(notesStore.labels.length, 5) * 3.125}rem`);

	function toggle(id: string) {
		if (!note) return;
		notesStore.toggleLabel(noteId, id);
	}

	function createAndAssign() {
		// Read the input directly as well as the bound state. On mobile, a very
		// quick first tap can arrive before the reactive binding settles.
		const name = (queryInput?.value ?? query).trim();
		if (!name) return;
		const label = notesStore.createLabel(name);
		query = '';
		if (label && note) notesStore.toggleLabel(noteId, label.id);
	}

	/** Enter either creates the typed label or assigns the one it already names. */
	function submitQuery() {
		const name = (queryInput?.value ?? query).trim();
		if (!name) return;
		const existing = notesStore.labels.find(
			(label) => label.name.toLowerCase() === name.toLowerCase()
		);
		if (!existing) {
			createAndAssign();
			return;
		}
		query = '';
		if (note && !note.labels.includes(existing.id)) toggle(existing.id);
	}

	function onQueryKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			submitQuery();
			return;
		}
		// Escape clears a narrowed list first, and only then closes the menu.
		if (event.key === 'Escape' && query !== '') {
			event.preventDefault();
			event.stopPropagation();
			query = '';
		}
	}

	function keepKeyboardOpen(event: PointerEvent) {
		if (event.pointerType !== 'touch') return;
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest('button, [data-scope="checkbox"]')) event.preventDefault();
	}

	function labelMenuInteractions(node: HTMLElement) {
		node.addEventListener('pointerdown', keepKeyboardOpen);
		return {
			destroy() {
				node.removeEventListener('pointerdown', keepKeyboardOpen);
			}
		};
	}
</script>

<div
	use:labelMenuInteractions
	class="scrapscache-popover flex w-[min(20rem,calc(100vw-2rem))] flex-col p-2"
>
	<div class="mb-1 flex h-8 items-center gap-2 pl-3 pr-1">
		<span
			class="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--scrapscache-text-muted)]"
			>Labels</span
		>
		<button
			type="button"
			onclick={onClose}
			class="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-[var(--scrapscache-text-muted)] transition-colors hover:bg-[var(--scrapscache-interactive-hover)] hover:text-[var(--scrapscache-text)]"
		>
			Done
		</button>
	</div>

	<div class="relative mb-1">
		<Search
			class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--scrapscache-text-muted)]"
			strokeWidth={1.75}
			aria-hidden="true"
		/>
		<input
			bind:this={queryInput}
			type="text"
			bind:value={query}
			placeholder="Search or create a label…"
			onkeydown={onQueryKeydown}
			class="scrapscache-input w-full rounded-xl py-2 pl-9 pr-3 text-sm placeholder:text-[var(--scrapscache-text-muted)]"
		/>
	</div>

	<div
		class="flex max-h-64 flex-col gap-0.5 overflow-y-auto sidebar-scroll"
		style:min-height={listMinHeight}
	>
		{#if canCreate}
			<button
				type="button"
				onclick={createAndAssign}
				aria-label="Create label"
				class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[var(--scrapscache-accent)] transition-colors hover:bg-[var(--scrapscache-interactive-hover)]"
			>
				<span class="grid h-7 w-7 shrink-0 place-items-center" aria-hidden="true">
					<Plus class="h-4 w-4" strokeWidth={1.75} />
				</span>
				<span class="min-w-0 flex-1 truncate">Create “{trimmed}”</span>
			</button>
		{/if}

		{#each matches as label (label.id)}
			{#if note}
				{@const checked = note.labels.includes(label.id)}
				<Checkbox.Root
					{checked}
					onCheckedChange={(details) => {
						const on = details.checked === true;
						if (on !== note.labels.includes(label.id)) toggle(label.id);
					}}
					class="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[var(--scrapscache-text)] transition-colors hover:bg-[var(--scrapscache-interactive-hover)]"
				>
					<Checkbox.Control
						class="grid h-7 w-7 shrink-0 place-items-center text-[var(--scrapscache-text-muted)] data-[state=checked]:text-[var(--scrapscache-accent)]"
					>
						<Tag
							class="h-4 w-4"
							strokeWidth={1.75}
							fill={checked ? 'currentColor' : 'none'}
							aria-hidden="true"
						/>
					</Checkbox.Control>
					<Checkbox.Label class="min-w-0 flex-1 truncate">{label.name}</Checkbox.Label>
					<Checkbox.Indicator class="shrink-0 text-[var(--scrapscache-accent)]">
						<Check class="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
					</Checkbox.Indicator>
					<Checkbox.HiddenInput />
				</Checkbox.Root>
			{/if}
		{/each}

		{#if matches.length === 0 && !canCreate}
			<p class="px-3 py-4 text-center text-xs text-[var(--scrapscache-text-muted)]">
				No labels yet. Type a name to create one.
			</p>
		{/if}
	</div>
</div>
