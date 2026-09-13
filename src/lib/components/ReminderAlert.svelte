<script lang="ts">
	import {
		reminderAlertRoot as root,
		reminderAlertCard as card,
		reminderAlertIcon as icon,
		reminderAlertContent as content,
		reminderAlertTitle as title,
		reminderAlertSubtitle as subtitle,
		reminderAlertDismissIcon as dismissIcon
	} from '$panda/styles';
	import { fly } from 'svelte/transition';
	import { AlarmClock, X } from '@lucide/svelte';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import { formatReminder } from '$lib/utils';
	import { iconButton } from 'styled-system/recipes';

	const alerts = $derived(reminderStore.alerts);
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
