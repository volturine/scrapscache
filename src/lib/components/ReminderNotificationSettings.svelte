<script lang="ts">
	import {
		reminderSettingsRow as row,
		reminderSettingsIcon as icon,
		reminderSettingsLabel as label,
		reminderSettingsStatus as status,
		reminderSettingsChevron as chevron
	} from '$panda/styles';
	import { onMount } from 'svelte';
	import { Bell, ChevronRight } from '@lucide/svelte';
	import { notificationPermission, requestReminderPermission } from '$lib/reminderNotify';
	import { registerReminderDevice } from '$lib/reminderWake';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import { css } from 'styled-system/css';

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

<section
	class={css({ borderTopWidth: 'hairline', borderColor: 'scrapscache.border' })}
	aria-label="Notifications"
>
	{#if permission === 'default'}
		<button
			type="button"
			onclick={() => void enable()}
			class={row({ interactive: true })}
			aria-label="Turn on notifications"
		>
			<Bell class={icon} aria-hidden="true" />
			<span class={label}>Notifications</span>
			<span class={status}>Not set</span>
			<ChevronRight class={chevron} aria-hidden="true" />
		</button>
	{:else}
		<div class={row()}>
			<Bell class={icon} aria-hidden="true" />
			<span class={label}>Notifications</span>
			<span class={status}>
				{permission === 'granted'
					? 'Enabled'
					: permission === 'denied'
						? 'Disabled'
						: 'Unsupported'}
			</span>
		</div>
	{/if}
</section>
