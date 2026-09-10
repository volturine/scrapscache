<script lang="ts">
	import { notesStore } from '$lib/stores/notes.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { NOTE_COLORS, NOTE_DARK_COLORS, type Note, type NoteColor } from '$lib/types';
	import { activateOnKeyboard } from '$lib/utils';
	import { PHONE_MEDIA } from '$lib/appViewport';
	import { isSidebarEdgeStart } from '$lib/sidebarSwipe';
	import NoteBodyDisplay from './NoteBodyDisplay.svelte';
	import ReminderLabel from './ReminderLabel.svelte';

	let {
		note,
		sourceColumnId,
		onOpen,
		onMove
	}: {
		note: Note;
		sourceColumnId: string;
		onOpen: (id: string) => void;
		onMove: (noteId: string, sourceColumnId: string, destinationColumnId: string) => void;
	} = $props();

	const labelsForNote = $derived(
		note.labels
			.map((id) => notesStore.labelsById.get(id))
			.filter((label): label is NonNullable<typeof label> => !!label)
	);

	function background(color: NoteColor): string {
		return uiStore.effectiveDark ? NOTE_DARK_COLORS[color] : NOTE_COLORS[color];
	}

	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let dragX = $state(0);
	let dragY = $state(0);
	let touchDragging = $state(false);
	let nativeDragging = $state(false);
	let suppressOpen = false;

	// Dragging shows a miniaturized note so the card reads as "picked up".
	const DRAG_SCALE = 0.8;
	const dragVisual = $derived(touchDragging || nativeDragging);
	// While a native drag carries the card, the browser snapshots it right after
	// the dragstart handler, so its transform must already be settled:
	// transition none during native drag, 120ms zoom in/out on touch.
	const dragTransition = $derived(
		touchDragging
			? 'transform 120ms ease'
			: nativeDragging
				? 'none'
				: 'left 120ms ease, top 120ms ease, transform 120ms ease, box-shadow 120ms ease'
	);

	function resetTouchDrag() {
		pointerId = null;
		touchDragging = false;
		dragX = 0;
		dragY = 0;
	}

	function onPointerDown(event: PointerEvent) {
		// Desktop gets the native HTML drag path; this path makes touch dragging work on iPhone.
		if (event.pointerType === 'mouse') return;
		if (window.matchMedia(PHONE_MEDIA).matches && isSidebarEdgeStart(event.clientX)) return;
		pointerId = event.pointerId;
		startX = event.clientX;
		startY = event.clientY;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		dragX = event.clientX - startX;
		dragY = event.clientY - startY;
		if (!touchDragging && Math.hypot(dragX, dragY) < 10) return;
		touchDragging = true;
		event.preventDefault();
	}

	function onPointerUp(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		if (touchDragging) {
			suppressOpen = true;
			// The dragged card sits under the finger, so it would win the hit test
			// and always resolve to its own column. Hide it from hit testing for
			// this lookup, then restore.
			const card = event.currentTarget as HTMLElement;
			card.style.pointerEvents = 'none';
			const target = document.elementFromPoint(event.clientX, event.clientY);
			card.style.pointerEvents = '';
			const destination =
				target instanceof Element
					? target.closest<HTMLElement>('[data-kanban-column]')?.dataset.kanbanColumn
					: undefined;
			if (destination) onMove(note.id, sourceColumnId, destination);
			setTimeout(() => {
				suppressOpen = false;
			}, 0);
		}
		resetTouchDrag();
	}
	function onNativeDragStart(event: DragEvent) {
		if (!event.dataTransfer) return;
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData(
			'application/x-scrapscache-kanban',
			JSON.stringify({ noteId: note.id, sourceColumnId })
		);
		// No custom drag image: the browser snapshots this card itself, already
		// scaled down by DRAG_SCALE below, so the preview is just the rounded
		// mini note — no opaque frames, padding or flatten-prone shadows — and
		// the OS adds its own lift shadow around it.
		nativeDragging = true;
		suppressOpen = true;
	}

	function onNativeDragEnd() {
		nativeDragging = false;
		setTimeout(() => {
			suppressOpen = false;
		}, 0);
	}

	function open() {
		if (suppressOpen) return;
		onOpen(note.id);
	}
</script>

<div
	role="button"
	tabindex="0"
	draggable="true"
	class="kanban-card relative cursor-grab overflow-hidden rounded-xl border border-black/5 shadow-sm active:cursor-grabbing dark:border-white/10 {dragVisual
		? 'z-20 opacity-90 shadow-xl'
		: ''}"
	style="background-color: {background(note.color)}; left: {touchDragging
		? dragX
		: 0}px; top: {touchDragging ? dragY : 0}px; transform: scale({dragVisual
		? DRAG_SCALE
		: 1}); transition: {dragTransition};"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={resetTouchDrag}
	ondragstart={onNativeDragStart}
	ondragend={onNativeDragEnd}
	onclick={open}
	onkeydown={(event) => activateOnKeyboard(event, () => onOpen(note.id))}
	aria-label={`Drag ${note.title || 'untitled note'} to another Kanban column`}
>
	<div class="scrollable max-h-[240px] overflow-x-hidden overflow-y-auto">
		<div class="relative">
			<div class="p-3">
				{#if note.reminder != null}
					<div class="mb-1">
						<ReminderLabel reminder={note.reminder} variant="inline" />
					</div>
				{/if}
				{#if note.title}
					<h3
						class="mb-1 break-words text-[15px] font-semibold leading-snug tracking-tight text-[var(--scrapscache-text)]"
					>
						{note.title}
					</h3>
				{/if}
				<NoteBodyDisplay {note} />
			</div>
			<!-- Every press lands here, so links, photos, canvases and files can
			     never swallow a drag or start one of their own. -->
			<div class="absolute inset-0" data-card-shield aria-hidden="true"></div>
		</div>
	</div>

	{#if labelsForNote.length}
		<div class="flex flex-wrap gap-1 px-3 pb-3 pt-2">
			{#each labelsForNote as label (label.id)}
				<span
					class="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-medium text-[var(--scrapscache-text-muted)] dark:bg-white/10"
					>{label.name}</span
				>
			{/each}
		</div>
	{/if}
</div>
