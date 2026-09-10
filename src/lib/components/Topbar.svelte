<script lang="ts">
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
	const SYNC_STATUS_CLASS: Record<SyncStatus, string> = {
		[SyncStatus.Normal]: '',
		[SyncStatus.Warning]: 'text-[var(--scrapscache-warning)]',
		[SyncStatus.Danger]: 'text-[var(--scrapscache-danger)]'
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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<header
	class="relative z-20 flex h-[var(--app-topbar-height)] shrink-0 items-center gap-1 px-2 sm:gap-2 sm:px-3"
	onpointerdown={closeNote}
>
	<Tooltip content="Toggle sidebar">
		<button
			class="icon-btn h-10 w-10 p-2"
			title="Toggle sidebar"
			onclick={() => uiStore.toggleSidebar()}
			aria-label="Toggle sidebar"
		>
			<MenuIcon class="h-5 w-5" aria-hidden="true" />
		</button>
	</Tooltip>

	<div
		class="flex h-10 min-h-10 max-h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] px-3"
	>
		<Search class="h-4 w-4 shrink-0 text-[var(--scrapscache-text-muted)]" aria-hidden="true" />
		<input
			value={uiStore.searchInput}
			oninput={(event) => uiStore.setSearchInput(event.currentTarget.value)}
			type="text"
			placeholder="Search"
			class="h-full min-w-0 flex-1 appearance-none bg-transparent text-sm text-[var(--scrapscache-text)] focus:outline-none placeholder:text-[var(--scrapscache-text-muted)]"
		/>
		{#if uiStore.searchInput}
			<button
				type="button"
				class="icon-btn h-6 w-6 min-h-0 shrink-0 appearance-none p-0 text-[var(--scrapscache-text-muted)]"
				onclick={() => uiStore.clearSearch()}
				aria-label="Clear search"
			>
				<X class="h-4 w-4" aria-hidden="true" />
			</button>
		{/if}
	</div>

	<Tooltip content={syncControlLabel}>
		<button
			type="button"
			class="icon-btn h-10 w-10 p-2"
			title={syncControlLabel}
			onclick={() => {
				pairingCode = '';
				syncOpen = true;
			}}
			aria-label={syncControlLabel}
			data-scrapscache-sync-control
		>
			<Cloud
				class={[
					'h-5 w-5',
					SYNC_STATUS_CLASS[syncStatus],
					notesStore.syncing && 'scrapscache-sync-icon-active'
				]}
				data-scrapscache-sync-icon
				aria-hidden="true"
			/>
		</button>
	</Tooltip>

	<Tooltip content={uiStore.layout === 'grid' ? 'List view' : 'Grid view'}>
		<button
			class="icon-btn h-10 w-10 p-2"
			title="Toggle layout"
			onclick={() => uiStore.toggleLayout()}
			aria-label="Toggle layout"
		>
			{#if uiStore.layout === 'grid'}
				<List class="h-5 w-5" aria-hidden="true" />
			{:else}
				<LayoutGrid class="h-5 w-5" aria-hidden="true" />
			{/if}
		</button>
	</Tooltip>

	<Menu.Root
		bind:open={settingsOpen}
		positioning={{ placement: 'bottom-end' }}
		closeOnSelect={false}
	>
		<Tooltip content="Settings">
			<Menu.Trigger class="icon-btn h-10 w-10 p-2" title="Settings" aria-label="Settings">
				<Settings class="h-5 w-5" aria-hidden="true" />
			</Menu.Trigger>
		</Tooltip>
		<Menu.Positioner class="z-30">
			<Menu.Content class="scrapscache-popover w-64 overflow-hidden pt-1">
				{#if importingBackup}
					{@const progress = notesStore.backupImportProgress}
					<div
						class="space-y-2 px-3 py-2 text-xs text-[var(--scrapscache-text-muted)]"
						role="status"
						aria-live="polite"
					>
						<div class="flex justify-between gap-2">
							<span
								>{progress?.phase === BackupImportPhase.Finishing
									? 'Finishing backup…'
									: progress
										? 'Importing backup…'
										: 'Reading backup…'}</span
							>{#if progress}<span>{progress.completed}/{progress.total}</span>{/if}
						</div>
						<div class="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
							<div
								class="h-full bg-blue-600 transition-[width]"
								style={`width: ${progress && progress.total ? Math.round((progress.completed / progress.total) * 100) : 8}%`}
							></div>
						</div>
					</div>
				{:else}
					<Menu.Item
						value="theme"
						closeOnSelect={false}
						onSelect={() => uiStore.toggleDark()}
						class="flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-sm text-[var(--scrapscache-text)] hover:bg-black/5 dark:hover:bg-white/10"
					>
						{#if uiStore.effectiveDark}
							<Sun class="h-4 w-4 shrink-0" aria-hidden="true" />
							Light mode
						{:else}
							<Moon class="h-4 w-4 shrink-0" aria-hidden="true" />
							Dark mode
						{/if}
					</Menu.Item>
					<Menu.Item
						value="export"
						onSelect={startBackupExport}
						class="flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-sm text-[var(--scrapscache-text)] hover:bg-black/5 dark:hover:bg-white/10"
					>
						<Download class="h-4 w-4 shrink-0" aria-hidden="true" />
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
						<FileUpload.Trigger
							class="flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-sm text-[var(--scrapscache-text)] hover:bg-black/5 dark:hover:bg-white/10"
						>
							<Upload class="h-4 w-4 shrink-0" aria-hidden="true" />
							Import backup
						</FileUpload.Trigger>
						<FileUpload.HiddenInput />
					</FileUpload.Root>
					<ReminderNotificationSettings />
					<Menu.Separator class="border-t border-[var(--scrapscache-border)]" />
					<Menu.Item value="issue">
						{#snippet asChild(props)}
							<a
								{...props()}
								href="https://github.com/volturine/scrapscache/issues/new/choose"
								target="_blank"
								rel="noreferrer"
								class="flex h-8 w-full items-center gap-2 px-3 text-left text-sm text-[var(--scrapscache-text)] hover:bg-black/5 dark:hover:bg-white/10"
							>
								<ExternalLink class="h-4 w-4 shrink-0" aria-hidden="true" />
								Report an issue
							</a>
						{/snippet}
					</Menu.Item>
				{/if}
				{#if backupImportError}<p class="px-3 pb-2 text-xs text-red-600" role="alert">
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
