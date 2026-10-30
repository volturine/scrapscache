<script lang="ts">
	import type { Note } from '#lib/types.js';
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import NoteCard from './NoteCard.svelte';
	import { css } from 'styled-system/css';
	import { masonryItem } from '$panda/styles';
	import { TEXT_SIZE, uiStore } from '#lib/stores/ui.svelte.js';

	let {
		notes,
		onOpen,
		class: className = '',
		children
	}: {
		notes: Note[];
		onOpen: (id: string) => void;
		class?: string;
		children?: Snippet<[Note]>;
	} = $props();

	/** Column count tracks the grid's own width, so cards keep a consistent size
	 *  even when a lead item (calendar) shrinks the columns area. The width is
	 *  counted at the default text size: larger text makes fewer, wider columns,
	 *  down to one when two would be narrower than a 320 px phone's. */
	function colsFor(width: number): number {
		return width >= 1700
			? 7
			: width >= 1400
				? 6
				: width >= 1100
					? 5
					: width >= 768
						? 4
						: width >= 600
							? 3
							: width >= 280
								? 2
								: 1;
	}
	let containerWidth = $state(0);
	const colCount = $derived(
		colsFor(
			(containerWidth || (typeof window !== 'undefined' ? window.innerWidth : 1024)) /
				(uiStore.textSize / TEXT_SIZE.default)
		)
	);

	/** Rough height for shortest-column packing (cards scroll at max-h 320px). */
	function estimateHeight(note: Note): number {
		let h = 20;
		if (note.reminder != null) h += 26;
		if (note.title) h += 22;
		const body = note.body ?? '';
		const lineEstimate = (body.split('\n').length + 1) * 18;
		h += Math.min(280, Math.max(36, lineEstimate));
		if (note.labels?.length) h += 26;
		return Math.min(h, 320);
	}

	// Measured card heights replace estimates as soon as they exist, so packing
	// tracks real layout instead of drifting heuristics (photos, wrapped lines
	// and previews make estimates diverge wildly). Card heights do not depend on
	// which column holds them — all columns share one width — so a remeasure
	// settles instead of oscillating.
	let measuredHeights = $state(new Map<string, { h: number; updatedAt: number }>());
	let gridEl = $state<HTMLDivElement | null>(null);

	const GAP = 10;

	const columns = $derived.by(() => {
		const cols: Note[][] = Array.from({ length: colCount }, () => []);
		const heights: number[] = Array.from({ length: colCount }, () => 0);
		for (const note of notes) {
			let minIdx = 0;
			for (let i = 1; i < colCount; i++) {
				if (heights[i] < heights[minIdx]) minIdx = i;
			}
			cols[minIdx].push(note);
			heights[minIdx] += (measuredHeights.get(note.id)?.h ?? estimateHeight(note)) + 10;
		}
		return cols;
	});

	/** Container width at which every rendered card was last measured; 0 while
	 *  that measurement is pending. */
	let settledWidth = $state(0);
	/** Offscreen cards skip style, layout and paint once their height is known,
	 *  so a page-wide restyle (the theme switch) only touches the cards in view.
	 *  Measured heights stand in for the skipped content, which keeps the
	 *  columns exactly where they were. A card is skipped only at the revision
	 *  it was measured at: a note edited offscreen lays out again first. */
	const skipOffscreen = $derived(settledWidth > 0);
	/** Measure every card again, offscreen ones included; set once mounted. */
	let relayoutAll: (() => void) | undefined;
	// The text settings rewrap every card without changing the grid's width.
	const textLayout = $derived(
		`${uiStore.textSize}:${uiStore.effectiveCodeSize}:${uiStore.codeWrap}`
	);
	/** The text settings the cards were last measured at; mounting measures them first. */
	let laidOutText: string | undefined;
	$effect(() => {
		const previous = laidOutText;
		laidOutText = textLayout;
		if (previous !== undefined && previous !== textLayout) relayoutAll?.();
	});

	onMount(() => {
		const root = gridEl;
		if (!root || typeof ResizeObserver === 'undefined') return;
		let frame: number | undefined;
		const measure = () => {
			const revisions = new Map(notes.map((note) => [note.id, note.updatedAt]));
			const cards = root.querySelectorAll<HTMLElement>('[data-note-height]');
			// A slot's top padding is room for a card's select check, not card: the
			// heights below are the cards', for packing and for a skipped slot to stand at.
			const room = cards.length ? Number.parseFloat(getComputedStyle(cards[0]).paddingTop) || 0 : 0;
			let changed = measuredHeights.size !== cards.length;
			const next = new Map<string, { h: number; updatedAt: number }>();
			for (const el of cards) {
				const id = el.dataset.noteHeight!;
				// Exact, not rounded: a skipped card stands at this height, and
				// rounding would drift the column by a pixel per card.
				const h = el.getBoundingClientRect().height - room;
				const updatedAt = revisions.get(id) ?? 0;
				next.set(id, { h, updatedAt });
				const previous = measuredHeights.get(id);
				if (previous?.h !== h || previous.updatedAt !== updatedAt) changed = true;
			}
			if (changed) measuredHeights = next;
		};
		// A skipped card still reports the height it had, so whenever every
		// card's height may have changed, render them all once before measuring.
		const relayout = () => {
			settledWidth = 0;
			if (frame !== undefined) cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				frame = undefined;
				measure();
				settledWidth = root.clientWidth;
			});
		};
		relayoutAll = relayout;
		const settle = () => {
			if (root.clientWidth === settledWidth) measure();
			else relayout();
		};
		settle();
		const observer = new ResizeObserver(settle);
		observer.observe(root);
		// A web font arriving after the first measure rewraps every card.
		const fonts = document.fonts;
		fonts?.addEventListener('loadingdone', relayout);
		if (fonts?.status === 'loading') void fonts.ready.then(relayout);
		return () => {
			relayoutAll = undefined;
			observer.disconnect();
			fonts?.removeEventListener('loadingdone', relayout);
			if (frame !== undefined) cancelAnimationFrame(frame);
		};
	});
</script>

<div
	bind:this={gridEl}
	class={[css({ position: 'relative' }), className]}
	bind:clientWidth={containerWidth}
>
	<div
		class={css({
			display: 'flex',
			alignItems: 'flex-start',
			gap: 'list',
			w: 'full',
			flex: '1 1 var(--note-card-width)',
			minW: 0
		})}
	>
		{#each columns as col, i (i)}
			<div
				class={css({
					flex: '1 1 0',
					minW: 0,
					display: 'flex',
					flexDirection: 'column',
					gap: 'list'
				})}
			>
				{#each col as note (note.id)}
					{@const measured = measuredHeights.get(note.id)}
					{@const skipHeight =
						skipOffscreen && measured?.updatedAt === note.updatedAt ? measured.h : undefined}
					<div
						data-note-height={note.id}
						class={masonryItem}
						style:content-visibility={skipHeight === undefined ? undefined : 'auto'}
						style:contain-intrinsic-size={skipHeight === undefined
							? undefined
							: `auto ${skipHeight}px`}
					>
						{#if children}
							{@render children(note)}
						{:else}
							<NoteCard {note} {onOpen} />
						{/if}
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>
