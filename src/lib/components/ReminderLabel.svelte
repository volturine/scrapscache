<script lang="ts">
	import { iconSizeXs as icon, reminderRoot, truncate as text } from '$panda/styles';
	import { cx } from 'styled-system/css';
	import { appClock } from '#lib/appClock.svelte.js';
	import type { ReminderRepeat } from '#lib/model/index.js';
	import { reminderWords } from '#lib/utils.js';
	import { AlarmClock, Repeat } from '@lucide/svelte';

	let {
		reminder,
		repeat = null,
		variant = 'strip',
		class: className
	}: {
		/** The reminder's first time. */
		reminder: number;
		repeat?: ReminderRepeat | null;
		variant?: 'strip' | 'chip' | 'inline';
		class?: string;
	} = $props();

	const words = $derived(reminderWords({ reminder, repeat }, appClock.now));
</script>

<span
	class={cx(reminderRoot({ variant, overdue: words?.overdue ?? false }), className)}
	aria-label={words?.aria}
>
	{#if repeat}
		<Repeat class={icon} aria-hidden="true" />
	{:else}
		<AlarmClock class={icon} aria-hidden="true" />
	{/if}
	<span class={text}>
		{words?.text}
	</span>
</span>
