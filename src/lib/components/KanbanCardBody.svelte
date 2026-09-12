<script lang="ts">
	// The look of a Kanban card, with no interaction of its own. The board renders
	// it twice: once in the column, once inside the ghost that follows a drag, so
	// the card the user carries is the card they see land.
	import { notesStore } from '$lib/stores/notes.svelte';
	import type { Note } from '$lib/types';
	import NoteBodyDisplay from './NoteBodyDisplay.svelte';
	import ReminderLabel from './ReminderLabel.svelte';
	import { cx, sva } from 'styled-system/css';
	import { noteCard, noteSurface } from 'styled-system/recipes';

	let { note, shield = false }: { note: Note; shield?: boolean } = $props();

	const labelsForNote = $derived(
		note.labels
			.map((id) => notesStore.labelsById.get(id))
			.filter((label): label is NonNullable<typeof label> => !!label)
	);

	// The board card keeps its own box (rounded-xl, no max height) and a fixed
	// scroll window; the shared noteCard recipe covers the pieces that match.
	const card = noteCard();
	const kanbanCard = sva({
		slots: ['root', 'viewport', 'content', 'reminder'],
		base: {
			root: {
				overflow: 'hidden',
				rounded: 'xl',
				borderWidth: '1px',
				borderColor: 'scrapscache.borderFaint',
				boxShadow: 'sm'
			},
			viewport: { position: 'relative', maxH: '240px', overflow: 'hidden' },
			content: { p: '0.75rem' },
			reminder: { mb: '0.25rem' }
		}
	});
	const styles = kanbanCard();
</script>

<div class={cx('kanban-card', noteSurface({ color: note.color }), styles.root)}>
	<div class={styles.viewport}>
		<div class={styles.content}>
			{#if note.reminder != null}
				<div class={styles.reminder}>
					<ReminderLabel reminder={note.reminder} variant="inline" />
				</div>
			{/if}
			{#if note.title}
				<h3 class={card.title}>
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
