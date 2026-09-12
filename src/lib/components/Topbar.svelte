<script lang="ts">
	import { cx, cva, sva } from 'styled-system/css';
	import { iconButton, input, popover } from 'styled-system/recipes';
	import { hstack, vstack } from 'styled-system/patterns';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { downloadJSON } from '$lib/utils';
	import { syncStore } from '$lib/stores/sync.svelte';
	import SyncModal from './SyncModal.svelte';
	import Tooltip from './Tooltip.svelte';
	import ReminderNotificationSettings from './ReminderNotificationSettings.svelte';
	import BackupPassphraseDialog from './BackupPassphraseDialog.svelte';
	import BackupImportModeDialog from './BackupImportModeDialog.svelte';
	import { BackupImportMode, BackupImportPhase, BackupOperation } from '$lib/backup';
	import { resolveSyncStatus, SyncStatus } from '$lib/syncStatus';
	import { useEditorActions } from '$lib/editorContext';
	import { pairingCodeFromUrl } from '$lib/syncPairing';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		decryptBackup,
		encryptBackup,
		isEncryptedScrapsCacheBackup,
		type EncryptedScrapsCacheBackup
	} from '$lib/backupCrypto';
	import { FileUpload } from '@ark-ui/svelte/file-upload';
	import { Menu } from '@ark-ui/svelte/menu';
	import {
		Cloud,
		Download,
		ExternalLink,
		LayoutGrid,
		List,
		Menu as MenuIcon,
		Moon,
		Search,
		Settings,
		Sun,
		Upload,
		X
	} from '@lucide/svelte';

	const SYNC_CONTROL_LABEL: Record<SyncStatus, string> = {
		[SyncStatus.Normal]: 'Sync settings',
		[SyncStatus.Warning]: 'Sync settings, storage nearly full',
		[SyncStatus.Danger]: 'Sync settings, sync needs attention'
	};

	const { startNewNote, closeNote } = useEditorActions();

	let settingsOpen = $state(false);
	let syncOpen = $state(false);
	let pairingCode = $state('');
	let importingBackup = $state(false);
	let backupImportError = $state('');
	let backupDialogMode = $state<BackupOperation | null>(null);
	let backupBusy = $state(false);
	let pendingEncryptedBackup = $state<EncryptedScrapsCacheBackup | null>(null);
	let pendingImportData = $state.raw<unknown>(null);
	let choosingImportMode = $state(false);
	let syncStatus = $derived(resolveSyncStatus(syncStore.lastError, syncStore.usage));
	let syncControlLabel = $derived(SYNC_CONTROL_LABEL[syncStatus]);

	function openPairingLink() {
		const found = pairingCodeFromUrl(window.location.href);
		if (!found) return;
		pairingCode = found;
		syncOpen = true;
		void goto(resolve('/'), { replaceState: true, noScroll: true, keepFocus: true });
	}

	onMount(openPairingLink);

	function startBackupExport() {
		settingsOpen = false;
		backupImportError = '';
		backupDialogMode = BackupOperation.Export;
	}

	async function submitBackupPassphrase(passphrase: string) {
		backupBusy = true;
		backupImportError = '';
		try {
			if (backupDialogMode === BackupOperation.Export) {
				const data = await notesStore.exportBackup();
				const encrypted = await encryptBackup(data, passphrase);
				downloadJSON(
					encrypted,
					`scrapscache-backup-${new Date().toISOString().slice(0, 10)}.scraps-cache-backup`
				);
				backupDialogMode = null;
				return;
			}
			if (backupDialogMode === BackupOperation.Import && pendingEncryptedBackup) {
				const decrypted = await decryptBackup(pendingEncryptedBackup, passphrase);
				pendingImportData = decrypted;
				pendingEncryptedBackup = null;
				backupDialogMode = null;
				settingsOpen = false;
				choosingImportMode = true;
			}
		} catch (error) {
			backupImportError = error instanceof Error ? error.message : 'Backup operation failed.';
		} finally {
			backupBusy = false;
			importingBackup = false;
		}
	}

	async function selectImportMode(mode: BackupImportMode) {
		if (!pendingImportData) return;
		choosingImportMode = false;
		importingBackup = true;
		settingsOpen = true;
		backupImportError = '';
		try {
			const result = await notesStore.importBackup(pendingImportData, mode);
			if (!result.success) throw new Error(result.error || 'Could not import that backup.');
			pendingImportData = null;
			settingsOpen = false;
		} catch (error) {
			backupImportError = error instanceof Error ? error.message : 'Backup operation failed.';
			choosingImportMode = true;
			settingsOpen = false;
		} finally {
			importingBackup = false;
		}
	}

	function importBackupFile(file: File) {
		if (importingBackup) return;
		importingBackup = true;
		backupImportError = '';
		const reader = new FileReader();
		reader.onload = async () => {
			try {
				const data = JSON.parse(String(reader.result));
				if (!isEncryptedScrapsCacheBackup(data))
					throw new Error('This is not a current encrypted Scraps Cache backup.');
				pendingEncryptedBackup = data;
				backupDialogMode = BackupOperation.Import;
				settingsOpen = false;
			} catch (err) {
				backupImportError = err instanceof Error ? err.message : 'Could not read that backup file.';
			} finally {
				importingBackup = false;
			}
		};
		reader.onerror = () => {
			importingBackup = false;
			backupImportError = 'Could not read that backup file.';
		};
		reader.readAsText(file);
	}

	function handleKeydown(e: KeyboardEvent) {
		// Ctrl+/ focuses composer.
		if ((e.ctrlKey || e.metaKey) && e.key === '/') {
			e.preventDefault();
			startNewNote();
		}
		if (importingBackup && e.key === 'Escape') {
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	}

	const topbar = sva({
		slots: ['searchInput', 'clearButton', 'searchIcon', 'syncIcon'],
		base: {
			searchInput: {
				h: 'full',
				flex: '1',
				appearance: 'none',
				_placeholder: { color: 'scrapscache.textMuted' }
			},
			clearButton: {
				h: '1.5rem',
				w: '1.5rem',
				minH: 0,
				flexShrink: 0,
				appearance: 'none',
				p: 0,
				color: 'scrapscache.textMuted'
			},
			searchIcon: { color: 'scrapscache.textMuted' },
			syncIcon: { display: 'block' }
		}
	});
	const topbarStyles = topbar();
	const searchInputClass = cx(input({ variant: 'unstyled' }), topbarStyles.searchInput);
	const clearButton = cx(iconButton({ variant: 'ghost', size: 'xs' }), topbarStyles.clearButton);
	const syncTone = cva({
		variants: {
			status: {
				[SyncStatus.Normal]: {},
				[SyncStatus.Warning]: { color: 'scrapscache.warning' },
				[SyncStatus.Danger]: { color: 'scrapscache.danger' }
			}
		}
	});
	const icon = cva({
		base: { flexShrink: 0 },
		variants: {
			size: {
				sm: { h: '1rem', w: '1rem' },
				md: { h: '1.25rem', w: '1.25rem' }
			}
		}
	});
	const settingsMenu = sva({
		slots: ['positioner', 'popover', 'item', 'separator', 'track', 'bar', 'alert'],
		base: {
			positioner: { zIndex: 30 },
			popover: { w: '16rem', overflow: 'hidden', pt: '0.25rem' },
			item: {
				display: 'flex',
				h: '2rem',
				w: 'full',
				cursor: 'pointer',
				alignItems: 'center',
				gap: '0.5rem',
				px: '0.75rem',
				textAlign: 'left',
				fontSize: 'sm',
				color: 'scrapscache.text',
				_hoverable: { bg: 'scrapscache.interactiveHover' }
			},
			separator: { borderTopWidth: '1px', borderColor: 'scrapscache.border' },
			track: {
				h: '0.375rem',
				overflow: 'hidden',
				rounded: 'full',
				bg: 'scrapscache.interactiveActive'
			},
			bar: { h: 'full', bg: 'blue.600', transition: 'width 150ms ease' },
			alert: { px: '0.75rem', pb: '0.5rem', fontSize: 'xs', color: 'red.600' }
		}
	});
	const menu = settingsMenu();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<header
	class={hstack({
		h: 'var(--app-topbar-height)',
		flexShrink: 0,
		px: { base: '0.5rem', sm: '0.75rem' },
		gap: { base: '0.25rem', sm: '0.5rem' },
		position: 'relative',
		zIndex: 20
	})}
	onpointerdown={closeNote}
>
	<Tooltip content="Toggle sidebar">
		<button
			class={iconButton({ variant: 'ghost', size: 'standard' })}
			title="Toggle sidebar"
			onclick={() => uiStore.toggleSidebar()}
			aria-label="Toggle sidebar"
		>
			<MenuIcon class={icon({ size: 'md' })} aria-hidden="true" />
		</button>
	</Tooltip>

	<div
		class={hstack({
			h: '2.5rem',
			minH: '2.5rem',
			maxH: '2.5rem',
			minW: 0,
			flex: '1',
			rounded: 'full',
			borderWidth: '1px',
			borderColor: 'scrapscache.border',
			bg: 'scrapscache.surface',
			px: '0.75rem',
			gap: '0.5rem'
		})}
	>
		<Search class={cx(icon({ size: 'sm' }), topbarStyles.searchIcon)} aria-hidden="true" />
		<input
			value={uiStore.searchInput}
			oninput={(event) => uiStore.setSearchInput(event.currentTarget.value)}
			type="text"
			placeholder="Search"
			class={searchInputClass}
		/>
		{#if uiStore.searchInput}
			<button
				type="button"
				class={clearButton}
				onclick={() => uiStore.clearSearch()}
				aria-label="Clear search"
			>
				<X class={icon({ size: 'sm' })} aria-hidden="true" />
			</button>
		{/if}
	</div>

	<Tooltip content={syncControlLabel}>
		<button
			type="button"
			class={iconButton({ variant: 'ghost', size: 'standard' })}
			title={syncControlLabel}
			onclick={() => {
				pairingCode = '';
				syncOpen = true;
			}}
			aria-label={syncControlLabel}
			data-scrapscache-sync-control
		>
			<!-- The spin turns this span, not the icon: Safari treats a transform on
			     an svg root as its own user space, so the icon sat still there. -->
			<span
				class={[
					icon({ size: 'md' }),
					topbarStyles.syncIcon,
					notesStore.syncing && 'scrapscache-sync-icon-active'
				]}
				data-scrapscache-sync-spinner
			>
				<Cloud
					class={[icon({ size: 'md' }), syncTone({ status: syncStatus })]}
					data-scrapscache-sync-icon
					aria-hidden="true"
				/>
			</span>
		</button>
	</Tooltip>

	<Tooltip content={uiStore.layout === 'grid' ? 'List view' : 'Grid view'}>
		<button
			class={iconButton({ variant: 'ghost', size: 'standard' })}
			title="Toggle layout"
			onclick={() => uiStore.toggleLayout()}
			aria-label="Toggle layout"
		>
			{#if uiStore.layout === 'grid'}
				<List class={icon({ size: 'md' })} aria-hidden="true" />
			{:else}
				<LayoutGrid class={icon({ size: 'md' })} aria-hidden="true" />
			{/if}
		</button>
	</Tooltip>

	<Menu.Root
		bind:open={settingsOpen}
		positioning={{ placement: 'bottom-end' }}
		closeOnSelect={false}
	>
		<Tooltip content="Settings">
			<Menu.Trigger
				class={iconButton({ variant: 'ghost', size: 'standard' })}
				title="Settings"
				aria-label="Settings"
			>
				<Settings class={icon({ size: 'md' })} aria-hidden="true" />
			</Menu.Trigger>
		</Tooltip>
		<Menu.Positioner class={menu.positioner}>
			<Menu.Content class={cx(popover(), menu.popover)}>
				{#if importingBackup}
					{@const progress = notesStore.backupImportProgress}
					<div
						class={vstack({
							gap: '0.5rem',
							px: '0.75rem',
							py: '0.5rem',
							fontSize: 'xs',
							color: 'scrapscache.textMuted',
							alignItems: 'stretch'
						})}
						role="status"
						aria-live="polite"
					>
						<div class={hstack({ justify: 'space-between', gap: '0.5rem' })}>
							<span
								>{progress?.phase === BackupImportPhase.Finishing
									? 'Finishing backup…'
									: progress
										? 'Importing backup…'
										: 'Reading backup…'}</span
							>{#if progress}<span>{progress.completed}/{progress.total}</span>{/if}
						</div>
						<div class={menu.track}>
							<div
								class={menu.bar}
								style={`width: ${progress && progress.total ? Math.round((progress.completed / progress.total) * 100) : 8}%`}
							></div>
						</div>
					</div>
				{:else}
					<Menu.Item
						value="theme"
						closeOnSelect={false}
						onSelect={() => uiStore.toggleDark()}
						class={menu.item}
					>
						{#if uiStore.effectiveDark}
							<Sun class={icon({ size: 'sm' })} aria-hidden="true" />
							Light mode
						{:else}
							<Moon class={icon({ size: 'sm' })} aria-hidden="true" />
							Dark mode
						{/if}
					</Menu.Item>
					<Menu.Item value="export" onSelect={startBackupExport} class={menu.item}>
						<Download class={icon({ size: 'sm' })} aria-hidden="true" />
						Export backup
					</Menu.Item>
					<FileUpload.Root
						accept=".scraps-cache-backup,application/json"
						maxFiles={1}
						onFileAccept={(details) => {
							const file = details.files[0];
							if (file) importBackupFile(file);
						}}
					>
						<FileUpload.Trigger class={menu.item}>
							<Upload class={icon({ size: 'sm' })} aria-hidden="true" />
							Import backup
						</FileUpload.Trigger>
						<FileUpload.HiddenInput />
					</FileUpload.Root>
					<ReminderNotificationSettings />
					<Menu.Separator class={menu.separator} />
					<Menu.Item value="issue">
						{#snippet asChild(props)}
							<a
								{...props()}
								href="https://github.com/volturine/scrapscache/issues/new/choose"
								target="_blank"
								rel="noreferrer"
								class={menu.item}
							>
								<ExternalLink class={icon({ size: 'sm' })} aria-hidden="true" />
								Report an issue
							</a>
						{/snippet}
					</Menu.Item>
				{/if}
				{#if backupImportError}<p class={menu.alert} role="alert">
						{backupImportError}
					</p>{/if}
			</Menu.Content>
		</Menu.Positioner>
	</Menu.Root>
</header>

<svelte:window
	onkeydown={handleKeydown}
	onhashchange={openPairingLink}
	onpageshow={openPairingLink}
	onfocus={openPairingLink}
	onpopstate={openPairingLink}
/>
<svelte:document onvisibilitychange={openPairingLink} />

{#if syncOpen}
	{#key pairingCode}
		<SyncModal
			initialPairingCode={pairingCode}
			onClose={() => {
				syncOpen = false;
				pairingCode = '';
			}}
		/>
	{/key}
{/if}

{#if choosingImportMode}
	<BackupImportModeDialog
		busy={importingBackup}
		error={backupImportError}
		onSelect={selectImportMode}
		onClose={() => {
			if (importingBackup) return;
			choosingImportMode = false;
			pendingImportData = null;
			backupImportError = '';
		}}
	/>
{/if}

{#if backupDialogMode}
	<BackupPassphraseDialog
		mode={backupDialogMode}
		busy={backupBusy}
		error={backupImportError}
		onSubmit={submitBackupPassphrase}
		onClose={() => {
			if (backupBusy) return;
			backupDialogMode = null;
			pendingEncryptedBackup = null;
			backupImportError = '';
		}}
	/>
{/if}
