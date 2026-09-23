<script lang="ts">
	import { historyStyles as styles, sidebarStyles } from '$panda/styles';
	import { button, dialog } from 'styled-system/recipes';
	import { onMount } from 'svelte';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { loadNoteHistory, hydrateHistoryNote, type NoteHistoryEntry } from '$lib/historyClient';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { BackupImportMode, prepareImportedNotes } from '$lib/backup';
	import type { Note } from '$lib/types';
	import { syncStore, type SyncAccount } from '$lib/stores/sync.svelte';

	let {
		account,
		noteId,
		onRestoreVersion
	}: { account: SyncAccount; noteId?: string; onRestoreVersion?: (note: Note) => Promise<void> } =
		$props();
	let entries = $state.raw<NoteHistoryEntry[]>([]);
	let nextBefore = $state<number | null | undefined>(undefined);
	let selected = $state<NoteHistoryEntry | null>(null);
	let previewNote = $state.raw<Note | null>(null);
	let previewLoading = $state(false);
	let loading = $state(false);
	let restoring = $state(false);
	let error = $state('');
	let info = $state('');
	const d = dialog({ size: 'sm' });
	function attachPreview(node: HTMLElement) {
		if (!noteId) return portalToAppOverlay(node);
	}

	function currentAccount(): boolean {
		return syncStore.account?.accountId === account.accountId;
	}

	async function loadMore() {
		if (loading || nextBefore === null || !currentAccount()) return;
		loading = true;
		error = '';
		try {
			const page = await loadNoteHistory(account, nextBefore, noteId);
			if (!currentAccount()) return;
			entries = [
				...entries,
				...page.entries.filter((entry) => !noteId || entry.note.id === noteId)
			];
			nextBefore = page.nextBefore;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not load sync history.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void loadMore();
	});

	function closePreview() {
		selected = null;
		previewNote = null;
	}

	async function openPreview(entry: NoteHistoryEntry) {
		selected = entry;
		previewNote = null;
		previewLoading = true;
		error = '';
		try {
			const note = await hydrateHistoryNote(account, entry);
			if (currentAccount() && selected?.historyId === entry.historyId) previewNote = note;
		} catch (cause) {
			if (selected?.historyId === entry.historyId)
				error = cause instanceof Error ? cause.message : 'Could not load this note version.';
		} finally {
			if (selected?.historyId === entry.historyId) previewLoading = false;
		}
	}

	async function restoreSelected() {
		if (!selected || !previewNote || restoring || !currentAccount()) return;
		restoring = true;
		error = '';
		try {
			const note = prepareImportedNotes([previewNote], BackupImportMode.Keep)[0];
			if (!currentAccount()) return;
			const availableLabels = new Set(notesStore.labels.map((label) => label.id));
			notesStore.createNote({
				...note,
				labels: note.labels.filter((id) => availableLabels.has(id))
			});
			closePreview();
			info = 'Restored as a new note. It will sync to your other devices.';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not restore this note.';
		} finally {
			restoring = false;
		}
	}

	async function restoreVersion() {
		if (!previewNote || !onRestoreVersion || restoring || !currentAccount()) return;
		restoring = true;
		error = '';
		try {
			await onRestoreVersion(previewNote);
			closePreview();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not restore this version.';
		} finally {
			restoring = false;
		}
	}
</script>

<section class={styles.root} aria-label="Sync history">
	<div class={styles.header}>{noteId ? 'Note history' : 'Time travel'} · up to 30 days</div>
	{#if error}<p class={styles.empty} role="alert">{error}</p>{/if}
	{#if info}<p class={styles.empty} role="status">{info}</p>{/if}
	<div class={['scrollable', styles.list]}>
		{#each entries as entry (entry.historyId)}
			<button
				type="button"
				class={styles.entry}
				onclick={() => void openPreview(entry)}
				aria-label={`Preview ${entry.note.title || 'Untitled note'} archived ${new Date(entry.savedAt).toLocaleString()}`}
			>
				<span class={styles.dot} aria-hidden="true"></span>
				<span class={styles.entryContent}>
					<span class={styles.title}>{entry.note.title || 'Untitled note'}</span>
					<span class={styles.date}>{new Date(entry.savedAt).toLocaleString()}</span>
				</span>
			</button>
		{/each}
		{#if !loading && entries.length === 0 && nextBefore === null}
			<p class={styles.empty}>
				Earlier versions will appear here after this note changes on a synced device.
			</p>
		{/if}
		{#if nextBefore !== null}
			<button
				type="button"
				class={button({ variant: 'ghost', size: 'sm' })}
				onclick={() => void loadMore()}
				disabled={loading}
			>
				{loading ? 'Loading history…' : 'Load older changes'}
			</button>
		{/if}
	</div>
</section>

{#if selected}
	<Dialog.Root
		open
		onOpenChange={(details) => {
			if (!details.open && !restoring) closePreview();
		}}
		preventScroll={false}
	>
		<div
			{@attach attachPreview}
			class={noteId ? styles.inlinePreviewPortal : sidebarStyles.dialogPortal}
			role="presentation"
		>
			<Dialog.Backdrop class={d.backdrop} />
			<Dialog.Positioner class={sidebarStyles.dialogPositioner}>
				<Dialog.Content class={d.panel} aria-describedby={undefined}>
					<Dialog.Title class={d.title}>{selected.note.title || 'Untitled note'}</Dialog.Title>
					<p class={styles.previewMeta}>
						Archived when this note changed on {new Date(selected.savedAt).toLocaleString()}
					</p>
					<div class={styles.previewBody}>{selected.note.body || 'This note has no text.'}</div>
					{#if previewLoading}<p class={styles.previewMeta}>Loading attachments…</p>{/if}
					{#if previewNote?.images?.length}
						<div class={styles.previewMedia}>
							{#each previewNote.images as image (image.id)}
								{#if image.mime.startsWith('image/')}
									<img
										class={styles.previewImage}
										src={image.dataUrl}
										alt={image.name || 'Note attachment'}
									/>
								{:else}<span class={styles.previewMeta}>{image.name || 'Attachment'}</span>{/if}
							{/each}
						</div>
					{/if}
					{#if error}<p class={styles.previewMeta} role="alert">{error}</p>{/if}
					<div class={d.footer}>
						<button
							type="button"
							class={button({ variant: 'ghost', size: 'sm' })}
							onclick={closePreview}
							disabled={restoring}>Close</button
						>
						<button
							type="button"
							class={button({ variant: 'secondary', size: 'sm' })}
							onclick={() => void restoreVersion()}
							disabled={restoring || !previewNote || !onRestoreVersion}
							hidden={!onRestoreVersion}>Restore this version</button
						>
						<button
							type="button"
							class={button({ variant: 'primary', size: 'sm' })}
							onclick={() => void restoreSelected()}
							disabled={restoring || !previewNote}
						>
							{restoring ? 'Restoring…' : 'Restore as new note'}
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	</Dialog.Root>
{/if}
