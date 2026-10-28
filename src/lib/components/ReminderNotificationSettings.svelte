<script lang="ts">
	import { settingsMenuStyles as styles } from '$panda/styles';
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
	const id = $props.id();
	const labelId = `${id}-label`;
	const statusId = `${id}-status`;
	/** The sentence under the row: whether this device shows alerts, and what to do about it. */
	const status = $derived(
		permission === 'granted'
			? 'On. This device shows them.'
			: permission === 'default'
				? 'Off. Tap to turn them on.'
				: permission === 'denied'
					? notificationsBlockedHint(pwaInstallStore.isStandalone)
					: 'This browser cannot show them.'
	);

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

{#if permission === 'default'}
	<Menu.Item
		value="notifications-enable"
		closeOnSelect={false}
		onSelect={() => void enable()}
		class={cx(menuItem({ density: 'compact' }), styles.deviceRow)}
		aria-label="Turn on reminder alerts"
		aria-describedby={statusId}
	>
		<Bell class={styles.deviceIcon} aria-hidden="true" />
		<span class={styles.deviceText}>
			<span id={labelId} class={styles.deviceLabel}>Reminder alerts</span>
			<span id={statusId} class={styles.status}>{status}</span>
		</span>
		<ChevronRight class={styles.deviceChevron} aria-hidden="true" />
	</Menu.Item>
{:else}
	<!-- A passive item, so moving through the menu still reaches the state and its sentence. -->
	<Menu.Item
		value="notifications-status"
		closeOnSelect={false}
		class={cx(menuItem({ density: 'compact', feedback: 'none' }), styles.deviceRow)}
		aria-labelledby={labelId}
		aria-describedby={statusId}
	>
		<Bell class={styles.deviceIcon} aria-hidden="true" />
		<span class={styles.deviceText}>
			<span id={labelId} class={styles.deviceLabel}>Reminder alerts</span>
			<span id={statusId} class={permission === 'denied' ? styles.statusWarning : styles.status}
				>{status}</span
			>
		</span>
	</Menu.Item>
{/if}
