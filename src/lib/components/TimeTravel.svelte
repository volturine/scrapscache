<script lang="ts">
	import { historyStyles as styles } from '$panda/styles';
	import { button, iconButton } from 'styled-system/recipes';
	import { onMount, tick } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { AlignJustify, Pin, PinOff, X } from '@lucide/svelte';
	import { loadNoteHistory, hydrateHistoryNote, type NoteHistoryEntry } from '$lib/historyClient';
	import type { Note } from '$lib/types';
	import { syncStore, type SyncAccount } from '$lib/stores/sync.svelte';

	let {
		account,
		noteId,
		onPreviewVersion
	}: {
		account: SyncAccount;
		noteId: string;
		onPreviewVersion: (note: Note, entry: NoteHistoryEntry) => void;
	} = $props();
	let entries = $state.raw<NoteHistoryEntry[]>([]);
	let nextBefore = $state<number | null | undefined>(undefined);
	let selected = $state<NoteHistoryEntry | null>(null);
	let previewLoading = $state(false);
	let loading = $state(false);
	let error = $state('');
	let canHover = $state(false);
	let hovering = $state(false);
	let focused = $state(false);
	let pinned = $state(false);
	let touchOpen = $state(false);
	let dismissed = $state(false);
	let pointerInteracting = false;
	let panelOpen = $derived(!dismissed && (focused || (canHover ? hovering || pinned : touchOpen)));
	let transferringFocus = false;
	let panelElement: HTMLElement | null = null;

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
		dismissed = false;
		hovering = true;
	}

	function handlePointerDown(event: PointerEvent) {
		if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
		pointerInteracting = true;
		if (focused) focused = false;
	}

	function handlePointerLeave(event: PointerEvent) {
		if (!canHover || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')) return;
		hovering = false;
		pointerInteracting = false;
		dismissed = false;
	}

	function handleFocusOut(event: FocusEvent) {
		if (transferringFocus) return;
		if (!focused) return;
		if (event.currentTarget instanceof HTMLElement && event.relatedTarget instanceof Node) {
			if (event.currentTarget.contains(event.relatedTarget)) return;
		}
		focused = false;
	}

	function handleFocusIn(event: FocusEvent) {
		if (pointerInteracting || transferringFocus) return;
		dismissed = false;
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

	function closePanel() {
		const returnFocus =
			panelElement instanceof HTMLElement && panelElement.contains(document.activeElement);
		pinned = false;
		hovering = false;
		focused = false;
		touchOpen = false;
		dismissed = true;
		if (returnFocus) {
			transferringFocus = true;
			void tick().then(() => {
				panelElement?.querySelector<HTMLButtonElement>('[data-history-pin]')?.focus();
				transferringFocus = false;
			});
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !panelOpen) return;
		event.preventDefault();
		event.stopPropagation();
		closePanel();
	}

	const attachPanelInteractions: Attachment<HTMLElement> = (panel) => {
		panelElement = panel;
		const onPointerUp = () => (pointerInteracting = false);
		panel.addEventListener('pointerenter', handlePointerEnter);
		panel.addEventListener('pointerleave', handlePointerLeave);
		panel.addEventListener('pointerdown', handlePointerDown);
		panel.addEventListener('pointerup', onPointerUp);
		panel.addEventListener('pointercancel', onPointerUp);
		panel.addEventListener('focusin', handleFocusIn);
		panel.addEventListener('focusout', handleFocusOut);
		panel.addEventListener('keydown', handleKeyDown);
		return () => {
			panelElement = null;
			panel.removeEventListener('pointerenter', handlePointerEnter);
			panel.removeEventListener('pointerleave', handlePointerLeave);
			panel.removeEventListener('pointerdown', handlePointerDown);
			panel.removeEventListener('pointerup', onPointerUp);
			panel.removeEventListener('pointercancel', onPointerUp);
			panel.removeEventListener('focusin', handleFocusIn);
			panel.removeEventListener('focusout', handleFocusOut);
			panel.removeEventListener('keydown', handleKeyDown);
		};
	};

	async function openPreview(entry: NoteHistoryEntry) {
		selected = entry;
		previewLoading = true;
		error = '';
		try {
			const note = await hydrateHistoryNote(account, entry);
			if (currentAccount() && selected?.historyId === entry.historyId) {
				onPreviewVersion(note, entry);
				if (!canHover) closePanel();
			}
		} catch (cause) {
			if (selected?.historyId === entry.historyId)
				error = cause instanceof Error ? cause.message : 'Could not load this note version.';
		} finally {
			if (selected?.historyId === entry.historyId) previewLoading = false;
		}
	}
</script>

<aside
	id="note-history-panel"
	class={styles.panel({ open: panelOpen })}
	aria-label="Note history"
	data-editor-popup
	data-open={panelOpen}
	{@attach attachPanelInteractions}
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
					onclick={closePanel}
					aria-label="Close note history"
					title="Close note history"
				>
					<X size={18} aria-hidden="true" />
				</button>
			</div>
		</header>
	{:else}
		<div class={styles.rail}>
			<button
				type="button"
				class={styles.railButton}
				data-history-pin
				onclick={() => {
					if (canHover) pinned = !pinned;
					else touchOpen = !touchOpen;
					dismissed = false;
				}}
				aria-label={canHover
					? pinned
						? 'Unpin note history'
						: 'Pin note history open'
					: 'Toggle note history'}
				aria-pressed={canHover ? pinned : touchOpen}
				aria-expanded={panelOpen}
				aria-controls="note-history-content"
				title={canHover ? 'Pin note history open' : 'Show note history dates'}
			>
				<AlignJustify size={18} aria-hidden="true" />
			</button>
		</div>
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
				{#if previewLoading}<p class={styles.previewMeta} role="status">
						Loading this version…
					</p>{/if}
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
		{/if}
	</div>
</aside>
