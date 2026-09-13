<script lang="ts">
	import { appClock } from '$lib/appClock.svelte';
	import { formatReminder, isReminderOverdue } from '$lib/utils';
	import { AlarmClock } from '@lucide/svelte';
	import { css, cva } from 'styled-system/css';
	import { truncate } from '$panda/styles';

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

	const reminderRoot = cva({
		base: {
			display: 'inline-flex',
			alignItems: 'center',
			gap: '2xs',
			textStyle: 'caption'
		},
		variants: {
			variant: {
				strip: { w: 'full', borderTopRadius: 'lg', px: 'md', py: '2xs' },
				chip: { maxW: 'full', rounded: 'pill', px: 'list', py: '2xs' },
				inline: {}
			},
			overdue: {
				true: {}
			}
		},
		compoundVariants: [
			{
				variant: 'strip',
				overdue: false,
				css: { bg: 'scrapscache.surfaceSubtle', color: 'scrapscache.textMuted' }
			},
			{
				variant: 'strip',
				overdue: true,
				css: {
					bg: 'scrapscache.overdueStrong',
					fontWeight: 'interactive',
					color: 'scrapscache.mediaText'
				}
			},
			{
				variant: 'chip',
				overdue: false,
				css: { bg: 'scrapscache.interactiveActive', color: 'scrapscache.textMuted' }
			},
			{
				variant: 'chip',
				overdue: true,
				css: {
					bg: 'scrapscache.overdueStrong',
					fontWeight: 'interactive',
					color: 'scrapscache.mediaText'
				}
			},
			{
				variant: 'inline',
				overdue: false,
				css: { color: 'scrapscache.textMuted' }
			},
			{
				variant: 'inline',
				overdue: true,
				css: { fontWeight: 'interactive', color: 'scrapscache.overdue' }
			}
		]
	});
	const icon = css({ w: '0.875rem', h: '0.875rem', flexShrink: 0 });
</script>

<span class={reminderRoot({ variant, overdue })} aria-label={aria}>
	<AlarmClock class={icon} aria-hidden="true" />
	<span class={truncate}>
		{label}
	</span>
</span>
