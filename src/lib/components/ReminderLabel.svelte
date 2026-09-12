<script lang="ts">
	import { appClock } from '$lib/appClock.svelte';
	import { formatReminder, isReminderOverdue } from '$lib/utils';
	import { AlarmClock } from '@lucide/svelte';
	import { sva } from 'styled-system/css';

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

	const reminderStyle = sva({
		slots: ['root', 'icon', 'text'],
		base: {
			root: {
				display: 'inline-flex',
				alignItems: 'center',
				gap: '0.25rem',
				fontSize: 'xs'
			},
			icon: { w: '0.875rem', h: '0.875rem', flexShrink: 0 },
			text: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
		},
		variants: {
			variant: {
				strip: {
					root: {
						w: 'full',
						borderTopRadius: 'lg',
						px: '0.75rem',
						py: '0.25rem'
					}
				},
				chip: {
					root: {
						maxW: 'full',
						rounded: 'full',
						px: '0.625rem',
						py: '0.25rem'
					}
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
					root: {
						bg: 'scrapscache.surfaceSubtle',
						color: 'scrapscache.textMuted'
					}
				}
			},
			{
				variant: 'strip',
				overdue: true,
				css: {
					root: {
						bg: 'scrapscache.overdueStrong',
						fontWeight: 'medium',
						color: 'scrapscache.mediaText'
					}
				}
			},
			{
				variant: 'chip',
				overdue: false,
				css: {
					root: {
						bg: 'scrapscache.interactiveActive',
						color: 'scrapscache.textMuted'
					}
				}
			},
			{
				variant: 'chip',
				overdue: true,
				css: {
					root: {
						bg: 'scrapscache.overdueStrong',
						fontWeight: 'medium',
						color: 'scrapscache.mediaText'
					}
				}
			},
			{
				variant: 'inline',
				overdue: false,
				css: {
					root: {
						color: 'scrapscache.textMuted'
					}
				}
			},
			{
				variant: 'inline',
				overdue: true,
				css: {
					root: {
						fontWeight: 'medium',
						color: 'scrapscache.overdue'
					}
				}
			}
		],
		defaultVariants: {
			variant: 'strip',
			overdue: false
		}
	});
	const styles = $derived(reminderStyle({ variant, overdue }));
</script>

<span class={styles.root} aria-label={aria}>
	<AlarmClock class={styles.icon} aria-hidden="true" />
	<span class={styles.text}>
		{label}
	</span>
</span>
