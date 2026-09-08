<script lang="ts">
	import ReminderCalendar, { type ReminderDayFilter } from './ReminderCalendar.svelte';
	import type { Note } from '$lib/types';

	let { notes = [] }: { notes?: Note[] } = $props();
	let selected = $state<ReminderDayFilter | null>(null);

	export function getSelected() {
		return selected;
	}
	export function setSelected(val: ReminderDayFilter | null) {
		selected = val;
	}
</script>

<ReminderCalendar {notes} bind:selected />
<div data-testid="selected-json">{JSON.stringify(selected)}</div>
