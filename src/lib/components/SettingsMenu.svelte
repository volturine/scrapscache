<script lang="ts">
	import { iconSizeMd as iconMd, popover, settingsMenuStyles as styles } from '$panda/styles';
	import { cx } from 'styled-system/css';
	import { iconButton, menuItem } from 'styled-system/recipes';
	import { Menu } from '@ark-ui/svelte/menu';
	import { Download, EllipsisVertical, Settings, Upload } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { uiStore, type Layout, type Theme } from '#lib/stores/ui.svelte.js';
	import Tooltip from './Tooltip.svelte';
	import PwaInstallSettings from './PwaInstallSettings.svelte';
	import ReminderNotificationSettings from './ReminderNotificationSettings.svelte';
	import StorageSettings from './StorageSettings.svelte';

	let {
		open = $bindable(false),
		onExport,
		onImport,
		importing = false,
		importError = '',
		phone = false
	}: {
		open?: boolean;
		onExport: () => void;
		onImport: () => void;
		importing?: boolean;
		importError?: string;
		/** On a phone this is the "More" menu; its places are in the title's picker. */
		phone?: boolean;
	} = $props();

	const menuItemClass = cx(menuItem({ density: 'compact' }), styles.row);
	const themes: { value: Theme; label: string }[] = [
		{ value: 'system', label: 'System' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	];
	const layouts: { value: Layout; label: string }[] = [
		{ value: 'grid', label: 'Grid' },
		{ value: 'list', label: 'List' }
	];
	const id = $props.id();
	const ids = {
		appearance: `${id}-appearance`,
		theme: `${id}-theme`,
		layout: `${id}-layout`,
		data: `${id}-data`,
		about: `${id}-about`
	};
</script>

<Menu.Root bind:open positioning={{ placement: 'bottom-end' }} closeOnSelect={false}>
	<Tooltip content={phone ? 'More' : 'Settings'}>
		<Menu.Trigger
			class={iconButton({ variant: 'ghost', size: { base: 'compact', sm: 'standard' } })}
			title={phone ? 'More' : 'Settings'}
			aria-label={phone ? 'More' : 'Settings'}
		>
			{#if phone}
				<EllipsisVertical class={iconMd} aria-hidden="true" />
			{:else}
				<Settings class={iconMd} aria-hidden="true" />
			{/if}
		</Menu.Trigger>
	</Tooltip>
	<Menu.Positioner class={styles.positioner}>
		<Menu.Content class={cx(popover, styles.popover)}>
			<Menu.ItemGroup class={styles.section} aria-labelledby={ids.appearance}>
				<Menu.ItemGroupLabel id={ids.appearance} class={styles.sectionLabel}
					>Appearance</Menu.ItemGroupLabel
				>
				<div class={styles.controlRow}>
					<span id={ids.theme} class={styles.controlLabel}>Theme</span>
					<Menu.RadioItemGroup
						value={uiStore.theme}
						onValueChange={(details) => uiStore.setTheme(details.value as Theme)}
						class={styles.segment}
						aria-labelledby={ids.theme}
					>
						{#each themes as theme (theme.value)}
							<Menu.RadioItem value={theme.value} closeOnSelect={false} class={styles.segmentItem}>
								<Menu.ItemText>{theme.label}</Menu.ItemText>
							</Menu.RadioItem>
						{/each}
					</Menu.RadioItemGroup>
				</div>
				<div class={styles.controlRow}>
					<span id={ids.layout} class={styles.controlLabel}>Layout</span>
					<Menu.RadioItemGroup
						value={uiStore.layout}
						onValueChange={(details) => (uiStore.layout = details.value as Layout)}
						class={styles.segment}
						aria-labelledby={ids.layout}
					>
						{#each layouts as layout (layout.value)}
							<Menu.RadioItem value={layout.value} closeOnSelect={false} class={styles.segmentItem}>
								<Menu.ItemText>{layout.label}</Menu.ItemText>
							</Menu.RadioItem>
						{/each}
					</Menu.RadioItemGroup>
				</div>
			</Menu.ItemGroup>

			<Menu.ItemGroup class={styles.section} aria-labelledby={ids.data}>
				<Menu.ItemGroupLabel id={ids.data} class={styles.sectionLabel}
					>Data on this device</Menu.ItemGroupLabel
				>
				<Menu.Item value="export" onSelect={onExport} class={menuItemClass}>
					<Download class={styles.deviceIcon} aria-hidden="true" />
					Back up notes…
				</Menu.Item>
				<Menu.Item value="import" disabled={importing} onSelect={onImport} class={menuItemClass}>
					<Upload class={styles.deviceIcon} aria-hidden="true" />
					Restore from a backup…
				</Menu.Item>
				<PwaInstallSettings />
				<StorageSettings />
				<ReminderNotificationSettings />
			</Menu.ItemGroup>

			<Menu.ItemGroup class={styles.section} aria-labelledby={ids.about}>
				<Menu.ItemGroupLabel id={ids.about} class={styles.sectionLabel}>About</Menu.ItemGroupLabel>
				<div class={styles.links}>
					<Menu.Item value="issue">
						{#snippet asChild(props)}
							<a
								{...props()}
								href="https://github.com/volturine/scrapscache/issues/new/choose"
								target="_blank"
								rel="noreferrer"
								class={styles.link}
							>
								Report an issue
							</a>
						{/snippet}
					</Menu.Item>
					<Menu.Item value="privacy">
						{#snippet asChild(props)}
							<a {...props()} href={resolve('privacy')} class={styles.link}>Privacy</a>
						{/snippet}
					</Menu.Item>
					<Menu.Item value="terms">
						{#snippet asChild(props)}
							<a {...props()} href={resolve('terms')} class={styles.link}>Terms</a>
						{/snippet}
					</Menu.Item>
				</div>
			</Menu.ItemGroup>
			{#if importError}<p class={styles.alert} role="alert">{importError}</p>{/if}
		</Menu.Content>
	</Menu.Positioner>
</Menu.Root>
