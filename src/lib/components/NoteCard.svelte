<script lang="ts">
	import { css, cx } from 'styled-system/css';
	import { badge, noteCard, noteSurface } from 'styled-system/recipes';
	import { notesStore } from '$lib/stores/notes.svelte';
	import type { Note } from '$lib/types';
	import { activateOnKeyboard, formatReminder, isReminderOverdue, noteActivity } from '$lib/utils';
	import { appClock } from '$lib/appClock.svelte';
	import { cardSwipeStyle, createCardSwipe } from '$lib/cardSwipe';
	import { overflowingTable } from '$lib/tableScroll';
	import NoteBodyDisplay from './NoteBodyDisplay.svelte';
	import NoteQuickActions from './NoteQuickActions.svelte';
	import ReminderLabel from './ReminderLabel.svelte';
	import { Archive, ArchiveRestore, Lock, RotateCcw, Trash2 } from '@lucide/svelte';
	import { onDestroy } from 'svelte';

	let {
		note,
		onOpen
	}: {
		note: Note;
		onOpen: (id: string) => void;
	} = $props();

	let cardEl = $state<HTMLDivElement | null>(null);
	let hazeActive = $state(false);

	function closeHaze() {
		hazeActive = false;
	}

	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		hazeActive = true;
	}

	// A mouse leaving the card dismisses the haze; touch lift also fires
	// pointerleave, and on touch the haze already closes on the next press.
	function handleCardPointerLeave(e: PointerEvent) {
		if (hazeActive && e.pointerType === 'mouse') closeHaze();
	}

	function openUnlessDrag(e: MouseEvent) {
		if (e.button !== 0) return;
		if (hazeActive) {
			e.stopPropagation();
			closeHaze();
			return;
		}
		if (swipe.wasDrag() || suppressClick) {
			e.stopPropagation();
			return;
		}
		onOpen(note.id);
	}

	// The card shield owns every press, including one that starts on a table.
	// A sideways drag there moves the table; a tap still opens the note.
	let tableGesture: {
		el: HTMLElement;
		startX: number;
		startY: number;
		startScroll: number;
		horizontal: boolean | null;
		moved: boolean;
		pointerId: number;
	} | null = null;
	let suppressClick = false;
	let suppressTimer: ReturnType<typeof setTimeout> | null = null;

	function onCardPointerDown(event: PointerEvent) {
		const table = cardEl ? overflowingTable(cardEl, event.clientX, event.clientY) : null;
		if (!table || (event.pointerType === 'mouse' && event.button !== 0)) {
			swipe.onPointerDown(event);
			return;
		}
		tableGesture = {
			el: table,
			startX: event.clientX,
			startY: event.clientY,
			startScroll: table.scrollLeft,
			horizontal: null,
			moved: false,
			pointerId: event.pointerId
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onCardPointerMove(event: PointerEvent) {
		if (!tableGesture || event.pointerId !== tableGesture.pointerId) {
			swipe.onPointerMove(event);
			return;
		}
		const dx = event.clientX - tableGesture.startX;
		const dy = event.clientY - tableGesture.startY;
		if (tableGesture.horizontal === null) {
			if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
			tableGesture.horizontal = Math.abs(dx) > Math.abs(dy);
			if (!tableGesture.horizontal) {
				(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
				tableGesture = null;
				return;
			}
		}
		event.preventDefault();
		tableGesture.moved = true;
		tableGesture.el.scrollLeft = tableGesture.startScroll - dx;
	}

	function onCardPointerUp(event: PointerEvent) {
		if (!tableGesture || event.pointerId !== tableGesture.pointerId) {
			swipe.onPointerUp(event);
			return;
		}
		if (tableGesture.moved) {
			suppressClick = true;
			event.stopPropagation();
			if (suppressTimer) clearTimeout(suppressTimer);
			suppressTimer = setTimeout(() => {
				suppressClick = false;
			}, 50);
		}
		tableGesture = null;
	}

	function onCardPointerCancel(event: PointerEvent) {
		if (!tableGesture || event.pointerId !== tableGesture.pointerId) {
			swipe.onPointerCancel(event);
			return;
		}
		tableGesture = null;
	}

	// Tags live on the swipe surface. When they overflow, keep the press here so
	// the card does not start a swipe; touch/trackpad then use native overflow-x,
	// and a mouse drag pans the row by hand.
	let labelsScrolling = false;
	let labelsScrollMoved = false;
	let labelsStartX = 0;
	let labelsStartY = 0;
	let labelsStartScroll = 0;
	let labelsPointerId: number | null = null;
	let labelsPointerType: string | null = null;

	function labelsOverflowing(el: HTMLElement): boolean {
		return el.scrollWidth > el.clientWidth + 1;
	}

	function onLabelsPointerDown(event: PointerEvent) {
		const el = event.currentTarget as HTMLElement;
		if (!labelsOverflowing(el) || (event.pointerType === 'mouse' && event.button !== 0)) return;
		event.stopPropagation();
		labelsScrolling = true;
		labelsScrollMoved = false;
		labelsStartX = event.clientX;
		labelsStartY = event.clientY;
		labelsStartScroll = el.scrollLeft;
		labelsPointerId = event.pointerId;
		labelsPointerType = event.pointerType;
		if (event.pointerType === 'mouse') {
			el.setPointerCapture(event.pointerId);
		}
	}

	function onLabelsPointerMove(event: PointerEvent) {
		if (!labelsScrolling || event.pointerId !== labelsPointerId) return;
		event.stopPropagation();
		// Touch pans natively via overflow-x; only a mouse drag drives scrollLeft.
		if (labelsPointerType !== 'mouse') return;
		const el = event.currentTarget as HTMLElement;
		const dx = event.clientX - labelsStartX;
		const dy = event.clientY - labelsStartY;
		if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
		if (Math.abs(dy) > Math.abs(dx)) {
			labelsScrolling = false;
			labelsPointerId = null;
			return;
		}
		labelsScrollMoved = true;
		el.scrollLeft = labelsStartScroll - dx;
	}

	function onLabelsPointerUp(event: PointerEvent) {
		if (!labelsScrolling || event.pointerId !== labelsPointerId) {
			labelsPointerId = null;
			return;
		}
		labelsScrolling = false;
		labelsPointerId = null;
		event.stopPropagation();
		if (labelsScrollMoved) {
			suppressClick = true;
			if (suppressTimer) clearTimeout(suppressTimer);
			suppressTimer = setTimeout(() => {
				suppressClick = false;
			}, 50);
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (hazeActive) {
			if (event.key === 'Escape') {
				event.stopPropagation();
				event.preventDefault();
				closeHaze();
			}
			return;
		}
		activateOnKeyboard(event, () => onOpen(note.id));
	}

	const labelsForNote = $derived(
		note.labels
			.map((id) => notesStore.labelsById.get(id))
			.filter((l): l is NonNullable<typeof l> => !!l)
	);

	const openLabel = $derived.by(() => {
		const title = note.title || 'untitled note';
		if (note.reminder == null) return `Open ${title}`;
		const when = formatReminder(note.reminder);
		return isReminderOverdue(note.reminder)
			? `Open ${title}, overdue reminder ${when}`
			: `Open ${title}, reminder ${when}`;
	});

	let offsetX = $state(0);
	let dragging = $state(false);

	const swipe = createCardSwipe({
		onSwipeLeft: () => {
			if (note.trashed) notesStore.restoreNote(note.id);
			else notesStore.toggleArchive(note.id);
		},
		onSwipeRight: () => {
			if (note.trashed) void notesStore.deleteNoteForever(note.id);
			else notesStore.trashNote(note.id);
		},
		setVisual: (s) => {
			offsetX = s.offsetX;
			dragging = s.dragging;
		}
	});

	onDestroy(() => {
		swipe.dispose();
		if (suppressTimer) clearTimeout(suppressTimer);
	});

	const card = $derived(noteCard({ pinned: note.pinned }));
	const activity = $derived(noteActivity(note, appClock.now));
</script>

<div class={cx(card.cardOuter, css({ _motionSafe: { animation: 'cardIn' } }))}>
	{#if offsetX < 0}
		<div class={card.swipeRestore}>
			{#if note.trashed}
				<RotateCcw size={24} aria-hidden="true" />
			{:else if note.archived}
				<ArchiveRestore size={24} aria-hidden="true" />
			{:else}
				<Archive size={24} aria-hidden="true" />
			{/if}
		</div>
	{:else if offsetX > 0}
		<div class={card.swipeTrash}>
			<Trash2 size={24} aria-hidden="true" />
		</div>
	{/if}

	<div
		bind:this={cardEl}
		role="button"
		tabindex="0"
		aria-label={openLabel}
		class={cx(card.cardBody, 'group', noteSurface({ color: note.color }))}
		style={cardSwipeStyle(offsetX, dragging)}
		onpointerdown={onCardPointerDown}
		onpointermove={onCardPointerMove}
		onpointerup={onCardPointerUp}
		onpointercancel={onCardPointerCancel}
		onpointerleave={handleCardPointerLeave}
		onclick={openUnlessDrag}
		oncontextmenu={handleContextMenu}
		onkeydown={handleKeydown}
	>
		{#if note.reminder != null}
			<div class={css({ flexShrink: 0 })}>
				<ReminderLabel reminder={note.reminder} />
			</div>
		{/if}

		<div class={card.bodyFrame}>
			<!-- A long preview scrolls inside its card, then hands the swipe to the
			     gallery. Overscroll containment here stopped Android from ever scrolling
			     the gallery from a card. -->
			<div
				class={cx(
					'note-scrollbar-hidden',
					css({
						minH: 0,
						flex: '1',
						overflowX: 'hidden',
						overflowY: note.secret ? 'hidden' : 'auto',
						touchAction: 'pan-y'
					}),
					note.secret && css({ display: 'flex', flexDirection: 'column' })
				)}
				data-secret-body={note.secret ? '' : undefined}
			>
				<div
					class={cx(
						css({ position: 'relative' }),
						note.secret && css({ flex: '1', minH: 0, display: 'flex', flexDirection: 'column' })
					)}
				>
					<div
						class={cx(
							note.secret
								? css({ flex: '1', minH: 0, display: 'flex', flexDirection: 'column' })
								: card.contentPad
						)}
					>
						{#if note.title}
							<h3
								class={cx(
									card.title,
									css({ flexShrink: 0 }),
									note.secret && css({ px: 'md', pt: 'md', pb: 'sm' })
								)}
							>
								{note.title}
							</h3>
						{/if}
						<div
							class={cx(
								css({ position: 'relative', minH: '3rem' }),
								note.secret && css({ flex: '1', minH: 0, overflow: 'hidden' })
							)}
						>
							<div
								class={note.secret
									? css({
											filter: 'blur(4px)',
											userSelect: 'none',
											h: 'full',
											overflow: 'hidden',
											px: 'md',
											pb: 'md',
											pt: !note.title ? 'sm' : 0
										})
									: undefined}
								data-secret-content={note.secret ? '' : undefined}
							>
								<NoteBodyDisplay {note} />
							</div>
							{#if note.secret}
								<div
									class={cx(card.hazeOverlay, css({ pointerEvents: 'none', zIndex: 10 }))}
									data-secret-overlay
									aria-hidden="true"
								>
									<Lock
										class={css({
											w: '1.5rem',
											h: '1.5rem',
											color: 'scrapscache.textMuted',
											filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.35))'
										})}
									/>
								</div>
							{/if}
						</div>
					</div>
					<!-- Every press lands here, so links, photos, canvases and files can
					     never swallow a swipe or start a drag of their own. -->
					<div class={card.shield} data-card-shield aria-hidden="true"></div>
				</div>
			</div>

			<div class={cx(card.metaRow, noteSurface({ color: note.color }))} data-note-meta>
				<time datetime={new Date(activity.at).toISOString()} title={activity.detail}
					>{activity.label}</time
				>
			</div>
		</div>

		{#if labelsForNote.length}
			<!-- Gesture strip: when tags overflow, a sideways pan scrolls them instead of swiping the card. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class={cx(card.labelsRow, 'note-scrollbar-hidden')}
				data-card-hscroll
				onpointerdown={onLabelsPointerDown}
				onpointermove={onLabelsPointerMove}
				onpointerup={onLabelsPointerUp}
				onpointercancel={onLabelsPointerUp}
			>
				{#each labelsForNote as label (label.id)}
					<span class={badge()}>
						{label.name}
					</span>
				{/each}
			</div>
		{/if}

		<NoteQuickActions {note} bind:open={hazeActive} />
	</div>
</div>
