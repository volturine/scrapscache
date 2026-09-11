<script lang="ts">
	import { Checkbox } from '@ark-ui/svelte/checkbox';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { Check, Plus, Search, Tag } from '@lucide/svelte';
	import { css } from 'styled-system/css';

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

	const containerClass = css({
		display: 'flex',
		w: 'min(20rem, calc(100vw - 2rem))',
		flexDirection: 'column',
		p: '0.5rem'
	});

	const headerRowClass = css({
		mb: '0.25rem',
		display: 'flex',
		h: '2rem',
		alignItems: 'center',
		gap: '0.5rem',
		pl: '0.75rem',
		pr: '0.25rem'
	});

	const headerTitleClass = css({
		minW: 0,
		flex: '1',
		fontSize: '11px',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.14em',
		color: 'scrapscache.textMuted'
	});

	const doneBtnClass = css({
		flexShrink: 0,
		rounded: 'md',
		px: '0.5rem',
		py: '0.25rem',
		fontSize: 'xs',
		fontWeight: 'medium',
		color: 'scrapscache.textMuted',
		cursor: 'pointer',
		transition: 'colors 120ms ease',
		_hover: {
			bg: 'scrapscache.interactiveHover',
			color: 'scrapscache.text'
		}
	});

	const searchWrapClass = css({
		position: 'relative',
		mb: '0.25rem'
	});

	const searchIconClass = css({
		pointerEvents: 'none',
		position: 'absolute',
		left: '0.75rem',
		top: '50%',
		h: '1rem',
		w: '1rem',
		transform: 'translateY(-50%)',
		color: 'scrapscache.textMuted'
	});

	const inputClass = css({
		w: 'full',
		rounded: 'xl',
		py: '0.5rem',
		pl: '2.25rem',
		pr: '0.75rem',
		fontSize: 'sm',
		_placeholder: {
			color: 'scrapscache.textMuted'
		}
	});

	const listScrollClass = css({
		display: 'flex',
		maxH: '16rem',
		flexDirection: 'column',
		gap: '0.125rem',
		overflowY: 'auto'
	});

	const createBtnClass = css({
		display: 'flex',
		w: 'full',
		alignItems: 'center',
		gap: '0.75rem',
		rounded: 'xl',
		px: '0.75rem',
		py: '0.625rem',
		textAlign: 'left',
		fontSize: 'sm',
		fontWeight: 'medium',
		color: 'scrapscache.accent',
		cursor: 'pointer',
		transition: 'colors 120ms ease',
		_hover: {
			bg: 'scrapscache.interactiveHover'
		}
	});

	const checkboxItemClass = css({
		display: 'flex',
		w: 'full',
		cursor: 'pointer',
		alignItems: 'center',
		gap: '0.75rem',
		rounded: 'xl',
		px: '0.75rem',
		py: '0.625rem',
		textAlign: 'left',
		fontSize: 'sm',
		fontWeight: 'medium',
		color: 'scrapscache.text',
		transition: 'colors 120ms ease',
		_hover: {
			bg: 'scrapscache.interactiveHover'
		}
	});

	const iconBoxClass = css({
		display: 'grid',
		h: '1.75rem',
		w: '1.75rem',
		flexShrink: 0,
		placeItems: 'center',
		color: 'scrapscache.textMuted',
		'&[data-state=checked]': {
			color: 'scrapscache.accent'
		}
	});

	const iconSizeClass = css({
		w: '1rem',
		h: '1rem'
	});

	const labelTextClass = css({
		minW: 0,
		flex: '1',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap'
	});

	const checkIndicatorClass = css({
		flexShrink: 0,
		color: 'scrapscache.accent'
	});

	const emptyMessageClass = css({
		px: '0.75rem',
		py: '1rem',
		textAlign: 'center',
		fontSize: 'xs',
		color: 'scrapscache.textMuted'
	});
</script>

<div use:labelMenuInteractions class={`scrapscache-popover ${containerClass}`}>
	<div class={headerRowClass}>
		<span class={headerTitleClass}>Labels</span>
		<button type="button" onclick={onClose} class={doneBtnClass}> Done </button>
	</div>

	<div class={searchWrapClass}>
		<Search class={searchIconClass} strokeWidth={1.75} aria-hidden="true" />
		<input
			bind:this={queryInput}
			type="text"
			bind:value={query}
			placeholder="Search or create a label…"
			onkeydown={onQueryKeydown}
			class={`scrapscache-input ${inputClass}`}
		/>
	</div>

	<div class={`${listScrollClass} sidebar-scroll`} style:min-height={listMinHeight}>
		{#if canCreate}
			<button
				type="button"
				onclick={createAndAssign}
				aria-label="Create label"
				class={createBtnClass}
			>
				<span class={iconBoxClass} aria-hidden="true">
					<Plus class={iconSizeClass} strokeWidth={1.75} />
				</span>
				<span class={labelTextClass}>Create “{trimmed}”</span>
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
					class={checkboxItemClass}
				>
					<Checkbox.Control class={iconBoxClass}>
						<Tag
							class={iconSizeClass}
							strokeWidth={1.75}
							fill={checked ? 'currentColor' : 'none'}
							aria-hidden="true"
						/>
					</Checkbox.Control>
					<Checkbox.Label class={labelTextClass}>{label.name}</Checkbox.Label>
					<Checkbox.Indicator class={checkIndicatorClass}>
						<Check class={iconSizeClass} strokeWidth={2.25} aria-hidden="true" />
					</Checkbox.Indicator>
					<Checkbox.HiddenInput />
				</Checkbox.Root>
			{/if}
		{/each}

		{#if matches.length === 0 && !canCreate}
			<p class={emptyMessageClass}>No labels yet. Type a name to create one.</p>
		{/if}
	</div>
</div>
