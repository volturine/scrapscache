<script lang="ts">
	import { reminderSettingsRow, reminderSettingsStyles } from '$panda/styles';
	import { onMount } from 'svelte';
	import { Bell, ChevronRight } from '@lucide/svelte';
	import { notificationPermission, requestReminderPermission } from '$lib/reminderNotify';
	import { registerReminderDevice } from '$lib/reminderWake';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import { cx } from 'styled-system/css';
	import { menuItem } from 'styled-system/recipes';

	let permission = $state(notificationPermission());

	onMount(() => {
		const refresh = () => {
			permission = notificationPermission();
		};
		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', refresh);
		};
	});

	async function enable() {
		permission = await requestReminderPermission();
		if (permission !== 'granted') return;
		if (await registerReminderDevice()) reminderStore.publish(notesStore.notes);
	}
</script>

<section class={reminderSettingsStyles.section} aria-label="Notifications">
	{#if permission === 'default'}
		<button
			type="button"
			onclick={() => void enable()}
			class={cx(
				menuItem({ density: 'compact' }),
				reminderSettingsRow.base,
				reminderSettingsRow.interactive
			)}
			aria-label="Turn on notifications"
		>
			<Bell class={reminderSettingsStyles.icon} aria-hidden="true" />
			<span class={reminderSettingsStyles.label}>Notifications</span>
			<span class={reminderSettingsStyles.status}>Not set</span>
			<ChevronRight class={reminderSettingsStyles.chevron} aria-hidden="true" />
		</button>
	{:else}
		<div class={reminderSettingsRow.base}>
			<Bell class={reminderSettingsStyles.icon} aria-hidden="true" />
			<span class={reminderSettingsStyles.label}>Notifications</span>
			<span class={reminderSettingsStyles.status}>
				{permission === 'granted'
					? 'Enabled'
					: permission === 'denied'
						? 'Disabled'
						: 'Unsupported'}
			</span>
		</div>
	{/if}
</section>
