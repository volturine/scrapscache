<script lang="ts">
	import { historyStyles as styles } from '$panda/styles';
	import { button, iconButton } from 'styled-system/recipes';
	import { onMount, tick } from 'svelte';
	import { History, Pin, PinOff, X } from '@lucide/svelte';
	import { loadNoteHistory, hydrateHistoryNote, type NoteHistoryEntry } from '$lib/historyClient';
	import type { Note } from '$lib/types';
	import { syncStore, type SyncAccount } from '$lib/stores/sync.svelte';

	let {
		account,
		noteId,
		onClose,
		onRestoreVersion
	}: {
		account: SyncAccount;
		noteId: string;
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
	let canHover = $state(false);
	let hovering = $state(false);
	let focused = $state(false);
	let pinned = $state(false);
	let pointerInteracting = false;
	let panelOpen = $derived(!canHover || hovering || focused || pinned);
	let transferringFocus = false;

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
		const hoverMedia = window.matchMedia('(hover: hover) and (pointer: fine)');
		const updateHover = () => (canHover = hoverMedia.matches);
		updateHover();
		hoverMedia.addEventListener('change', updateHover);
		void loadMore();
		return () => hoverMedia.removeEventListener('change', updateHover);
	});

	function handlePointerEnter(event: PointerEvent) {
		if (!canHover || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')) return;
		hovering = true;
	}

	function handlePointerDown(event: PointerEvent) {
		if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
		pointerInteracting = true;
		focused = false;
	}

	function handlePointerLeave(event: PointerEvent) {
		if (!canHover || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')) return;
		hovering = false;
		pointerInteracting = false;
	}

	function handleFocusOut(event: FocusEvent) {
		if (transferringFocus) return;
		if (event.currentTarget instanceof HTMLElement && event.relatedTarget instanceof Node) {
			if (event.currentTarget.contains(event.relatedTarget)) return;
		}
		focused = false;
	}

	function handleFocusIn(event: FocusEvent) {
		if (pointerInteracting) return;
		const wasOpen = panelOpen;
		focused = true;
		if (!wasOpen && event.currentTarget instanceof HTMLElement) {
			const panel = event.currentTarget;
			transferringFocus = true;
			void tick().then(() => {
				panel.querySelector<HTMLButtonElement>('[data-history-pin]')?.focus();
				transferringFocus = false;
			});
		}
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

<aside
	id="note-history-panel"
	class={styles.panel({ open: panelOpen })}
	aria-label="Note history"
	data-editor-popup
	data-open={panelOpen}
	onpointerenter={handlePointerEnter}
	onpointerleave={handlePointerLeave}
	onpointerdown={handlePointerDown}
	onpointerup={() => (pointerInteracting = false)}
	onpointercancel={() => (pointerInteracting = false)}
	onfocusin={handleFocusIn}
	onfocusout={handleFocusOut}
>
	{#if panelOpen}
		<header class={styles.panelHeader({ open: true })}>
			<div>
				<h2 class={styles.panelTitle}>Note history</h2>
				<p class={styles.previewMeta}>Up to 30 days</p>
			</div>
			<div class={styles.panelActions}>
				<button
					type="button"
					class={iconButton({ variant: 'ghost', size: 'sm' })}
					data-history-pin
					onclick={() => (pinned = !pinned)}
					disabled={restoring}
					aria-label={pinned ? 'Unpin note history' : 'Pin note history open'}
					aria-pressed={pinned}
					title={pinned ? 'Unpin history' : 'Pin history open'}
				>
					{#if pinned}
						<Pin size={18} fill="currentColor" aria-hidden="true" />
					{:else}
						<PinOff size={18} aria-hidden="true" />
					{/if}
				</button>
				<button
					type="button"
					class={iconButton({ variant: 'ghost', size: 'sm' })}
					onclick={onClose}
					disabled={restoring}
					aria-label="Close note history"
					title="Close note history"
				>
					<X size={18} aria-hidden="true" />
				</button>
			</div>
		</header>
	{:else}
		<header class={styles.panelHeader({ open: false })}>
			<button
				type="button"
				class={iconButton({ variant: 'ghost', size: 'sm' })}
				onclick={() => (pinned = true)}
				aria-label="Expand note history and pin it open"
				aria-expanded={panelOpen}
				aria-controls="note-history-content"
				title="Expand note history"
			>
				<History size={18} aria-hidden="true" />
			</button>
		</header>
	{/if}

	<div
		id="note-history-content"
		class={styles.panelContent({ open: panelOpen })}
		aria-hidden={!panelOpen}
	>
		{#if panelOpen}
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
		{/if}
	</div>
</aside>
