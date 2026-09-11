<script lang="ts">
	// The look of a Kanban card, with no interaction of its own. The board renders
	// it twice: once in the column, once inside the ghost that follows a drag, so
	// the card the user carries is the card they see land.
	import { notesStore } from '$lib/stores/notes.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { NOTE_COLORS, NOTE_DARK_COLORS, type Note, type NoteColor } from '$lib/types';
	import NoteBodyDisplay from './NoteBodyDisplay.svelte';
	import ReminderLabel from './ReminderLabel.svelte';
	import { css } from 'styled-system/css';
	import { noteCard } from 'styled-system/recipes';

	let { note, shield = false }: { note: Note; shield?: boolean } = $props();

	const labelsForNote = $derived(
		note.labels
			.map((id) => notesStore.labelsById.get(id))
			.filter((label): label is NonNullable<typeof label> => !!label)
	);

	function background(color: NoteColor): string {
		return uiStore.effectiveDark ? NOTE_DARK_COLORS[color] : NOTE_COLORS[color];
	}

	// The board card keeps its own box (rounded-xl, no max height) and a fixed
	// scroll window; the shared noteCard recipe covers the pieces that match.
	const card = noteCard();

	const cardBoxClass = css({
		overflow: 'hidden',
		rounded: 'xl',
		borderWidth: '1px',
		borderColor: { base: 'black/5', _dark: 'white/10' },
		boxShadow: 'sm'
	});

	const bodyScrollClass = css({
		position: 'relative',
		maxH: '240px',
		overflow: 'hidden'
	});

	const padClass = css({
		p: '0.75rem'
	});

	const reminderWrapClass = css({
		mb: '0.25rem'
	});
</script>

<div class={`kanban-card ${cardBoxClass}`} style="background-color: {background(note.color)};">
	<div class={bodyScrollClass}>
		<div class={padClass}>
			{#if note.reminder != null}
				<div class={reminderWrapClass}>
					<ReminderLabel reminder={note.reminder} variant="inline" />
				</div>
			{/if}
			{#if note.title}
				<h3 class={`break-words ${card.title}`}>
					{note.title}
				</h3>
			{/if}
			<NoteBodyDisplay {note} />
		</div>
		{#if shield}
			<!-- Every press lands here, so links, photos, canvases and files can
			     never swallow a drag or start one of their own. -->
			<div class={card.shield} data-card-shield aria-hidden="true"></div>
		{/if}
	</div>

	{#if labelsForNote.length}
		<div class={card.labelsRow}>
			{#each labelsForNote as label (label.id)}
				<span class={card.labelPill}>{label.name}</span>
			{/each}
		</div>
	{/if}
</div>
