<script lang="ts">
	import NotesFeed from '$lib/components/NotesFeed.svelte';
	import ReminderCalendar from '$lib/components/ReminderCalendar.svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { useEditorActions } from '$lib/editorContext';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { AlarmClock } from '@lucide/svelte';
	import { dayKey } from '$lib/utils';
	import { notesShellClass } from '$lib/notesShell';
	import { MediaQuery } from 'svelte/reactivity';
	import { sva } from 'styled-system/css';
	import { viewPage } from 'styled-system/recipes';

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
		const to = sel.to ?? sel.from;
		return searched.filter((n) => {
			if (n.reminder == null) return false;
			const key = dayKey(n.reminder);
			return key >= sel.from && key <= to;
		});
	});
	const embedCalendar = $derived(uiStore.layout === 'grid' && !compact.current);
	const emptyDescription = $derived(
		reminders.length === 0
			? 'Create a note, then add a reminder when you need to return to it.'
			: uiStore.reminderFilter || uiStore.search
				? 'No reminders match the current filters.'
				: 'Create a note, then add a reminder when you need to return to it.'
	);
	const styles = sva({
		slots: ['embedded', 'empty', 'calendar', 'feed'],
		base: {
			embedded: { position: 'relative' },
			empty: {
				display: 'flex',
				justifyContent: 'center',
				px: '1rem',
				py: '2.5rem',
				md: {
					position: 'absolute',
					insetY: 0,
					right: 0,
					left: 'min(32rem, 58%)',
					alignItems: 'center',
					py: 0
				}
			},
			calendar: { w: 'full' },
			feed: { mt: '1rem' }
		}
	})();
</script>

<div class={viewPage()}>
	{#if embedCalendar}
		<div class={styles.embedded}>
			<NotesFeed notes={visible} onOpen={openEditor}>
				{#snippet leading()}
					<ReminderCalendar notes={reminders} bind:selected={uiStore.reminderFilter} />
				{/snippet}
			</NotesFeed>
			{#if visible.length === 0}
				<div class={styles.empty}>
					<EmptyState icon={AlarmClock} description={emptyDescription} />
				</div>
			{/if}
		</div>
	{:else}
		<div class={uiStore.layout === 'list' ? notesShellClass() : styles.calendar}>
			<ReminderCalendar notes={reminders} bind:selected={uiStore.reminderFilter} />
		</div>
		<div class={styles.feed}>
			{#if visible.length === 0}
				<EmptyState icon={AlarmClock} description={emptyDescription} />
			{:else}
				<NotesFeed notes={visible} onOpen={openEditor} />
			{/if}
		</div>
	{/if}
</div>
