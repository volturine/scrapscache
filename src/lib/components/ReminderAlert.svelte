<script lang="ts">
	import { fly } from 'svelte/transition';
	import { AlarmClock, X } from '@lucide/svelte';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import { formatReminder } from '$lib/utils';
	import { css } from 'styled-system/css';
	import { iconButton } from 'styled-system/recipes';

	const alerts = $derived(reminderStore.alerts);

	const root = css({
		pointerEvents: 'none',
		position: 'fixed',
		insetX: 0,
		zIndex: 70,
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: 'sm',
		px: 'md'
	});
	const card = css({
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
	});
	const icon = css({
		mt: '3xs',
		w: '1.25rem',
		h: '1.25rem',
		flexShrink: 0,
		color: 'scrapscache.accent'
	});
	const content = css({ minW: 0, flex: '1', textAlign: 'left', cursor: 'pointer' });
	const title = css({
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		textStyle: 'bodyStrong',
		color: 'scrapscache.text'
	});
	const subtitle = css({ textStyle: 'caption' });
	const dismissIcon = css({ w: '1rem', h: '1rem' });
</script>

{#if alerts.length > 0}
	<div
		class={root}
		style="top: max(0.75rem, calc(env(safe-area-inset-top, 0px) + 0.35rem))"
		role="region"
		aria-label="Due reminders"
	>
		{#each alerts as alert (alert.wakeId)}
			<div class={card} role="alert" transition:fly={{ y: -16, duration: 180 }}>
				<AlarmClock class={icon} aria-hidden="true" />
				<button type="button" class={content} onclick={() => reminderStore.open(alert.noteId)}>
					<div class={title}>
						{alert.title}
					</div>
					<div class={subtitle}>
						{formatReminder(alert.reminder)}
					</div>
				</button>
				<button
					type="button"
					class={iconButton({ variant: 'ghost', size: 'compact' })}
					aria-label="Dismiss reminder"
					onclick={() => reminderStore.dismiss(alert.noteId)}
				>
					<X class={dismissIcon} aria-hidden="true" />
				</button>
			</div>
		{/each}
	</div>
{/if}
