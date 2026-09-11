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

	let { note, shield = false }: { note: Note; shield?: boolean } = $props();

	const labelsForNote = $derived(
		note.labels
			.map((id) => notesStore.labelsById.get(id))
			.filter((label): label is NonNullable<typeof label> => !!label)
	);

	function background(color: NoteColor): string {
		return uiStore.effectiveDark ? NOTE_DARK_COLORS[color] : NOTE_COLORS[color];
	}

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

	const titleClass = css({
		mb: '0.25rem',
		wordBreak: 'break-word',
		fontSize: '15px',
		fontWeight: '600',
		lineHeight: 'snug',
		letterSpacing: 'tight',
		color: 'scrapscache.text'
	});

	const shieldClass = css({
		position: 'absolute',
		inset: 0
	});

	const labelsRowClass = css({
		display: 'flex',
		flexWrap: 'wrap',
		gap: '0.25rem',
		px: '0.75rem',
		pb: '0.75rem',
		pt: '0.5rem'
	});

	const labelPillClass = css({
		rounded: 'sm',
		bg: { base: 'black/5', _dark: 'white/10' },
		px: '0.375rem',
		py: '0.125rem',
		fontSize: '10px',
		fontWeight: 'medium',
		color: 'scrapscache.textMuted'
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
				<h3 class={`break-words ${titleClass}`}>
					{note.title}
				</h3>
			{/if}
			<NoteBodyDisplay {note} />
		</div>
		{#if shield}
			<!-- Every press lands here, so links, photos, canvases and files can
			     never swallow a drag or start one of their own. -->
			<div class={shieldClass} data-card-shield aria-hidden="true"></div>
		{/if}
	</div>

	{#if labelsForNote.length}
		<div class={labelsRowClass}>
			{#each labelsForNote as label (label.id)}
				<span class={labelPillClass}>{label.name}</span>
			{/each}
		</div>
	{/if}
</div>
