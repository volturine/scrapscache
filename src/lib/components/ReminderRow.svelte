<script lang="ts">
	import { cx } from 'styled-system/css';
	import { badge, noteSurface } from 'styled-system/recipes';
	import { cardOpenControl, iconSizeXs, reminderAgendaStyles as styles } from '$panda/styles';
	import { appClock } from '#lib/appClock.svelte.js';
	import {
		agendaPreview,
		agendaTime,
		type AgendaEntry,
		type AgendaGroupId
	} from '#lib/reminderAgenda.js';
	import { reminderPreview } from '#lib/reminderNotify.js';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { Repeat } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	let {
		entry,
		group,
		multiDay = false,
		onOpen,
		actions
	}: {
		entry: AgendaEntry;
		group: AgendaGroupId;
		/** The picked days span more than one, so a time names its weekday. */
		multiDay?: boolean;
		onOpen: (id: string) => void;
		/** Controls at the end of the row; a press on them is theirs, not the row's. */
		actions?: Snippet;
	} = $props();

	const note = $derived(entry.note);
	const time = $derived(agendaTime(entry, group, appClock.now, multiDay));
	/** The title, or the first line standing in for one. */
	const title = $derived(reminderPreview(note));
	const preview = $derived(note.title.trim() ? agendaPreview(note) : '');
	const labels = $derived(
		note.labels.flatMap((id) => {
			const label = notesStore.labelsById.get(id);
			return label ? [label] : [];
		})
	);
	const openLabel = $derived.by(() => {
		const kind = time.repeating
			? 'repeating reminder'
			: time.overdue
				? 'overdue reminder'
				: 'reminder';
		return `Open ${title}, ${kind} ${time.time}${time.detail ? `, ${time.detail.toLowerCase()}` : ''}`;
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<li class={styles.row} data-reminder-row onclick={() => onOpen(note.id)}>
	<button type="button" class={cardOpenControl} aria-label={openLabel}></button>
	<span class={cx(styles.dot, noteSurface({ color: note.color }))} aria-hidden="true"></span>
	<span class={cx(styles.time, time.overdue && styles.overdue)} aria-hidden="true">
		{time.time}
		{#if time.detail}
			<span class={cx(styles.detail, time.overdue && styles.overdue)}>
				{#if time.repeating}<Repeat class={iconSizeXs} aria-hidden="true" />{/if}
				{time.detail}
			</span>
		{/if}
	</span>
	<span class={styles.main}>
		<span class={styles.title}>{title}</span>
		<span class={cx(styles.timeLine, time.overdue && styles.overdue)} aria-hidden="true">
			{time.detail ? `${time.time} · ${time.detail}` : time.time}
		</span>
		{#if preview}
			<span class={styles.preview}>{preview}</span>
		{/if}
		{#if labels.length > 0}
			<span class={styles.labels}>
				{#each labels as label (label.id)}
					<span class={badge()}>{label.name}</span>
				{/each}
			</span>
		{/if}
	</span>
	{#if actions}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<span class={styles.actions} onclick={(event) => event.stopPropagation()}>
			{@render actions()}
		</span>
	{/if}
</li>
