<script lang="ts">
	import { settingsMenuStyles as styles } from '$panda/styles';
	import { Menu } from '@ark-ui/svelte/menu';
	import { ChevronRight, HardDrive } from '@lucide/svelte';
	import { isNativeApp } from '#lib/native.js';
	import { storagePersistenceStore } from '#lib/stores/storagePersistence.svelte.js';
	import { cx } from 'styled-system/css';
	import { menuItem } from 'styled-system/recipes';

	const id = $props.id();
	const labelId = `${id}-label`;
	const statusId = `${id}-status`;
	const askable = $derived(
		storagePersistenceStore.state === 'best-effort' && !storagePersistenceStore.denied
	);
	/** The sentence under the row: what the browser will do with the notes, and what to do about it. */
	const status = $derived(
		storagePersistenceStore.state === 'persisted'
			? 'Kept: the browser will not clear them on its own.'
			: askable
				? 'Not guaranteed: the browser may delete them. Tap to ask it to keep them.'
				: 'Not granted: the browser may clear notes stored here. Export a backup or turn on sync to keep a copy.'
	);
</script>

<!-- The iPhone app's notes are in its own sandbox, which no browser clears. -->
{#if !isNativeApp() && (storagePersistenceStore.state === 'best-effort' || storagePersistenceStore.state === 'persisted')}
	{#if askable}
		<Menu.Item
			value="storage-persist"
			closeOnSelect={false}
			onSelect={() => void storagePersistenceStore.request()}
			class={cx(menuItem({ density: 'compact' }), styles.deviceRow)}
			aria-labelledby={labelId}
			aria-describedby={statusId}
		>
			<HardDrive class={styles.deviceIcon} aria-hidden="true" />
			<span class={styles.deviceText}>
				<span id={labelId} class={styles.deviceLabel}>Keep notes on this device</span>
				<span id={statusId} class={styles.statusWarning}>{status}</span>
			</span>
			<ChevronRight class={styles.deviceChevron} aria-hidden="true" />
		</Menu.Item>
	{:else}
		<!-- A passive item, so moving through the menu still reaches the state and its sentence. -->
		<Menu.Item
			value="storage-status"
			closeOnSelect={false}
			class={cx(menuItem({ density: 'compact', feedback: 'none' }), styles.deviceRow)}
			aria-labelledby={labelId}
			aria-describedby={statusId}
		>
			<HardDrive class={styles.deviceIcon} aria-hidden="true" />
			<span class={styles.deviceText}>
				<span id={labelId} class={styles.deviceLabel}>Keep notes on this device</span>
				<span
					id={statusId}
					class={storagePersistenceStore.state === 'persisted'
						? styles.status
						: styles.statusWarning}>{status}</span
				>
			</span>
		</Menu.Item>
	{/if}
{/if}
