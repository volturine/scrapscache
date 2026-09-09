<script lang="ts">
	import { notesStore } from '$lib/stores/notes.svelte';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { NOTE_COLORS, NOTE_DARK_COLORS, type Note, type NoteColor } from '$lib/types';
	import { activateOnKeyboard, formatReminder, isReminderOverdue } from '$lib/utils';
	import { cardSwipeStyle, createCardSwipe } from '$lib/cardSwipe';
	import NoteBodyDisplay from './NoteBodyDisplay.svelte';
	import ReminderLabel from './ReminderLabel.svelte';
	import ReminderPicker from './ReminderPicker.svelte';
	import { noteToPlainText } from '$lib/checklistBody';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import {
		Archive,
		ArchiveRestore,
		Bell,
		Check,
		Copy,
		Pin,
		RotateCcw,
		Trash2
	} from '@lucide/svelte';
	import { onDestroy, onMount } from 'svelte';

	let {
		note,
		onOpen
	}: {
		note: Note;
		onOpen: (id: string) => void;
	} = $props();

	function bgColor(c: NoteColor): string {
		return uiStore.effectiveDark ? NOTE_DARK_COLORS[c] : NOTE_COLORS[c];
	}

	let cardEl = $state<HTMLDivElement | null>(null);
	let hazeActive = $state(false);
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;
	let reminderDialogOpen = $state(false);

	function closeHaze() {
		hazeActive = false;
	}

	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		hazeActive = true;
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('scrapscache-card-haze-open', { detail: note.id }));
		}
	}

	function handleDelete(e: MouseEvent) {
		e.stopPropagation();
		closeHaze();
		if (note.trashed) {
			void notesStore.deleteNoteForever(note.id);
		} else {
			notesStore.trashNote(note.id);
		}
	}

	function handleArchive(e: MouseEvent) {
		e.stopPropagation();
		closeHaze();
		notesStore.toggleArchive(note.id);
	}

	async function handleCopy(e: MouseEvent) {
		e.stopPropagation();
		const text = noteToPlainText(note);
		let ok = false;
		try {
			await navigator.clipboard.writeText(text);
			ok = true;
		} catch {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			try {
				ok = document.execCommand('copy');
			} catch {}
			document.body.removeChild(ta);
		}
		if (ok) {
			copied = true;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => {
				copied = false;
				copyTimer = null;
				closeHaze();
			}, 800);
		} else {
			closeHaze();
		}
	}

	function handlePin(e: MouseEvent) {
		e.stopPropagation();
		closeHaze();
		notesStore.togglePin(note.id);
	}

	function handleReminder(e: MouseEvent) {
		e.stopPropagation();
		closeHaze();
		reminderDialogOpen = true;
	}

	function openUnlessDrag(e: MouseEvent) {
		if (e.button !== 0) return;
		if (hazeActive) {
			e.stopPropagation();
			closeHaze();
			return;
		}
		if (swipe.wasDrag()) {
			e.stopPropagation();
			return;
		}
		onOpen(note.id);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (hazeActive) {
			if (event.key === 'Escape') {
				event.stopPropagation();
				event.preventDefault();
				closeHaze();
			}
			return;
		}
		activateOnKeyboard(event, () => onOpen(note.id));
	}

	const labelsForNote = $derived(
		note.labels
			.map((id) => notesStore.labelsById.get(id))
			.filter((l): l is NonNullable<typeof l> => !!l)
	);

	const openLabel = $derived.by(() => {
		const title = note.title || 'untitled note';
		if (note.reminder == null) return `Open ${title}`;
		const when = formatReminder(note.reminder);
		return isReminderOverdue(note.reminder)
			? `Open ${title}, overdue reminder ${when}`
			: `Open ${title}, reminder ${when}`;
	});

	let offsetX = $state(0);
	let dragging = $state(false);

	const swipe = createCardSwipe({
		onSwipeLeft: () => {
			if (note.trashed) notesStore.restoreNote(note.id);
			else notesStore.toggleArchive(note.id);
		},
		onSwipeRight: () => {
			if (note.trashed) void notesStore.deleteNoteForever(note.id);
			else notesStore.trashNote(note.id);
		},
		setVisual: (s) => {
			offsetX = s.offsetX;
			dragging = s.dragging;
		}
	});

	$effect(() => {
		if (!hazeActive) return;
		function onWindowPointerDown(e: PointerEvent) {
			if (cardEl && !cardEl.contains(e.target as Node)) {
				closeHaze();
			}
		}
		function onWindowKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.stopPropagation();
				closeHaze();
			}
		}
		window.addEventListener('pointerdown', onWindowPointerDown, true);
		window.addEventListener('keydown', onWindowKeyDown, true);
		return () => {
			window.removeEventListener('pointerdown', onWindowPointerDown, true);
			window.removeEventListener('keydown', onWindowKeyDown, true);
		};
	});

	onMount(() => {
		function onOtherHazeOpen(e: Event) {
			const ce = e as CustomEvent<string>;
			if (ce.detail !== note.id) {
				closeHaze();
			}
		}
		window.addEventListener('scrapscache-card-haze-open', onOtherHazeOpen);
		return () => {
			window.removeEventListener('scrapscache-card-haze-open', onOtherHazeOpen);
			if (copyTimer) clearTimeout(copyTimer);
		};
	});

	onDestroy(() => swipe.dispose());
</script>

<div class="card-stream-in relative overflow-hidden rounded-lg">
	{#if offsetX < 0}
		<div
			class="absolute inset-0 flex items-center justify-end rounded-lg bg-green-500 pr-4 text-white"
		>
			{#if note.trashed}
				<RotateCcw class="h-6 w-6" aria-hidden="true" />
			{:else if note.archived}
				<ArchiveRestore class="h-6 w-6" aria-hidden="true" />
			{:else}
				<Archive class="h-6 w-6" aria-hidden="true" />
			{/if}
		</div>
	{:else if offsetX > 0}
		<div
			class="absolute inset-0 flex items-center justify-start rounded-lg bg-red-500 pl-4 text-white"
		>
			<Trash2 class="h-6 w-6" aria-hidden="true" />
		</div>
	{/if}

	<div
		bind:this={cardEl}
		role="button"
		tabindex="0"
		aria-label={openLabel}
		class="relative z-[1] flex w-full max-h-[320px] cursor-pointer flex-col overflow-hidden rounded-lg border border-black/5 shadow-sm transition-shadow dark:border-white/10"
		style="background-color: {bgColor(note.color)}; {cardSwipeStyle(offsetX, dragging)}"
		class:shadow-md={note.pinned}
		onpointerdown={swipe.onPointerDown}
		onpointermove={swipe.onPointerMove}
		onpointerup={swipe.onPointerUp}
		onpointercancel={swipe.onPointerCancel}
		onclick={openUnlessDrag}
		oncontextmenu={handleContextMenu}
		onkeydown={handleKeydown}
	>
		{#if note.reminder != null}
			<div class="shrink-0">
				<ReminderLabel reminder={note.reminder} />
			</div>
		{/if}

		<div class="note-scrollbar-hidden scrollable min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
			<div class="relative">
				<div class="block w-full p-3 pb-2 text-left" class:opacity-60={note.trashed}>
					{#if note.title}
						<h3
							class="mb-1 break-words text-[15px] font-semibold leading-snug tracking-tight text-[var(--scrapscache-text)]"
						>
							{note.title}
						</h3>
					{/if}
					<NoteBodyDisplay {note} />
				</div>
				<!-- Every press lands here, so links, photos, canvases and files can
				     never swallow a swipe or start a drag of their own. -->
				<div class="absolute inset-0" data-card-shield aria-hidden="true"></div>
			</div>
		</div>

		{#if labelsForNote.length}
			<div class="flex shrink-0 flex-wrap gap-1 px-3 pb-3 pt-2">
				{#each labelsForNote as label (label.id)}
					<span
						class="rounded px-1.5 py-0.5 text-[10px] font-medium bg-black/5 text-[var(--scrapscache-text-muted)] dark:bg-white/10"
					>
						{label.name}
					</span>
				{/each}
			</div>
		{/if}

		{#if hazeActive}
			<!-- Clicking the haze is a pointer convenience; Escape and outside taps dismiss it. -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class="absolute inset-0 z-20 flex flex-col items-center justify-center p-2 rounded-lg backdrop-blur-md bg-black/45 dark:bg-black/60 transition-opacity animate-in fade-in duration-150"
				data-card-haze
				role="presentation"
				onclick={(e) => {
					e.stopPropagation();
					closeHaze();
				}}
				onpointerdown={(e) => e.stopPropagation()}
				oncontextmenu={(e) => {
					e.preventDefault();
					e.stopPropagation();
				}}
			>
				<div
					class="flex flex-wrap items-center justify-center gap-1.5 rounded-2xl bg-black/50 p-1.5 text-white shadow-2xl backdrop-blur-lg border border-white/20 dark:bg-black/70 max-w-full"
				>
					<!-- Delete -->
					<button
						type="button"
						class="flex h-9 w-9 items-center justify-center rounded-full text-white/90 transition-all hover:scale-105 hover:bg-rose-500/30 hover:text-rose-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
						title={note.trashed ? 'Delete forever' : 'Delete note'}
						aria-label={note.trashed ? 'Delete forever' : 'Delete note'}
						onclick={handleDelete}
					>
						<Trash2 class="h-4 w-4" aria-hidden="true" />
					</button>

					<!-- Archive -->
					<button
						type="button"
						class="flex h-9 w-9 items-center justify-center rounded-full text-white/90 transition-all hover:scale-105 hover:bg-white/20 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
						title={note.archived ? 'Unarchive' : 'Archive'}
						aria-label={note.archived ? 'Unarchive note' : 'Archive note'}
						onclick={handleArchive}
					>
						{#if note.archived}
							<ArchiveRestore class="h-4 w-4" aria-hidden="true" />
						{:else}
							<Archive class="h-4 w-4" aria-hidden="true" />
						{/if}
					</button>

					<!-- Copy -->
					<button
						type="button"
						class={`flex h-9 w-9 items-center justify-center rounded-full transition-all hover:scale-105 hover:bg-white/20 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${copied ? 'text-emerald-400' : 'text-white/90'}`}
						title={copied ? 'Copied!' : 'Copy note'}
						aria-label={copied ? 'Copied to clipboard' : 'Copy note'}
						onclick={handleCopy}
					>
						{#if copied}
							<Check class="h-4 w-4 text-emerald-400" aria-hidden="true" />
						{:else}
							<Copy class="h-4 w-4" aria-hidden="true" />
						{/if}
					</button>

					<!-- Pin -->
					<button
						type="button"
						class={`flex h-9 w-9 items-center justify-center rounded-full transition-all hover:scale-105 hover:bg-white/20 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${note.pinned ? 'text-amber-300' : 'text-white/90'}`}
						title={note.pinned ? 'Unpin' : 'Pin'}
						aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
						onclick={handlePin}
					>
						<Pin class="h-4 w-4" fill={note.pinned ? 'currentColor' : 'none'} aria-hidden="true" />
					</button>

					<!-- Reminder -->
					<button
						type="button"
						class={`flex h-9 w-9 items-center justify-center rounded-full transition-all hover:scale-105 hover:bg-white/20 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${note.reminder != null ? 'text-blue-300' : 'text-white/90'}`}
						title={note.reminder != null ? 'Edit reminder' : 'Add reminder'}
						aria-label={note.reminder != null ? 'Edit reminder' : 'Add reminder'}
						onclick={handleReminder}
					>
						<Bell
							class="h-4 w-4"
							fill={note.reminder != null ? 'currentColor' : 'none'}
							aria-hidden="true"
						/>
					</button>
				</div>

				{#if copied}
					<div
						class="mt-2 rounded-full bg-black/70 px-2.5 py-0.5 text-xs font-medium text-emerald-300 shadow-md backdrop-blur-md"
						role="status"
					>
						Copied to clipboard
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

{#if reminderDialogOpen}
	<Dialog.Root
		open
		onOpenChange={(details) => {
			if (!details.open) reminderDialogOpen = false;
		}}
		preventScroll={false}
	>
		<div {@attach portalToAppOverlay} class="fixed inset-0 z-[70]" role="presentation">
			<Dialog.Backdrop class="fixed inset-0 bg-black/30 backdrop-blur-xs" />
			<Dialog.Positioner class="fixed inset-0 flex items-center justify-center p-4">
				<Dialog.Content class="outline-none" onclick={(e) => e.stopPropagation()}>
					<ReminderPicker
						reminder={note.reminder}
						onApply={(r) => {
							notesStore.setReminder(note.id, r);
							reminderStore.sync(notesStore.notes);
							void notesStore.flushSync();
							reminderDialogOpen = false;
						}}
						onClose={() => {
							reminderDialogOpen = false;
						}}
					/>
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	</Dialog.Root>
{/if}
