<script lang="ts">
	import { historyStyles as styles } from '$panda/styles';
	import { ChevronLeft, ChevronRight, X } from '@lucide/svelte';
	import { onMount, tick } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { scale } from 'svelte/transition';
	import { loadNoteHistory, hydrateHistoryNote, type NoteHistoryEntry } from '$lib/historyClient';
	import type { Note } from '$lib/types';
	import { syncStore, type SyncAccount } from '$lib/stores/sync.svelte';

	let {
		account,
		noteId,
		previewEntry,
		restoreConfirmOpen,
		restoringPreview,
		restoreError,
		onPreviewVersion,
		onCancelPreview,
		onStartRestore,
		onCancelRestore,
		onConfirmRestore
	}: {
		account: SyncAccount;
		noteId: string;
		previewEntry: NoteHistoryEntry | null;
		restoreConfirmOpen: boolean;
		restoringPreview: boolean;
		restoreError: string;
		onPreviewVersion: (note: Note, entry: NoteHistoryEntry) => void;
		onCancelPreview: () => void;
		onStartRestore: () => void;
		onCancelRestore: () => void;
		onConfirmRestore: () => void;
	} = $props();

	let entries = $state.raw<NoteHistoryEntry[]>([]);
	let nextBefore = $state<number | null | undefined>(undefined);
	let loading = $state(false);
	let previewLoading = $state(false);
	let error = $state('');
	let hovering = $state(false);
	let focused = $state(false);
	let toggled = $state(false);
	let dismissed = $state(false);
	let pointerFocusing = false;
	let trigger: HTMLButtonElement | null = null;
	let picker = $state<HTMLElement | null>(null);
	const open = $derived(!dismissed && (hovering || focused || toggled));
	const selectedIndex = $derived(
		previewEntry ? entries.findIndex((entry) => entry.historyId === previewEntry.historyId) : -1
	);

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

	function closePicker(returnFocus = false) {
		dismissed = true;
		toggled = false;
		focused = false;
		if (returnFocus) void tick().then(() => trigger?.focus());
	}

	function handleFocusOut(event: FocusEvent) {
		const next = event.relatedTarget;
		queueMicrotask(() => {
			if (!picker?.isConnected || (next instanceof Node && picker.contains(next))) return;
			focused = false;
			toggled = false;
		});
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !open) return;
		event.stopPropagation();
		closePicker(true);
	}

	async function openPreview(entry: NoteHistoryEntry) {
		if (previewLoading) return;
		previewLoading = true;
		error = '';
		try {
			const note = await hydrateHistoryNote(account, entry);
			if (!currentAccount()) return;
			onPreviewVersion(note, entry);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not load this note version.';
		} finally {
			previewLoading = false;
		}
	}

	function travel(offset: number) {
		const next = entries[selectedIndex + offset];
		if (next) void openPreview(next);
	}
</script>

<div
	class={styles.anchor}
	role="toolbar"
	tabindex="-1"
	aria-label="Note version history"
	bind:this={picker}
	data-editor-popup
	onpointerenter={(event) => {
		if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
			dismissed = false;
			hovering = true;
		}
	}}
	onpointerleave={() => {
		hovering = false;
		dismissed = false;
	}}
	onpointerdown={() => (pointerFocusing = true)}
	onpointerup={() => (pointerFocusing = false)}
	onpointercancel={() => (pointerFocusing = false)}
	onfocusin={() => {
		if (pointerFocusing) return;
		dismissed = false;
		focused = true;
	}}
	onfocusout={handleFocusOut}
	onkeydown={handleKeyDown}
>
	<button
		bind:this={trigger}
		type="button"
		class={styles.marker}
		aria-label="Browse note versions"
		aria-expanded={open}
		aria-controls="note-history-dates"
		onclick={() => {
			dismissed = false;
			if (!hovering) toggled = !toggled;
		}}
	>
		{#each [0, 1, 2, 3, 4] as mark (mark)}
			<span class={styles.mark} aria-hidden="true"></span>
		{/each}
	</button>

	{#if open}
		<div
			id="note-history-dates"
			class={styles.picker}
			aria-label="Saved note versions"
			transition:scale={{
				duration: prefersReducedMotion.current ? 0 : 140,
				start: 0.94,
				opacity: 0.2
			}}
		>
			<div class={['scrollable', styles.list]}>
				{#each entries as entry (entry.historyId)}
					<button
						type="button"
						class={[
							styles.entry,
							previewEntry?.historyId === entry.historyId && styles.entrySelected
						]}
						aria-pressed={previewEntry?.historyId === entry.historyId}
						onclick={() => void openPreview(entry)}
						disabled={previewLoading}
					>
						{new Date(entry.savedAt).toLocaleString()}
					</button>
				{/each}
				{#if nextBefore !== null}
					<button
						type="button"
						class={styles.more}
						onclick={() => void loadMore()}
						disabled={loading}
					>
						{loading ? 'Loading…' : 'Older versions'}
					</button>
				{/if}
				{#if !loading && entries.length === 0 && nextBefore === null}
					<p class={styles.empty}>No saved versions yet</p>
				{/if}
			</div>
			{#if previewLoading}<p class={styles.status} role="status">Opening version…</p>{/if}
			{#if error}<p class={styles.status} role="alert">{error}</p>{/if}
		</div>
	{/if}
</div>

{#if previewEntry}
	<div class={styles.toolbar} data-editor-popup aria-label="Time travel controls">
		<div class={styles.stepper}>
			<button
				type="button"
				class={styles.iconAction}
				aria-label="Newer version"
				title="Newer version"
				onclick={() => travel(-1)}
				disabled={selectedIndex <= 0 || previewLoading || restoringPreview}
			>
				<ChevronLeft size={16} aria-hidden="true" />
			</button>
			<span class={styles.timestamp}>{new Date(previewEntry.savedAt).toLocaleString()}</span>
			<button
				type="button"
				class={styles.iconAction}
				aria-label="Older version"
				title="Older version"
				onclick={() => travel(1)}
				disabled={selectedIndex < 0 ||
					selectedIndex >= entries.length - 1 ||
					previewLoading ||
					restoringPreview}
			>
				<ChevronRight size={16} aria-hidden="true" />
			</button>
		</div>
		<div class={styles.actions}>
			{#if restoreConfirmOpen}
				<button
					type="button"
					class={styles.textAction}
					onclick={onCancelRestore}
					disabled={restoringPreview}>Back</button
				>
				<button
					type="button"
					class={styles.restoreAction}
					data-history-restore-action="confirm"
					onclick={onConfirmRestore}
					disabled={restoringPreview}>{restoringPreview ? 'Restoring…' : 'Confirm restore'}</button
				>
			{:else}
				<button
					type="button"
					class={styles.restoreAction}
					data-history-restore-action="start"
					onclick={onStartRestore}
					disabled={previewLoading}>Restore</button
				>
				<button
					type="button"
					class={styles.iconAction}
					aria-label="Cancel time travel"
					title="Cancel time travel"
					onclick={onCancelPreview}
					disabled={restoringPreview}
				>
					<X size={16} aria-hidden="true" />
				</button>
			{/if}
		</div>
		{#if restoreError}<p class={styles.toolbarError} role="alert">{restoreError}</p>{/if}
	</div>
{/if}
