<script lang="ts">
	import { kanbanDrag, type KanbanDropTarget } from '$lib/kanbanDrag.svelte';
	import type { Note } from '$lib/types';
	import { activateOnKeyboard } from '$lib/utils';
	import KanbanCardBody from './KanbanCardBody.svelte';
	import NoteQuickActions from './NoteQuickActions.svelte';
	import { css } from 'styled-system/css';

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
	let quickActionsOpen = $state(false);

	function press(event: PointerEvent) {
		if (!card) return;
		kanbanDrag.press(event, { noteId: note.id, columnId, card, index, onDrop });
	}

	function open() {
		// Releasing a drag still raises a click; that one must not open the note.
		if (kanbanDrag.suppressedClick) return;
		onOpen(note.id);
	}

	function showQuickActions(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		quickActionsOpen = true;
	}

	function handleKeydown(event: KeyboardEvent) {
		// The quick actions close themselves on Escape; nothing else may open the note under them.
		if (quickActionsOpen) return;
		activateOnKeyboard(event, () => onOpen(note.id));
	}
</script>

<div
	bind:this={card}
	role="button"
	tabindex="0"
	class={css({
		position: 'relative',
		cursor: 'grab',
		rounded: 'dialog',
		_active: { cursor: 'grabbing' }
	})}
	onpointerdown={press}
	ondragstart={(event) => event.preventDefault()}
	onclick={open}
	oncontextmenu={showQuickActions}
	onkeydown={handleKeydown}
	aria-label={`Open ${note.title || 'untitled note'}`}
>
	<KanbanCardBody {note} shield />
	<NoteQuickActions {note} bind:open={quickActionsOpen} />
</div>
