<script lang="ts">
	import { fly } from 'svelte/transition';
	import { AlarmClock, X } from '@lucide/svelte';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import { formatReminder } from '$lib/utils';
	import { sva } from 'styled-system/css';
	import { iconButton } from 'styled-system/recipes';

	const alerts = $derived(reminderStore.alerts);

	const slot = sva({
		slots: ['root', 'card', 'icon', 'content', 'title', 'subtitle', 'dismissIcon'],
		base: {
			root: {
				pointerEvents: 'none',
				position: 'fixed',
				insetX: 0,
				zIndex: 70,
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				gap: 'sm',
				px: 'md'
			},
			card: {
				pointerEvents: 'auto',
				display: 'flex',
				w: 'full',
				maxW: '28rem',
				alignItems: 'flex-start',
				gap: 'md',
				rounded: 'sheet',
				borderWidth: 'hairline',
				borderColor: 'scrapscache.border',
				bg: 'scrapscache.surface',
				px: 'md',
				py: 'md',
				boxShadow: '2xl'
			},
			icon: {
				mt: '3xs',
				w: '1.25rem',
				h: '1.25rem',
				flexShrink: 0,
				color: 'scrapscache.accent'
			},
			content: {
				minW: 0,
				flex: '1',
				textAlign: 'left',
				cursor: 'pointer'
			},
			title: {
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				whiteSpace: 'nowrap',
				textStyle: 'bodyStrong',
				color: 'scrapscache.text'
			},
			subtitle: {
				textStyle: 'caption'
			},
			dismissIcon: { w: '1rem', h: '1rem' }
		}
	})();
</script>

{#if alerts.length > 0}
	<div
		class={slot.root}
		style="top: max(0.75rem, calc(env(safe-area-inset-top, 0px) + 0.35rem))"
		role="region"
		aria-label="Due reminders"
	>
		{#each alerts as alert (alert.wakeId)}
			<div class={slot.card} role="alert" transition:fly={{ y: -16, duration: 180 }}>
				<AlarmClock class={slot.icon} aria-hidden="true" />
				<button type="button" class={slot.content} onclick={() => reminderStore.open(alert.noteId)}>
					<div class={slot.title}>
						{alert.title}
					</div>
					<div class={slot.subtitle}>
						{formatReminder(alert.reminder)}
					</div>
				</button>
				<button
					type="button"
					class={iconButton({ variant: 'ghost', size: 'compact' })}
					aria-label="Dismiss reminder"
					onclick={() => reminderStore.dismiss(alert.noteId)}
				>
					<X class={slot.dismissIcon} aria-hidden="true" />
				</button>
			</div>
		{/each}
	</div>
{/if}
