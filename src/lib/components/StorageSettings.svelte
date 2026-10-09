<script lang="ts">
	import {
		reminderSettingsRow,
		reminderSettingsStyles,
		storageSettingsStyles
	} from '$panda/styles';
	import { Menu } from '@ark-ui/svelte/menu';
	import { ChevronRight, HardDrive } from '@lucide/svelte';
	import { storagePersistenceStore } from '#lib/stores/storagePersistence.svelte.js';
	import { cx } from 'styled-system/css';
	import { menuItem } from 'styled-system/recipes';
</script>

<section aria-label="Storage">
	{#if storagePersistenceStore.state === 'best-effort' && !storagePersistenceStore.denied}
		<Menu.Item
			value="storage-persist"
			closeOnSelect={false}
			onSelect={() => void storagePersistenceStore.request()}
			class={cx(menuItem({ density: 'compact' }), reminderSettingsRow.base)}
		>
			<HardDrive class={reminderSettingsStyles.icon} aria-hidden="true" />
			<span class={reminderSettingsStyles.label}>Storage</span>
			<span class={reminderSettingsStyles.status}>May be cleared</span>
			<ChevronRight class={reminderSettingsStyles.chevron} aria-hidden="true" />
		</Menu.Item>
	{:else if storagePersistenceStore.state === 'best-effort'}
		<div class={reminderSettingsRow.base}>
			<HardDrive class={reminderSettingsStyles.icon} aria-hidden="true" />
			<span class={reminderSettingsStyles.label}>Storage</span>
			<span class={reminderSettingsStyles.status}>Not granted</span>
		</div>
		<p class={storageSettingsStyles.hint}>
			The browser may clear notes stored here. Export a backup or turn on sync to keep a copy.
		</p>
	{:else if storagePersistenceStore.state === 'persisted'}
		<div class={reminderSettingsRow.base}>
			<HardDrive class={reminderSettingsStyles.icon} aria-hidden="true" />
			<span class={reminderSettingsStyles.label}>Storage</span>
			<span class={reminderSettingsStyles.status}>Persistent</span>
		</div>
	{/if}
</section>
