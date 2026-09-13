<script lang="ts">
	import { onMount } from 'svelte';
	import { Bell, ChevronRight } from '@lucide/svelte';
	import { notificationPermission, requestReminderPermission } from '$lib/reminderNotify';
	import { registerReminderDevice } from '$lib/reminderWake';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import { css, cva } from 'styled-system/css';

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

	const row = cva({
		base: {
			display: 'flex',
			h: '2rem',
			alignItems: 'center',
			gap: 'list',
			px: 'md'
		},
		variants: {
			interactive: {
				true: {
					w: 'full',
					textAlign: 'left',
					cursor: 'pointer',
					_hoverable: {
						bg: 'scrapscache.interactiveHover'
					}
				}
			}
		}
	});
	const icon = css({ w: '1rem', h: '1rem', flexShrink: 0, color: 'scrapscache.text' });
	const label = css({ minW: 0, flex: '1', textStyle: 'button', color: 'scrapscache.text' });
	const status = css({ flexShrink: 0, textStyle: 'captionStrong', color: 'scrapscache.textMuted' });
	const chevron = css({ w: '1rem', h: '1rem', flexShrink: 0, color: 'scrapscache.textMuted' });
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
