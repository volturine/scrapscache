<script lang="ts">
	import ReminderCalendar from '#lib/components/ReminderCalendar.svelte';
	import ReminderRow from '#lib/components/ReminderRow.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import { appClock } from '#lib/appClock.svelte.js';
	import { agendaGroups, pickedDayGroups } from '#lib/reminderAgenda.js';
	import { AlarmClock } from '@lucide/svelte';
	import { cx } from 'styled-system/css';
	import { reminderAgendaStyles as styles, viewHeading, viewPage } from '$panda/styles';

	const { openNote } = useEditorActions();
	const reminders = $derived(notesStore.notesWithReminders);

	const searched = $derived(
		uiStore.search ? notesStore.search(uiStore.search, reminders) : reminders
	);
	const picked = $derived(uiStore.reminderFilter);
	const multiDay = $derived(picked != null && picked.to != null && picked.to !== picked.from);
	/** Picked days are their own agenda; otherwise what is due, soonest first. */
	const groups = $derived(
		picked ? pickedDayGroups(searched, picked, appClock.now) : agendaGroups(searched, appClock.now)
	);
	const nothingFound = $derived(groups.every((group) => group.entries.length === 0));
	const emptyDescription = $derived(
		reminders.length === 0
			? 'Create a note, then add a reminder when you need to return to it.'
			: 'No reminders match the current filters.'
	);
</script>

<div class={viewPage}>
	<h1 class={viewHeading}>Reminders</h1>
	<div class={styles.split} data-reminder-split>
		<div class={styles.calendar}>
			<ReminderCalendar notes={reminders} bind:selected={uiStore.reminderFilter} />
		</div>
		<div class={styles.agenda}>
			{#if reminders.length === 0 || (nothingFound && !picked)}
				<EmptyState icon={AlarmClock} description={emptyDescription} />
			{:else}
				{#each groups as group (group.id)}
					{@const overdue = group.id === 'overdue'}
					<section class={styles.group} aria-labelledby={`agenda-${group.id}`}>
						<div class={styles.heading}>
							<h2
								id={`agenda-${group.id}`}
								class={cx(styles.headingLabel, overdue && styles.headingOverdue)}
							>
								{group.label}
							</h2>
							<span class={cx(styles.headingCount, overdue && styles.headingOverdue)}>
								{group.entries.length}
							</span>
							{#if group.date}
								<span class={styles.headingDate}>{group.date}</span>
							{/if}
						</div>
						{#if group.entries.length === 0}
							<p class={styles.empty}>
								{multiDay ? 'Nothing on these days.' : 'Nothing on this day.'}
							</p>
						{:else}
							<ul class={styles.list}>
								{#each group.entries as entry (`${entry.note.id}:${entry.at}`)}
									<ReminderRow {entry} group={group.id} {multiDay} onOpen={openNote} />
								{/each}
							</ul>
						{/if}
					</section>
				{/each}
			{/if}
		</div>
	</div>
</div>
