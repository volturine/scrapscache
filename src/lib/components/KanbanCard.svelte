<script lang="ts">
	import { kanbanDrag, type KanbanDropTarget } from '#lib/kanbanDrag.svelte.js';
	import type { Note } from '#lib/types.js';
	import KanbanCardBody from './KanbanCardBody.svelte';
	import NoteQuickActions from './NoteQuickActions.svelte';
	import { css } from 'styled-system/css';
	import { cardOpenControl } from '$panda/styles';

	let {
		note,
		columnId,
		index,
		onOpen,
		onDrop
	}: {
		note: Note;
		columnId: string;
		/** Slot this card occupies now, so a pick-up opens the gap where it stood. */
		index: number;
		onOpen: (id: string) => void;
		onDrop: (noteId: string, columnId: string, target: KanbanDropTarget | null) => void;
	} = $props();

	let card = $state<HTMLElement | null>(null);
	let openButton = $state<HTMLButtonElement | null>(null);
	let quickActionsOpen = $state(false);

	function press(event: PointerEvent) {
		if (!card) return;
		kanbanDrag.press(event, { noteId: note.id, columnId, card, index, onDrop });
	}

	function open() {
		// Releasing a drag still raises a click; that one must not open the note.
		if (kanbanDrag.suppressedClick) return;
		// The open control holds focus while the note is open, so closing it returns here.
		openButton?.focus({ preventScroll: true });
		onOpen(note.id);
	}

	function showQuickActions(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		quickActionsOpen = true;
	}
</script>

<!-- A press anywhere on the card opens or drags it; the open button is the keyboard and
     assistive-technology control, a sibling of the quick actions. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article
	bind:this={card}
	class={css({
		position: 'relative',
		cursor: 'grab',
		rounded: 'card',
		transition: 'box-shadow 150ms ease, transform 150ms ease',
		_hoverable: { boxShadow: 'md', transform: 'translateY(-1px)' },
		_active: { cursor: 'grabbing' }
	})}
	onpointerdown={press}
	ondragstart={(event) => event.preventDefault()}
	onclick={open}
	oncontextmenu={showQuickActions}
>
	<KanbanCardBody {note} shield />
	<button
		bind:this={openButton}
		type="button"
		class={cardOpenControl({ ring: 'outside' })}
		aria-label={`Open ${note.title || 'untitled note'}`}
		data-card-open
	></button>
	<NoteQuickActions {note} bind:open={quickActionsOpen} />
</article>
