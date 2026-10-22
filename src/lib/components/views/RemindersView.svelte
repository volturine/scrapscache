<script lang="ts">
	import NotesFeed from '#lib/components/NotesFeed.svelte';
	import ReminderCalendar from '#lib/components/ReminderCalendar.svelte';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { AlarmClock } from '@lucide/svelte';
	import { dayKeySpan } from '#lib/utils.js';
	import { reminderTimesBetween } from '#lib/model/index.js';
	import { MediaQuery } from 'svelte/reactivity';
	import { css } from 'styled-system/css';
	import { notesShell, viewHeading, viewPage } from '$panda/styles';

	const { openNote: openEditor } = useEditorActions();
	const reminders = $derived(notesStore.notesWithReminders);

	/** Phone widths keep the calendar full-width; wider grids pack it alongside note cards. */
	const compact = new MediaQuery('max-width: 767px', true);

	const searched = $derived(
		uiStore.search ? notesStore.search(uiStore.search, reminders) : reminders
	);
	const visible = $derived.by(() => {
		const sel = uiStore.reminderFilter;
		if (!sel) return searched;
		// A repeating reminder is found on every day it comes.
		const { start, end } = dayKeySpan(sel.from, sel.to ?? sel.from);
		return searched.filter((n) => reminderTimesBetween(n, start, end, 1).length > 0);
	});
	const embedCalendar = $derived(uiStore.layout === 'grid' && !compact.current);
	const emptyDescription = $derived(
		reminders.length === 0
			? 'Create a note, then add a reminder when you need to return to it.'
			: uiStore.reminderFilter || uiStore.search
				? 'No reminders match the current filters.'
				: 'Create a note, then add a reminder when you need to return to it.'
	);
</script>

<div class={viewPage}>
	<h1 class={viewHeading}>Reminders</h1>
	{#if embedCalendar}
		<div class={css({ position: 'relative' })}>
			<NotesFeed notes={visible} onOpen={openEditor}>
				{#snippet leading()}
					<ReminderCalendar notes={reminders} bind:selected={uiStore.reminderFilter} />
				{/snippet}
			</NotesFeed>
			{#if visible.length === 0}
				<div
					class={css({
						display: 'flex',
						justifyContent: 'center',
						px: 'lg',
						py: '3xl',
						md: {
							position: 'absolute',
							insetY: 0,
							right: 0,
							left: 'min(32rem, 58%)',
							alignItems: 'center',
							py: 0
						}
					})}
				>
					<EmptyState icon={AlarmClock} description={emptyDescription} />
				</div>
			{/if}
		</div>
	{:else}
		<div class={uiStore.layout === 'list' ? notesShell('list') : css({ w: 'full' })}>
			<ReminderCalendar notes={reminders} bind:selected={uiStore.reminderFilter} />
		</div>
		<div class={css({ mt: 'lg' })}>
			{#if visible.length === 0}
				<EmptyState icon={AlarmClock} description={emptyDescription} />
			{:else}
				<NotesFeed notes={visible} onOpen={openEditor} />
			{/if}
		</div>
	{/if}
</div>
