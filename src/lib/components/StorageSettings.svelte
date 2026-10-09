<script lang="ts">
	import { reminderSettingsRow, reminderSettingsStyles } from '$panda/styles';
	import { Menu } from '@ark-ui/svelte/menu';
	import { ChevronRight, HardDrive } from '@lucide/svelte';
	import { storagePersistenceStore } from '#lib/stores/storagePersistence.svelte.js';
	import { cx } from 'styled-system/css';
	import { menuItem } from 'styled-system/recipes';
</script>

<section aria-label="Storage">
	{#if storagePersistenceStore.state === 'best-effort'}
		<Menu.Item
			value="storage-persist"
			closeOnSelect={false}
			onSelect={() => void storagePersistenceStore.request()}
			class={cx(menuItem({ density: 'compact' }), reminderSettingsRow.base)}
			aria-label="Keep notes on this device"
			title="The browser may clear notes stored here when space runs low. Export a backup or turn on sync to keep a copy."
		>
			<HardDrive class={reminderSettingsStyles.icon} aria-hidden="true" />
			<span class={reminderSettingsStyles.label}>Storage</span>
			<span class={reminderSettingsStyles.status}>May be cleared</span>
			<ChevronRight class={reminderSettingsStyles.chevron} aria-hidden="true" />
		</Menu.Item>
	{:else if storagePersistenceStore.state === 'persisted'}
		<div class={reminderSettingsRow.base}>
			<HardDrive class={reminderSettingsStyles.icon} aria-hidden="true" />
			<span class={reminderSettingsStyles.label}>Storage</span>
			<span class={reminderSettingsStyles.status}>Persistent</span>
		</div>
	{/if}
</section>
