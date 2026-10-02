<script lang="ts">
	import { reminderAlertStyles } from '$panda/styles';
	import { fly } from 'svelte/transition';
	import { AlarmClock, X } from '@lucide/svelte';
	import { reminderStore } from '#lib/stores/reminders.svelte.js';
	import { syncStore } from '#lib/stores/sync.svelte.js';
	import { formatReminder } from '#lib/utils.js';
	import { iconButton } from 'styled-system/recipes';

	const alerts = $derived(reminderStore.alerts);

	/** Named only when the reminder is from a workspace other than the open one. */
	function workspaceName(workspaceId: string): string | null {
		if (workspaceId === syncStore.activeId) return null;
		return syncStore.profiles.find((profile) => profile.id === workspaceId)?.name ?? null;
	}
</script>

{#if alerts.length > 0}
	<div
		class={reminderAlertStyles.root}
		style="top: max(0.75rem, calc(env(safe-area-inset-top, 0px) + 0.35rem))"
		role="region"
		aria-label="Due reminders"
	>
		{#each alerts as alert (alert.wakeId)}
			{@const workspace = workspaceName(alert.workspaceId)}
			<div class={reminderAlertStyles.card} role="alert" transition:fly={{ y: -16, duration: 180 }}>
				<AlarmClock class={reminderAlertStyles.icon} aria-hidden="true" />
				<button
					type="button"
					class={reminderAlertStyles.content}
					onclick={() => reminderStore.open(alert.wakeId)}
				>
					<div class={reminderAlertStyles.title}>
						{alert.title}
					</div>
					<div class={reminderAlertStyles.subtitle}>
						{workspace
							? `${formatReminder(alert.reminder)} · ${workspace}`
							: formatReminder(alert.reminder)}
					</div>
				</button>
				<button
					type="button"
					class={iconButton({ variant: 'ghost', size: 'compact' })}
					aria-label="Dismiss reminder"
					onclick={() => reminderStore.dismiss(alert.wakeId)}
				>
					<X class={reminderAlertStyles.dismissIcon} aria-hidden="true" />
				</button>
			</div>
		{/each}
	</div>
{/if}
