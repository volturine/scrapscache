<script lang="ts">
	import { uiStore } from '$lib/stores/ui.svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { downloadJSON } from '$lib/utils';
	import { syncStore } from '$lib/stores/sync.svelte';
	import SyncModal from './SyncModal.svelte';
	import Tooltip from './Tooltip.svelte';
	import PwaInstallSettings from './PwaInstallSettings.svelte';
	import ReminderNotificationSettings from './ReminderNotificationSettings.svelte';
	import BackupPassphraseDialog from './BackupPassphraseDialog.svelte';
	import BackupImportModeDialog from './BackupImportModeDialog.svelte';
	import ImportGuideDialog from './ImportGuideDialog.svelte';
	import { BackupImportMode, BackupOperation } from '$lib/backup';
	import { isZipBytes, readKeepTakeout, unzipKeepTakeout } from '$lib/keepImport';
	import { resolveSyncStatus, SyncStatus } from '$lib/syncStatus';
	import { useEditorActions } from '$lib/editorContext';
	import { pairingCodeFromUrl } from '$lib/syncPairing';
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		decryptBackup,
		encryptBackup,
		isEncryptedScrapsCacheBackup,
		type EncryptedScrapsCacheBackup
	} from '$lib/backupCrypto';
	import { Menu } from '@ark-ui/svelte/menu';
	import {
		Cloud,
		Download,
		ExternalLink,
		FileText,
		LayoutGrid,
		List,
		Menu as MenuIcon,
		Moon,
		Search,
		Settings,
		Shield,
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
	let pendingKeepFiles = $state.raw<Record<string, Uint8Array> | null>(null);
	let choosingImportMode = $state(false);
	let showingImportGuide = $state(false);
	let keepImportReady = $state(false);
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

	function startBackupImport() {
		settingsOpen = false;
		backupImportError = '';
		keepImportReady = false;
		pendingKeepFiles = null;
		void tick().then(() => {
			showingImportGuide = true;
		});
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
				await tick();
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
		if (!pendingKeepFiles && !pendingImportData) return;
		showingImportGuide = false;
		keepImportReady = false;
		choosingImportMode = false;
		importingBackup = true;
		backupImportError = '';
		try {
			const result = pendingKeepFiles
				? await notesStore.importKeepTakeout(pendingKeepFiles, mode)
				: await notesStore.importBackup(pendingImportData, mode);
			if (!result.success) throw new Error(result.error || 'Could not import that file.');
			pendingImportData = null;
			pendingKeepFiles = null;
		} catch (error) {
			backupImportError = error instanceof Error ? error.message : 'Backup operation failed.';
			choosingImportMode = true;
		} finally {
			importingBackup = false;
		}
	}

	async function importBackupFile(file: File) {
		if (importingBackup) return;
		importingBackup = true;
		backupImportError = '';
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			if (isZipBytes(bytes)) {
				const files = await unzipKeepTakeout(bytes);
				if (readKeepTakeout(files).notes.length === 0)
					throw new Error('That zip does not contain Google Keep notes.');
				pendingKeepFiles = files;
				pendingImportData = null;
				keepImportReady = true;
				settingsOpen = false;
				return;
			}
			const data = JSON.parse(new TextDecoder().decode(bytes));
			if (!isEncryptedScrapsCacheBackup(data))
				throw new Error('This is not a Scraps Cache backup or Google Keep Takeout.');
			pendingEncryptedBackup = data;
			pendingKeepFiles = null;
			keepImportReady = false;
			showingImportGuide = false;
			settingsOpen = false;
			await tick();
			backupDialogMode = BackupOperation.Import;
		} catch (err) {
			backupImportError = err instanceof Error ? err.message : 'Could not read that file.';
		} finally {
			importingBackup = false;
		}
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
			<!-- The spin turns this span, not the icon: Safari treats a transform on
			     an svg root as its own user space, so the icon sat still there. -->
			<span
				class={[
					'block h-5 w-5',
					(notesStore.syncing || importingBackup) && 'scrapscache-sync-icon-active'
				]}
				data-scrapscache-sync-spinner
			>
				<Cloud
					class={['h-5 w-5', SYNC_STATUS_CLASS[syncStatus]]}
					data-scrapscache-sync-icon
					aria-hidden="true"
				/>
			</span>
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
					disabled={importingBackup}
					onSelect={startBackupExport}
					class="flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-sm text-[var(--scrapscache-text)] hover:bg-black/5 dark:hover:bg-white/10"
				>
					<Download class="h-4 w-4 shrink-0" aria-hidden="true" />
					Export backup
				</Menu.Item>
				<Menu.Item
					value="import"
					disabled={importingBackup}
					onSelect={startBackupImport}
					class="flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-sm text-[var(--scrapscache-text)] hover:bg-black/5 dark:hover:bg-white/10"
				>
					<Upload class="h-4 w-4 shrink-0" aria-hidden="true" />
					Import backup
				</Menu.Item>
				<PwaInstallSettings />
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
				<Menu.Item value="privacy">
					{#snippet asChild(props)}
						<a
							{...props()}
							href="/privacy"
							class="flex h-8 w-full items-center gap-2 px-3 text-left text-sm text-[var(--scrapscache-text)] hover:bg-black/5 dark:hover:bg-white/10"
						>
							<Shield class="h-4 w-4 shrink-0" aria-hidden="true" />
							Privacy policy
						</a>
					{/snippet}
				</Menu.Item>
				<Menu.Item value="terms">
					{#snippet asChild(props)}
						<a
							{...props()}
							href="/terms"
							class="flex h-8 w-full items-center gap-2 px-3 text-left text-sm text-[var(--scrapscache-text)] hover:bg-black/5 dark:hover:bg-white/10"
						>
							<FileText class="h-4 w-4 shrink-0" aria-hidden="true" />
							Terms of service
						</a>
					{/snippet}
				</Menu.Item>
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

{#if showingImportGuide}
	<ImportGuideDialog
		busy={importingBackup}
		error={backupImportError}
		keepReady={keepImportReady}
		onFile={importBackupFile}
		onSelectMode={selectImportMode}
		onClose={() => {
			if (importingBackup) return;
			showingImportGuide = false;
			keepImportReady = false;
			pendingKeepFiles = null;
			backupImportError = '';
		}}
	/>
{/if}

{#if choosingImportMode}
	<BackupImportModeDialog
		busy={importingBackup}
		error={backupImportError}
		keepImport={pendingKeepFiles !== null}
		onSelect={selectImportMode}
		onClose={() => {
			if (importingBackup) return;
			choosingImportMode = false;
			pendingImportData = null;
			pendingKeepFiles = null;
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
