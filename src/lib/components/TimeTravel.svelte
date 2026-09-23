<script lang="ts">
	import { historyStyles as styles } from '$panda/styles';
	import { Swap } from '@ark-ui/svelte/swap';
	import { ChevronLeft, ChevronRight, X } from '@lucide/svelte';
	import { onMount, tick } from 'svelte';
	import { button, iconButton } from 'styled-system/recipes';
	import { appClock } from '$lib/appClock.svelte';
	import { loadNoteHistory, hydrateHistoryNote, type NoteHistoryEntry } from '$lib/historyClient';
	import {
		describeNoteVersionChange,
		distinctNoteVersions,
		sameVisibleNote,
		type NoteVersionChange
	} from '$lib/noteVersionChange';
	import type { Note } from '$lib/types';
	import { formatActivityRelative } from '$lib/utils';
	import { syncStore, type SyncAccount } from '$lib/stores/sync.svelte';

	let {
		account,
		note,
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
		note: Note;
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

	type Row = { entry: NoteHistoryEntry | null; change: NoteVersionChange | null };

	const MAX_TICKS = 24;
	const CLOSE_DELAY_MS = 160;

	let entries = $state.raw<NoteHistoryEntry[]>([]);
	let nextBefore = $state<number | null | undefined>(undefined);
	let loading = $state(false);
	let openingId = $state<number | null>(null);
	let error = $state('');
	let hovered = $state(false);
	let pinned = $state(false);
	let rail = $state<HTMLElement | null>(null);
	let trigger = $state<HTMLButtonElement | null>(null);
	let list = $state<HTMLElement | null>(null);
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	let lastPointerType = '';
	let openRequest = 0;

	const versions = $derived(distinctNoteVersions(entries));
	// Row 0 is the live note: its newest save, or "Now" while local edits have not synced.
	const unsynced = $derived(!versions[0] || !sameVisibleNote(versions[0].note, note));
	const rows = $derived<Row[]>([
		...(unsynced ? [{ entry: null, change: null }] : []),
		...versions.map((entry, index) => ({
			entry,
			change: describeNoteVersionChange(entry.note, versions[index + 1]?.note)
		}))
	]);
	const activeRow = $derived(
		previewEntry ? rows.findIndex((row) => row.entry?.historyId === previewEntry.historyId) : 0
	);
	const expanded = $derived(hovered || pinned);
	const visible = $derived(versions.length > 0 || !!error);
	const tickWidths = $derived(
		rows.map(({ change }) => (change ? 6 + Math.min(4, change.added + change.removed) * 3 : 12))
	);
	const tickStart = $derived(
		Math.max(0, Math.min(activeRow - MAX_TICKS / 2, tickWidths.length - MAX_TICKS))
	);
	const ticks = $derived(
		tickWidths.map((width, row) => ({ width, row })).slice(tickStart, tickStart + MAX_TICKS)
	);
	const extraRows = $derived((nextBefore !== null ? 1 : 0) + (error ? 1 : 0));

	function currentAccount(): boolean {
		return syncStore.account?.accountId === account.accountId;
	}

	// Saves are often seconds apart, so the exact time keeps them distinguishable.
	function exact(at: number): string {
		return new Date(at).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function relative(at: number): string {
		const label = formatActivityRelative(at, appClock.now);
		return label === 'just now' ? 'Just now' : label;
	}

	async function loadMore() {
		if (loading || nextBefore === null || !currentAccount()) return;
		loading = true;
		error = '';
		try {
			const page = await loadNoteHistory(account, note.id, nextBefore);
			if (!currentAccount()) return;
			entries = [...entries, ...page.entries.filter((entry) => entry.note.id === note.id)];
			nextBefore = page.nextBefore;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not load note history.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void loadMore();
		return () => clearTimeout(closeTimer);
	});

	// Touch has no hover, so a tap pins the panel open until the next tap elsewhere.
	$effect(() => {
		if (!pinned) return;
		const dismiss = (event: PointerEvent) => {
			if (!(event.target instanceof Node) || !rail?.contains(event.target)) pinned = false;
		};
		document.addEventListener('pointerdown', dismiss, true);
		return () => document.removeEventListener('pointerdown', dismiss, true);
	});

	// Keep keyboard focus on a control that stays visible when the panel collapses.
	$effect(() => {
		if (expanded || !rail?.contains(document.activeElement) || document.activeElement === trigger)
			return;
		void tick().then(() => trigger?.focus({ preventScroll: true }));
	});

	function rowButtons(): HTMLButtonElement[] {
		return [...(list?.querySelectorAll<HTMLButtonElement>('[data-history-row]') ?? [])];
	}

	async function expandFromTrigger() {
		pinned = true;
		if (lastPointerType === 'mouse') return;
		await tick();
		const rows = rowButtons();
		(rows[activeRow] ?? rows[0])?.focus({ preventScroll: true });
		rows[activeRow]?.scrollIntoView({ block: 'nearest' });
	}

	function handleListKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape' && expanded) {
			event.stopPropagation();
			clearTimeout(closeTimer);
			hovered = false;
			pinned = false;
			return;
		}
		const rows = rowButtons();
		const index = rows.indexOf(document.activeElement as HTMLButtonElement);
		if (index < 0) return;
		const target =
			event.key === 'ArrowDown'
				? rows[Math.min(index + 1, rows.length - 1)]
				: event.key === 'ArrowUp'
					? rows[Math.max(index - 1, 0)]
					: event.key === 'Home'
						? rows[0]
						: event.key === 'End'
							? rows[rows.length - 1]
							: null;
		if (!target) return;
		event.preventDefault();
		target.focus();
		target.scrollIntoView({ block: 'nearest' });
	}

	async function openVersion(entry: NoteHistoryEntry) {
		const request = ++openRequest;
		openingId = entry.historyId;
		error = '';
		try {
			const version = await hydrateHistoryNote(account, entry);
			if (request !== openRequest || !currentAccount()) return;
			onPreviewVersion(version, entry);
		} catch (cause) {
			if (request === openRequest)
				error = cause instanceof Error ? cause.message : 'Could not load this note version.';
		} finally {
			if (request === openRequest) openingId = null;
		}
	}

	function selectRow(index: number) {
		if (lastPointerType === 'touch') pinned = false;
		const entry = rows[index]?.entry;
		if (index === 0 || !entry) {
			openRequest++;
			openingId = null;
			if (previewEntry) onCancelPreview();
			return;
		}
		if (entry.historyId !== previewEntry?.historyId) void openVersion(entry);
	}

	async function stepOlder() {
		if (activeRow === rows.length - 1) await loadMore();
		const next = rows[activeRow + 1]?.entry;
		if (next) void openVersion(next);
	}

	function stepNewer() {
		selectRow(activeRow - 1);
	}
</script>

{#snippet stats(added: number, removed: number)}
	{#if added || removed}
		<span class={styles.rowStats}>
			{#if added}<span class={styles.added}>+{added}</span>{/if}
			{#if removed}<span class={styles.removed}>−{removed}</span>{/if}
		</span>
	{/if}
{/snippet}

{#if visible}
	<nav
		bind:this={rail}
		class={styles.rail}
		aria-label="Note version history"
		data-editor-popup
		data-expanded={expanded || undefined}
		style:--history-ticks={ticks.length}
		style:--history-rows={rows.length + extraRows}
		onpointerdown={(event) => (lastPointerType = event.pointerType)}
		onpointerenter={(event) => {
			if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
			clearTimeout(closeTimer);
			hovered = true;
		}}
		onpointerleave={(event) => {
			if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
			clearTimeout(closeTimer);
			closeTimer = setTimeout(() => (hovered = false), CLOSE_DELAY_MS);
		}}
		onfocusout={(event) => {
			if (!(event.relatedTarget instanceof Node) || !rail?.contains(event.relatedTarget))
				pinned = false;
		}}
	>
		<Swap.Root swap={expanded} class={styles.swap}>
			<Swap.Indicator type="off" class={styles.ticksLayer}>
				<button
					bind:this={trigger}
					type="button"
					class={styles.trigger}
					aria-label={`Version history, ${versions.length} saved ${versions.length === 1 ? 'version' : 'versions'}`}
					aria-expanded={expanded}
					aria-controls="note-history-versions"
					onclick={() => void expandFromTrigger()}
				>
					{#each ticks as mark (mark.row)}
						<span
							class={styles.tick}
							style:width="{mark.width}px"
							data-active={mark.row === activeRow || undefined}
							aria-hidden="true"
						></span>
					{/each}
				</button>
			</Swap.Indicator>
			<Swap.Indicator type="on" class={styles.panelLayer}>
				<div class={styles.panel}>
					<div class={styles.panelHeader}>
						<span>History</span>
						<span class={styles.panelCount}
							>{versions.length}{nextBefore === null ? '' : '+'}
							{versions.length === 1 ? 'version' : 'versions'}</span
						>
					</div>
					<div
						id="note-history-versions"
						class={['scrollable note-scrollbar-hidden', styles.list]}
						role="toolbar"
						aria-orientation="vertical"
						aria-label="Saved versions"
						tabindex="-1"
						bind:this={list}
						onkeydown={handleListKeyDown}
					>
						{#each rows as row, index (row.entry?.historyId ?? 'now')}
							<button
								type="button"
								class={styles.row}
								data-history-row
								data-loading={(row.entry && openingId === row.entry.historyId) || undefined}
								aria-current={activeRow === index ? 'true' : undefined}
								title={row.entry ? exact(row.entry.savedAt) : undefined}
								onclick={() => selectRow(index)}
							>
								<span class={styles.rowTop}>
									<span class={styles.rowLabel}>
										<span class={styles.rowTime}
											>{row.entry ? relative(row.entry.savedAt) : 'Now'}</span
										>
										{#if index === 0 && row.entry}
											<span class={styles.rowBadge}>Current</span>
										{/if}
									</span>
									{#if row.change}{@render stats(row.change.added, row.change.removed)}{/if}
								</span>
								<span class={styles.rowSummary}>{row.change?.summary ?? 'Not synced yet'}</span>
							</button>
						{/each}
						{#if nextBefore !== null}
							<button
								type="button"
								class={styles.more}
								onclick={() => void loadMore()}
								disabled={loading}
							>
								{loading ? 'Loading…' : 'Load older versions'}
							</button>
						{/if}
						{#if error}
							<p class={styles.message} role="alert">{error}</p>
						{/if}
					</div>
				</div>
			</Swap.Indicator>
		</Swap.Root>
	</nav>
{/if}

{#if previewEntry}
	<div class={styles.bar} role="group" aria-label="Time travel" data-editor-popup>
		<button
			type="button"
			class={iconButton({ variant: 'ghost', size: 'compact' })}
			aria-label="Older version"
			title="Older version"
			onclick={() => void stepOlder()}
			disabled={restoringPreview ||
				(activeRow >= rows.length - 1 && nextBefore === null) ||
				loading}
		>
			<ChevronLeft size={18} aria-hidden="true" />
		</button>
		{#key previewEntry.historyId}
			<div class={styles.barLabel} aria-live="polite">
				<span class={styles.barTime}>{relative(previewEntry.savedAt)}</span>
				<span class={styles.barDate}>{exact(previewEntry.savedAt)}</span>
			</div>
		{/key}
		<button
			type="button"
			class={iconButton({ variant: 'ghost', size: 'compact' })}
			aria-label={activeRow <= 1 ? 'Back to current note' : 'Newer version'}
			title={activeRow <= 1 ? 'Back to current note' : 'Newer version'}
			onclick={stepNewer}
			disabled={restoringPreview}
		>
			<ChevronRight size={18} aria-hidden="true" />
		</button>
		<span class={styles.barDivider} aria-hidden="true"></span>
		{#if restoreConfirmOpen}
			<span class={styles.barPrompt}>Replace the current note?</span>
			<button
				type="button"
				class={[button({ variant: 'quiet', size: 'xs' }), styles.barAction]}
				onclick={onCancelRestore}
				disabled={restoringPreview}>Cancel</button
			>
			<button
				type="button"
				class={[button({ variant: 'primary', size: 'xs' }), styles.barAction]}
				data-history-restore-action="confirm"
				onclick={onConfirmRestore}
				disabled={restoringPreview}>{restoringPreview ? 'Restoring…' : 'Restore'}</button
			>
		{:else}
			<button
				type="button"
				class={[button({ variant: 'primary', size: 'xs' }), styles.barAction]}
				data-history-restore-action="start"
				onclick={onStartRestore}
				disabled={openingId !== null}>Restore</button
			>
			<button
				type="button"
				class={iconButton({ variant: 'ghost', size: 'compact' })}
				aria-label="Close time travel"
				title="Close time travel"
				onclick={onCancelPreview}
			>
				<X size={18} aria-hidden="true" />
			</button>
		{/if}
		{#if restoreError}<p class={styles.barError} role="alert">{restoreError}</p>{/if}
	</div>
{/if}
