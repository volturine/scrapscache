<script lang="ts">
	import { reminderSettingsRow, reminderSettingsStyles } from '$panda/styles';
	import { onMount } from 'svelte';
	import { Menu } from '@ark-ui/svelte/menu';
	import { Bell, ChevronRight } from '@lucide/svelte';
	import {
		notificationPermission,
		notificationsBlockedHint,
		requestReminderPermission
	} from '#lib/reminderNotify.js';
	import { registerAllReminderDevices } from '#lib/reminderWake.js';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { pwaInstallStore } from '#lib/stores/pwaInstall.svelte.js';
	import { reminderStore } from '#lib/stores/reminders.svelte.js';
	import { cx } from 'styled-system/css';
	import { menuItem } from 'styled-system/recipes';

	let permission = $state(notificationPermission());
	const hintId = $props.id();
	const blockedHint = $derived(notificationsBlockedHint(pwaInstallStore.isStandalone));

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
		if (await registerAllReminderDevices()) reminderStore.publish(notesStore.notes);
	}
</script>

<Menu.ItemGroup aria-label="Notifications">
	{#if permission === 'default'}
		<Menu.Item
			value="notifications-enable"
			closeOnSelect={false}
			onSelect={() => void enable()}
			class={cx(menuItem({ density: 'compact' }), reminderSettingsRow.base)}
			aria-label="Turn on notifications"
		>
			<Bell class={reminderSettingsStyles.icon} aria-hidden="true" />
			<span class={reminderSettingsStyles.label}>Notifications</span>
			<span class={reminderSettingsStyles.status}>Not set</span>
			<ChevronRight class={reminderSettingsStyles.chevron} aria-hidden="true" />
		</Menu.Item>
	{:else}
		<!-- A passive item, so moving through the menu still reaches the state and its hint. -->
		<Menu.Item
			value="notifications-status"
			closeOnSelect={false}
			class={cx(menuItem({ density: 'compact', feedback: 'none' }), reminderSettingsRow.base)}
			aria-describedby={permission === 'denied' ? hintId : undefined}
		>
			<Bell class={reminderSettingsStyles.icon} aria-hidden="true" />
			<span class={reminderSettingsStyles.label}>Notifications</span>
			<span class={reminderSettingsStyles.status}>
				{permission === 'granted'
					? 'Enabled'
					: permission === 'denied'
						? 'Disabled'
						: 'Unsupported'}
			</span>
		</Menu.Item>
		{#if permission === 'denied'}
			<p id={hintId} class={reminderSettingsStyles.hint}>{blockedHint}</p>
		{/if}
	{/if}
</Menu.ItemGroup>
