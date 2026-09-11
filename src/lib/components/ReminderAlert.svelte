<script lang="ts">
	import { fly } from 'svelte/transition';
	import { AlarmClock, X } from '@lucide/svelte';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import { formatReminder } from '$lib/utils';
	import { css } from 'styled-system/css';

	const alerts = $derived(reminderStore.alerts);

	const containerClass = css({
		pointerEvents: 'none',
		position: 'fixed',
		insetX: 0,
		zIndex: 70,
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: '0.5rem',
		px: '0.75rem'
	});

	const cardClass = css({
		pointerEvents: 'auto',
		display: 'flex',
		w: 'full',
		maxW: '28rem',
		alignItems: 'flex-start',
		gap: '0.75rem',
		rounded: '2xl',
		borderWidth: '1px',
		borderColor: 'scrapscache.border',
		bg: 'scrapscache.surface',
		px: '0.75rem',
		py: '0.75rem',
		boxShadow: '2xl'
	});

	const iconClass = css({
		mt: '0.125rem',
		w: '1.25rem',
		h: '1.25rem',
		flexShrink: 0,
		color: { base: 'blue.600', _dark: 'blue.400' }
	});

	const contentBtnClass = css({
		minW: 0,
		flex: '1',
		textAlign: 'left',
		cursor: 'pointer'
	});

	const titleClass = css({
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		fontSize: 'sm',
		fontWeight: '600',
		color: 'scrapscache.text'
	});

	const subtitleClass = css({
		fontSize: 'xs',
		color: 'scrapscache.textMuted'
	});

	const dismissBtnClass = css({
		w: '2rem',
		h: '2rem',
		flexShrink: 0,
		p: '0.375rem',
		cursor: 'pointer',
		rounded: 'full',
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		_hover: {
			bg: 'scrapscache.interactiveHover'
		}
	});

	const closeIconClass = css({
		w: '1rem',
		h: '1rem'
	});
</script>

{#if alerts.length > 0}
	<div
		class={containerClass}
		style="top: max(0.75rem, calc(env(safe-area-inset-top, 0px) + 0.35rem))"
		role="region"
		aria-label="Due reminders"
	>
		{#each alerts as alert (alert.wakeId)}
			<div class={cardClass} role="alert" transition:fly={{ y: -16, duration: 180 }}>
				<AlarmClock class={iconClass} aria-hidden="true" />
				<button
					type="button"
					class={contentBtnClass}
					onclick={() => reminderStore.open(alert.noteId)}
				>
					<div class={titleClass}>
						{alert.title}
					</div>
					<div class={subtitleClass}>
						{formatReminder(alert.reminder)}
					</div>
				</button>
				<button
					type="button"
					class={`icon-btn ${dismissBtnClass}`}
					aria-label="Dismiss reminder"
					onclick={() => reminderStore.dismiss(alert.noteId)}
				>
					<X class={closeIconClass} aria-hidden="true" />
				</button>
			</div>
		{/each}
	</div>
{/if}
