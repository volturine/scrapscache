<script lang="ts">
	import { iconSizeXs as icon, reminderRoot, truncate as text } from '$panda/styles';
	import { appClock } from '$lib/appClock.svelte';
	import { formatReminder, isReminderOverdue } from '$lib/utils';
	import { AlarmClock } from '@lucide/svelte';

	let {
		reminder,
		variant = 'strip'
	}: {
		reminder: number;
		variant?: 'strip' | 'chip' | 'inline';
	} = $props();

	const overdue = $derived(isReminderOverdue(reminder, appClock.now));
	const label = $derived(formatReminder(reminder, appClock.now));
	const aria = $derived(overdue ? `Overdue reminder, ${label}` : `Reminder, ${label}`);
</script>

<span class={reminderRoot({ variant, overdue })} aria-label={aria}>
	<AlarmClock class={icon} aria-hidden="true" />
	<span class={text}>
		{label}
	</span>
</span>
