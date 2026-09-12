<script lang="ts">
	import { appClock } from '$lib/appClock.svelte';
	import { formatReminder, isReminderOverdue } from '$lib/utils';
	import { AlarmClock } from '@lucide/svelte';
	import { cva, css } from 'styled-system/css';

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

	const reminderStyle = cva({
		base: {
			display: 'inline-flex',
			alignItems: 'center',
			gap: '0.25rem',
			fontSize: 'xs'
		},
		variants: {
			variant: {
				strip: {
					w: 'full',
					borderTopRadius: 'lg',
					px: '0.75rem',
					py: '0.25rem'
				},
				chip: {
					maxW: 'full',
					rounded: 'full',
					px: '0.625rem',
					py: '0.25rem'
				},
				inline: {}
			},
			overdue: {
				true: {},
				false: {}
			}
		},
		compoundVariants: [
			{
				variant: 'strip',
				overdue: false,
				css: {
					bg: 'scrapscache.surfaceSubtle',
					color: 'scrapscache.textMuted'
				}
			},
			{
				variant: 'strip',
				overdue: true,
				css: {
					bg: 'scrapscache.overdueStrong',
					fontWeight: 'medium',
					color: 'white'
				}
			},
			{
				variant: 'chip',
				overdue: false,
				css: {
					bg: 'scrapscache.interactiveActive',
					color: 'scrapscache.textMuted'
				}
			},
			{
				variant: 'chip',
				overdue: true,
				css: {
					bg: 'scrapscache.overdueStrong',
					fontWeight: 'medium',
					color: 'white'
				}
			},
			{
				variant: 'inline',
				overdue: false,
				css: {
					color: 'scrapscache.textMuted'
				}
			},
			{
				variant: 'inline',
				overdue: true,
				css: {
					fontWeight: 'medium',
					color: 'scrapscache.overdue'
				}
			}
		],
		defaultVariants: {
			variant: 'strip',
			overdue: false
		}
	});
</script>

<span class={reminderStyle({ variant, overdue })} aria-label={aria}>
	<AlarmClock class={css({ w: '0.875rem', h: '0.875rem', flexShrink: 0 })} aria-hidden="true" />
	<span
		class={css({
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			whiteSpace: 'nowrap'
		})}
	>
		{label}
	</span>
</span>
