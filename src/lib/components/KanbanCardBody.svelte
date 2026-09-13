<script lang="ts">
	// The look of a Kanban card, with no interaction of its own. The board renders
	// it twice: once in the column, once inside the ghost that follows a drag, so
	// the card the user carries is the card they see land.
	import { notesStore } from '$lib/stores/notes.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { NOTE_COLORS, NOTE_DARK_COLORS, type Note, type NoteColor } from '$lib/types';
	import NoteBodyDisplay from './NoteBodyDisplay.svelte';
	import ReminderLabel from './ReminderLabel.svelte';
	import { Lock } from '@lucide/svelte';

	let { note, shield = false }: { note: Note; shield?: boolean } = $props();

	const labelsForNote = $derived(
		note.labels
			.map((id) => notesStore.labelsById.get(id))
			.filter((label): label is NonNullable<typeof label> => !!label)
	);

	function background(color: NoteColor): string {
		return uiStore.effectiveDark ? NOTE_DARK_COLORS[color] : NOTE_COLORS[color];
	}
</script>

<div
	class="kanban-card relative overflow-hidden rounded-xl border border-black/5 shadow-sm dark:border-white/10"
	style="background-color: {background(note.color)};"
>
	<div class="relative max-h-[240px] overflow-hidden">
		<div class="p-3" class:blur-sm={note.secret} class:select-none={note.secret}>
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
		{#if shield}
			<!-- Every press lands here, so links, photos, canvases and files can
			     never swallow a drag or start one of their own. -->
			<div class="absolute inset-0" data-card-shield aria-hidden="true"></div>
		{/if}
	</div>

	{#if note.secret}
		<div
			class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-black/5 backdrop-blur-md dark:bg-black/20"
			data-secret-overlay
			aria-hidden="true"
		>
			<Lock class="h-6 w-6 text-[var(--scrapscache-text-muted)] drop-shadow-sm" />
			<span
				class="text-xs font-medium tracking-wide text-[var(--scrapscache-text-muted)] drop-shadow-sm"
				>Secret note</span
			>
		</div>
	{/if}

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
