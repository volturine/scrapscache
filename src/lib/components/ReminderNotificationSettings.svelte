<script lang="ts">
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

	const sectionClass = css({
		borderTopWidth: '1px',
		borderColor: 'scrapscache.border'
	});

	const buttonRow = css({
		display: 'flex',
		h: '2rem',
		w: 'full',
		alignItems: 'center',
		gap: '0.625rem',
		px: '0.75rem',
		textAlign: 'left',
		cursor: 'pointer',
		_hover: {
			bg: { base: 'black/5', _dark: 'white/10' }
		}
	});

	const staticRow = css({
		display: 'flex',
		h: '2rem',
		alignItems: 'center',
		gap: '0.625rem',
		px: '0.75rem'
	});

	const iconClass = css({
		w: '1rem',
		h: '1rem',
		flexShrink: 0,
		color: 'scrapscache.text'
	});

	const labelClass = css({
		minW: 0,
		flex: '1',
		fontSize: 'sm',
		fontWeight: 'medium',
		color: 'scrapscache.text'
	});

	const statusClass = css({
		flexShrink: 0,
		fontSize: 'xs',
		fontWeight: 'medium',
		color: 'scrapscache.textMuted'
	});

	const chevronClass = css({
		w: '1rem',
		h: '1rem',
		flexShrink: 0,
		color: 'scrapscache.textMuted'
	});
</script>

<section class={sectionClass} aria-label="Notifications">
	{#if permission === 'default'}
		<button
			type="button"
			onclick={() => void enable()}
			class={buttonRow}
			aria-label="Turn on notifications"
		>
			<Bell class={iconClass} aria-hidden="true" />
			<span class={labelClass}>Notifications</span>
			<span class={statusClass}>Not set</span>
			<ChevronRight class={chevronClass} aria-hidden="true" />
		</button>
	{:else}
		<div class={staticRow}>
			<Bell class={iconClass} aria-hidden="true" />
			<span class={labelClass}>Notifications</span>
			<span class={statusClass}>
				{permission === 'granted'
					? 'Enabled'
					: permission === 'denied'
						? 'Disabled'
						: 'Unsupported'}
			</span>
		</div>
	{/if}
</section>
