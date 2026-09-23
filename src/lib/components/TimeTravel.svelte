<script lang="ts">
	import { historyStyles as styles } from '$panda/styles';
	import { button, iconButton } from 'styled-system/recipes';
	import { onMount } from 'svelte';
	import { X } from '@lucide/svelte';
	import { loadNoteHistory, hydrateHistoryNote, type NoteHistoryEntry } from '$lib/historyClient';
	import type { Note } from '$lib/types';
	import { syncStore, type SyncAccount } from '$lib/stores/sync.svelte';

	let {
		account,
		noteId,
		expanded = false,
		onClose,
		onRestoreVersion
	}: {
		account: SyncAccount;
		noteId: string;
		expanded?: boolean;
		onClose: () => void;
		onRestoreVersion: (note: Note) => Promise<void>;
	} = $props();
	let entries = $state.raw<NoteHistoryEntry[]>([]);
	let nextBefore = $state<number | null | undefined>(undefined);
	let selected = $state<NoteHistoryEntry | null>(null);
	let previewNote = $state.raw<Note | null>(null);
	let previewLoading = $state(false);
	let loading = $state(false);
	let restoring = $state(false);
	let error = $state('');

	function currentAccount(): boolean {
		return syncStore.account?.accountId === account.accountId;
	}

	async function loadMore() {
		if (loading || nextBefore === null || !currentAccount()) return;
		loading = true;
		error = '';
		try {
			const page = await loadNoteHistory(account, noteId, nextBefore);
			if (!currentAccount()) return;
			entries = [...entries, ...page.entries.filter((entry) => entry.note.id === noteId)];
			nextBefore = page.nextBefore;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not load note history.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void loadMore();
	});

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

	async function restoreVersion() {
		if (!previewNote || restoring || !currentAccount()) return;
		restoring = true;
		error = '';
		try {
			await onRestoreVersion(previewNote);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not restore this version.';
		} finally {
			restoring = false;
		}
	}
</script>

<aside class={styles.panel({ expanded })} aria-label="Note history" data-editor-popup>
	<header class={styles.panelHeader}>
		<div>
			<h2 class={styles.panelTitle}>Note history</h2>
			<p class={styles.previewMeta}>Up to 30 days</p>
		</div>
		<button
			type="button"
			class={iconButton({ variant: 'ghost', size: 'sm' })}
			onclick={onClose}
			disabled={restoring}
			aria-label="Close note history"
		>
			<X size={18} aria-hidden="true" />
		</button>
	</header>

	<div class={['scrollable', styles.list]} aria-label="Saved versions">
		{#each entries as entry (entry.historyId)}
			<button
				type="button"
				class={[styles.entry, selected?.historyId === entry.historyId && styles.entrySelected]}
				onclick={() => void openPreview(entry)}
				aria-pressed={selected?.historyId === entry.historyId}
			>
				<span class={styles.entryTitle}>{entry.note.title || 'Untitled note'}</span>
				<span class={styles.date}>{new Date(entry.savedAt).toLocaleString()}</span>
			</button>
		{/each}
		{#if !loading && entries.length === 0 && nextBefore === null}
			<p class={styles.empty}>Earlier versions appear here after this synced note changes.</p>
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

	{#if error}<p class={styles.empty} role="alert">{error}</p>{/if}
	{#if selected}
		<section class={styles.preview} aria-label="Version preview">
			<div>
				<h3 class={styles.previewTitle}>{selected.note.title || 'Untitled note'}</h3>
				<p class={styles.previewMeta}>Saved {new Date(selected.savedAt).toLocaleString()}</p>
			</div>
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
						{:else}
							<span class={styles.previewMeta}>{image.name || 'Attachment'}</span>
						{/if}
					{/each}
				</div>
			{/if}
			<div class={styles.previewActions}>
				<button
					type="button"
					class={button({ variant: 'primary', size: 'sm' })}
					onclick={() => void restoreVersion()}
					disabled={restoring || !previewNote}
				>
					{restoring ? 'Restoring…' : 'Restore this version'}
				</button>
			</div>
		</section>
	{:else if entries.length > 0}
		<p class={styles.empty}>Select a version to preview it before restoring.</p>
	{/if}
</aside>
