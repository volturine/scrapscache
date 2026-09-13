<script lang="ts">
	import { onMount } from 'svelte';
	import { Bell, ChevronRight } from '@lucide/svelte';
	import { notificationPermission, requestReminderPermission } from '$lib/reminderNotify';
	import { registerReminderDevice } from '$lib/reminderWake';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import { cva, sva } from 'styled-system/css';

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

	const settingsSva = sva({
		slots: ['section', 'icon', 'label', 'status', 'chevron'],
		base: {
			section: {
				borderTopWidth: 'hairline',
				borderColor: 'scrapscache.border'
			},
			icon: {
				w: '1rem',
				h: '1rem',
				flexShrink: 0,
				color: 'scrapscache.text'
			},
			label: {
				minW: 0,
				flex: '1',
				textStyle: 'button',
				color: 'scrapscache.text'
			},
			status: {
				flexShrink: 0,
				textStyle: 'captionStrong',
				color: 'scrapscache.textMuted'
			},
			chevron: {
				w: '1rem',
				h: '1rem',
				flexShrink: 0,
				color: 'scrapscache.textMuted'
			}
		}
	});

	const s = settingsSva();
</script>

<section class={s.section} aria-label="Notifications">
	{#if permission === 'default'}
		<button
			type="button"
			onclick={() => void enable()}
			class={row({ interactive: true })}
			aria-label="Turn on notifications"
		>
			<Bell class={s.icon} aria-hidden="true" />
			<span class={s.label}>Notifications</span>
			<span class={s.status}>Not set</span>
			<ChevronRight class={s.chevron} aria-hidden="true" />
		</button>
	{:else}
		<div class={row()}>
			<Bell class={s.icon} aria-hidden="true" />
			<span class={s.label}>Notifications</span>
			<span class={s.status}>
				{permission === 'granted'
					? 'Enabled'
					: permission === 'denied'
						? 'Disabled'
						: 'Unsupported'}
			</span>
		</div>
	{/if}
</section>
