<script lang="ts">
	import {
		iconSizeSm as iconSm,
		iconSizeMd as iconMd,
		topbarStyles as styles,
		topbarSyncTone as syncTone
	} from '$panda/styles';
	import { css, cx } from 'styled-system/css';
	import { iconButton, input } from 'styled-system/recipes';
	import { hstack } from 'styled-system/patterns';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { downloadJSON } from '#lib/utils.js';
	import { syncStore } from '#lib/stores/sync.svelte.js';
	import { profileCoordinator } from '#lib/stores/profiles.svelte.js';
	import SyncModalUnavailable from './SyncModalUnavailable.svelte';
	import Tooltip from './Tooltip.svelte';
	import SettingsMenu from './SettingsMenu.svelte';
	import CommandPalette from './CommandPalette.svelte';
	import SelectionBar from './SelectionBar.svelte';
	import { selectionStore } from '#lib/stores/selection.svelte.js';
	import BackupPassphraseDialog from './BackupPassphraseDialog.svelte';
	import BackupImportModeDialog from './BackupImportModeDialog.svelte';
	import ImportGuideDialog from './ImportGuideDialog.svelte';
	import { BackupImportMode, BackupOperation } from '#lib/backup.js';
	import { resolveSyncStatus, SyncStatus } from '#lib/syncStatus.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import { pairingCodeFromUrl } from '#lib/syncPairing.js';
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { EncryptedScrapsCacheBackup } from '#lib/backupCrypto.js';
	import { loadLazyModule } from '#lib/staleModuleReload.js';
	import { Cloud, Menu as MenuIcon, Search, X } from '@lucide/svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { pathForView } from '#lib/viewRoutes.js';
	import type { View } from '#lib/stores/ui.svelte.js';
	import { isApplePlatform } from '#lib/platform.js';

	const SYNC_CONTROL_LABEL: Record<SyncStatus, string> = {
		[SyncStatus.Normal]: 'Sync settings',
		[SyncStatus.Warning]: 'Sync settings, storage nearly full',
		[SyncStatus.Danger]: 'Sync settings, sync needs attention'
	};

	const { startNewNote, closeNote } = useEditorActions();

	let settingsOpen = $state(false);
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

	let searchField: HTMLInputElement | undefined;

	const mobile = new MediaQuery('max-width: 767px');
	const VIEW_TITLES: Record<Exclude<View, 'label'>, string> = {
		notes: 'Notes',
		kanban: 'Kanban',
		reminders: 'Reminders',
		archive: 'Archive',
		trash: 'Trash'
	};
	const viewTitle = $derived(
		uiStore.view === 'label'
			? (notesStore.labelsById.get(uiStore.activeLabelId ?? '')?.name ?? 'Label')
			: VIEW_TITLES[uiStore.view]
	);

	/**
	 * A phone searches in the palette, so its bar has no field. A query typed on a wide
	 * window goes when the window narrows to the phone layout: nothing would show it or
	 * clear it there, and it would keep filtering the notes.
	 */
	$effect(() => {
		if (mobile.current) untrack(() => uiStore.clearSearch());
	});

	/** The palette's shortcut: Cmd+K on Apple devices, Ctrl+K elsewhere. */
	const apple = isApplePlatform();
	const paletteShortcut = apple ? '⌘K' : 'Ctrl K';

	/** A place from the More menu: Archive or Trash, which the tab bar leaves out. */
	function goToPlace(view: 'archive' | 'trash') {
		const target = pathForView(view);
		if (!target) return;
		closeNote();
		uiStore.setView(view);
		void goto(target);
	}

	function openPairingLink() {
		const found = pairingCodeFromUrl(window.location.href);
		if (!found) return;
		pairingCode = found;
		settingsOpen = false;
		uiStore.syncOpen = true;
		void goto(resolve(''), { replace: true, reset: false });
	}

	onMount(openPairingLink);

	// Pairing (with its QR scanner), backup encryption and Keep import load when
	// first used, keeping them out of the first page load.
	const loadSyncModal = () => loadLazyModule(() => import('./SyncModal.svelte'));
	const loadBackupCrypto = () => loadLazyModule(() => import('#lib/backupCrypto.js'));
	const loadKeepImport = () => loadLazyModule(() => import('#lib/keepImport.js'));

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
				const { encryptBackup } = await loadBackupCrypto();
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
				const { decryptBackup } = await loadBackupCrypto();
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
		// The import belongs to the open workspace, so it cannot start mid-switch.
		if (profileCoordinator.switching) {
			backupImportError = 'A workspace change is still running. Try again when it finishes.';
			return;
		}
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
			const { isZipBytes, readKeepTakeout, unzipKeepTakeout } = await loadKeepImport();
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
			const { isEncryptedScrapsCacheBackup } = await loadBackupCrypto();
			if (!isEncryptedScrapsCacheBackup(data))
				throw new Error('This is not a Scraps Cache backup or Google Keep Takeout.');
			pendingEncryptedBackup = data;
			pendingKeepFiles = null;
			keepImportReady = false;
			backupDialogMode = BackupOperation.Import;
			showingImportGuide = false;
			settingsOpen = false;
		} catch (err) {
			backupImportError = err instanceof Error ? err.message : 'Could not read that file.';
		} finally {
			importingBackup = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (
			(apple ? e.metaKey : e.ctrlKey) &&
			!e.altKey &&
			!e.shiftKey &&
			e.key.toLowerCase() === 'k'
		) {
			e.preventDefault();
			uiStore.paletteOpen = !uiStore.paletteOpen;
			return;
		}
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
	const clearButton = cx(
		iconButton({ variant: 'ghost', size: 'xs' }),
		css({
			h: '1.5rem',
			w: '1.5rem',
			minH: 0,
			flexShrink: 0,
			appearance: 'none',
			color: 'scrapscache.textMuted'
		})
	);
</script>

{#snippet searchBox()}
	<div
		role="search"
		class={hstack({
			h: '2.5rem',
			minH: '2.5rem',
			maxH: '2.5rem',
			minW: 0,
			flex: '1',
			rounded: 'pill',
			borderWidth: 'hairline',
			borderColor: 'scrapscache.border',
			bg: 'scrapscache.surface',
			px: { base: 'sm', sm: 'md' },
			gap: { base: 'xs', sm: 'sm' }
		})}
	>
		<Search class={cx(iconSm, styles.searchIcon)} aria-hidden="true" />
		<input
			bind:this={searchField}
			value={uiStore.searchInput}
			oninput={(event) => uiStore.setSearchInput(event.currentTarget.value)}
			type="search"
			placeholder="Search"
			aria-label="Search notes"
			class={cx(input({ variant: 'unstyled' }), styles.searchInput)}
		/>
		{#if uiStore.searchInput}
			<!-- The button goes with the query, so focus moves back to the field rather than the page. -->
			<button
				type="button"
				class={clearButton}
				onclick={() => {
					uiStore.clearSearch();
					searchField?.focus();
				}}
				aria-label="Clear search"
			>
				<X class={iconSm} aria-hidden="true" />
			</button>
		{:else}
			<Tooltip content="Search notes, labels and actions">
				<button
					type="button"
					class={styles.paletteHint}
					onclick={() => (uiStore.paletteOpen = true)}
					aria-label="Search notes, labels and actions"
					aria-keyshortcuts={apple ? 'Meta+K' : 'Control+K'}
				>
					<kbd class={styles.paletteKbd}>{paletteShortcut}</kbd>
				</button>
			</Tooltip>
		{/if}
	</div>
{/snippet}

{#snippet syncButton()}
	<Tooltip content={syncControlLabel}>
		<button
			type="button"
			class={iconButton({ variant: 'ghost', size: { base: 'compact', sm: 'standard' } })}
			title={syncControlLabel}
			onclick={() => {
				pairingCode = '';
				settingsOpen = false;
				uiStore.syncOpen = true;
			}}
			aria-label={syncControlLabel}
			data-scrapscache-sync-control
		>
			<!-- The spin turns this span, not the icon: Safari treats a transform on
			     an svg root as its own user space, so the icon sat still there. -->
			<span
				class={[
					iconMd,
					styles.syncIcon,
					(notesStore.syncing || importingBackup) && 'scrapscache-sync-icon-active'
				]}
				data-scrapscache-sync-spinner
			>
				<Cloud
					class={[iconMd, syncTone[syncStatus]]}
					data-scrapscache-sync-icon
					aria-hidden="true"
				/>
			</span>
		</button>
	</Tooltip>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<header
	class={hstack({
		h: 'var(--app-topbar-height)',
		flexShrink: 0,
		px: { base: 'sm', sm: 'md' },
		gap: { base: '2xs', sm: 'sm' },
		position: 'relative',
		zIndex: 20
	})}
	onpointerdown={closeNote}
>
	{#if selectionStore.active}
		<!-- The bar works on the picked notes until the selection is let go. -->
		<SelectionBar />
	{:else if mobile.current}
		<!-- A phone has the tab bar for its places: the bar names the view, and the
		     Search tab opens the palette. Labels, Archive and Trash sit under More. -->
		<span class={styles.title} aria-hidden="true" data-view-title>{viewTitle}</span>
		{@render syncButton()}
		<SettingsMenu
			phone
			bind:open={settingsOpen}
			onExport={startBackupExport}
			onImport={startBackupImport}
			importing={importingBackup}
			importError={backupImportError}
			onPlace={goToPlace}
			onLabels={() => (uiStore.sidebarOpen = true)}
		/>
	{:else}
		<Tooltip content="Toggle sidebar">
			<button
				class={iconButton({ variant: 'ghost', size: { base: 'compact', sm: 'standard' } })}
				title="Toggle sidebar"
				onclick={() => uiStore.toggleSidebar()}
				aria-label="Toggle sidebar"
			>
				<MenuIcon class={iconMd} aria-hidden="true" />
			</button>
		</Tooltip>
		{@render searchBox()}
		{@render syncButton()}
		<SettingsMenu
			bind:open={settingsOpen}
			onExport={startBackupExport}
			onImport={startBackupImport}
			importing={importingBackup}
			importError={backupImportError}
		/>
	{/if}
</header>

<svelte:window
	onkeydown={handleKeydown}
	onhashchange={openPairingLink}
	onpageshow={openPairingLink}
	onfocus={openPairingLink}
	onpopstate={openPairingLink}
/>
<svelte:document onvisibilitychange={openPairingLink} />

{#if uiStore.paletteOpen}
	<CommandPalette onClose={() => (uiStore.paletteOpen = false)} onBackup={startBackupExport} />
{/if}

{#if uiStore.syncOpen}
	{#await loadSyncModal() then { default: SyncModal }}
		{#key pairingCode}
			<SyncModal
				initialPairingCode={pairingCode}
				onClose={() => {
					uiStore.syncOpen = false;
					pairingCode = '';
				}}
			/>
		{/key}
	{:catch cause}
		<SyncModalUnavailable
			message={cause instanceof Error ? cause.message : 'Could not open sync settings.'}
			onClose={() => {
				uiStore.syncOpen = false;
				pairingCode = '';
			}}
		/>
	{/await}
{/if}

<ImportGuideDialog
	open={showingImportGuide}
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

<BackupImportModeDialog
	open={choosingImportMode}
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

<BackupPassphraseDialog
	open={backupDialogMode !== null}
	mode={backupDialogMode ?? BackupOperation.Export}
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
