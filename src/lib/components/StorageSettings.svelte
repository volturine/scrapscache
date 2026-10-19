<script lang="ts">
	import { reminderSettingsRow, reminderSettingsStyles } from '$panda/styles';
	import { Menu } from '@ark-ui/svelte/menu';
	import { ChevronRight, HardDrive } from '@lucide/svelte';
	import { storagePersistenceStore } from '#lib/stores/storagePersistence.svelte.js';
	import { cx } from 'styled-system/css';
	import { menuItem } from 'styled-system/recipes';

	const hintId = $props.id();
</script>

{#if storagePersistenceStore.state === 'best-effort' || storagePersistenceStore.state === 'persisted'}
	<Menu.ItemGroup aria-label="Storage">
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
		{:else}
			{@const refused = storagePersistenceStore.state === 'best-effort'}
			<!-- A passive item, so moving through the menu still reaches the state and its hint. -->
			<Menu.Item
				value="storage-status"
				closeOnSelect={false}
				class={cx(menuItem({ density: 'compact', feedback: 'none' }), reminderSettingsRow.base)}
				aria-describedby={refused ? hintId : undefined}
			>
				<HardDrive class={reminderSettingsStyles.icon} aria-hidden="true" />
				<span class={reminderSettingsStyles.label}>Storage</span>
				<span class={reminderSettingsStyles.status}>{refused ? 'Not granted' : 'Persistent'}</span>
			</Menu.Item>
			{#if refused}
				<p id={hintId} class={reminderSettingsStyles.hint}>
					The browser may clear notes stored here. Export a backup or turn on sync to keep a copy.
				</p>
			{/if}
		{/if}
	</Menu.ItemGroup>
{/if}
