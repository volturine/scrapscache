<script lang="ts">
	import { css, cva } from 'styled-system/css';
	import { iconButton, noteCard } from 'styled-system/recipes';
	import { flex } from 'styled-system/patterns';
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
	let cardHeight = $state(0);
	const compactActions = $derived(cardHeight < 140);

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

	const card = $derived(noteCard({ pinned: note.pinned, trashed: note.trashed }));

	const hazeGroup = cva({
		base: {
			display: 'flex',
			alignItems: 'center',
			filter: 'drop-shadow(0 4px 3px rgb(0 0 0 / 0.07))'
		},
		variants: {
			layout: {
				compact: { justifyContent: 'center', gap: '0.375rem' },
				column: { flexDirection: 'column', gap: '0.625rem' },
				row: { justifyContent: 'center', gap: '0.625rem' }
			}
		}
	});
</script>

<svelte:window
	onpointerdowncapture={hazeActive
		? (e) => {
				if (cardEl && !cardEl.contains(e.target as Node)) {
					closeHaze();
				}
			}
		: undefined}
	onkeydowncapture={hazeActive
		? (e) => {
				if (e.key === 'Escape') {
					e.stopPropagation();
					closeHaze();
				}
			}
		: undefined}
/>

<div class={`card-stream-in ${card.cardOuter}`}>
	{#if offsetX < 0}
		<div class={card.swipeRestore}>
			{#if note.trashed}
				<RotateCcw size={24} aria-hidden="true" />
			{:else if note.archived}
				<ArchiveRestore size={24} aria-hidden="true" />
			{:else}
				<Archive size={24} aria-hidden="true" />
			{/if}
		</div>
	{:else if offsetX > 0}
		<div class={card.swipeTrash}>
			<Trash2 size={24} aria-hidden="true" />
		</div>
	{/if}

	<div
		bind:this={cardEl}
		bind:clientHeight={cardHeight}
		role="button"
		tabindex="0"
		aria-label={openLabel}
		class={card.cardBody}
		style="background-color: {bgColor(note.color)}; {cardSwipeStyle(offsetX, dragging)}"
		onpointerdown={swipe.onPointerDown}
		onpointermove={swipe.onPointerMove}
		onpointerup={swipe.onPointerUp}
		onpointercancel={swipe.onPointerCancel}
		onclick={openUnlessDrag}
		oncontextmenu={handleContextMenu}
		onkeydown={handleKeydown}
	>
		{#if note.reminder != null}
			<div class={css({ flexShrink: 0 })}>
				<ReminderLabel reminder={note.reminder} />
			</div>
		{/if}

		<div
			class={`note-scrollbar-hidden scrollable ${css({ minH: 0, flex: '1', overflowX: 'hidden', overflowY: 'auto' })}`}
		>
			<div class={css({ position: 'relative' })}>
				<div class={card.contentPad}>
					{#if note.title}
						<h3 class={`break-words ${card.title}`}>
							{note.title}
						</h3>
					{/if}
					<NoteBodyDisplay {note} />
				</div>
				<!-- Every press lands here, so links, photos, canvases and files can
				     never swallow a swipe or start a drag of their own. -->
				<div class={card.shield} data-card-shield aria-hidden="true"></div>
			</div>
		</div>

		{#if labelsForNote.length}
			<div class={card.labelsRow}>
				{#each labelsForNote as label (label.id)}
					<span class={card.labelPill}>
						{label.name}
					</span>
				{/each}
			</div>
		{/if}

		{#if hazeActive}
			<!-- Clicking the haze is a pointer convenience; Escape and outside taps dismiss it. -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class={card.hazeOverlay}
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
				{#if compactActions}
					<div class={hazeGroup({ layout: 'compact' })}>
						<button
							type="button"
							class={iconButton({ size: 'compact', variant: copied ? 'hazeCopied' : 'haze' })}
							title={copied ? 'Copied!' : 'Copy note'}
							aria-label={copied ? 'Copied to clipboard' : 'Copy note'}
							onclick={handleCopy}
						>
							{#if copied}
								<Check size={16} class={css({ color: 'emerald.400' })} aria-hidden="true" />
							{:else}
								<Copy size={16} aria-hidden="true" />
							{/if}
						</button>
						<button
							type="button"
							class={iconButton({ size: 'compact', variant: note.pinned ? 'hazePinned' : 'haze' })}
							title={note.pinned ? 'Unpin' : 'Pin'}
							aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
							onclick={handlePin}
						>
							<Pin size={16} fill={note.pinned ? 'currentColor' : 'none'} aria-hidden="true" />
						</button>
						<button
							type="button"
							class={iconButton({
								size: 'compact',
								variant: note.reminder != null ? 'hazeBlue' : 'haze'
							})}
							title={note.reminder != null ? 'Edit reminder' : 'Add reminder'}
							aria-label={note.reminder != null ? 'Edit reminder' : 'Add reminder'}
							onclick={handleReminder}
						>
							<Bell
								size={16}
								fill={note.reminder != null ? 'currentColor' : 'none'}
								aria-hidden="true"
							/>
						</button>
						<button
							type="button"
							class={iconButton({ size: 'compact', variant: 'hazeRose' })}
							title={note.trashed ? 'Delete forever' : 'Delete note'}
							aria-label={note.trashed ? 'Delete forever' : 'Delete note'}
							onclick={handleDelete}
						>
							<Trash2 size={16} aria-hidden="true" />
						</button>
						<button
							type="button"
							class={iconButton({ size: 'compact', variant: 'haze' })}
							title={note.archived ? 'Unarchive' : 'Archive'}
							aria-label={note.archived ? 'Unarchive note' : 'Archive note'}
							onclick={handleArchive}
						>
							{#if note.archived}
								<ArchiveRestore size={16} aria-hidden="true" />
							{:else}
								<Archive size={16} aria-hidden="true" />
							{/if}
						</button>
					</div>
				{:else}
					<div class={hazeGroup({ layout: 'column' })}>
						<div class={hazeGroup({ layout: 'row' })}>
							<!-- Copy -->
							<button
								type="button"
								class={iconButton({ size: 'standard', variant: copied ? 'hazeCopied' : 'haze' })}
								title={copied ? 'Copied!' : 'Copy note'}
								aria-label={copied ? 'Copied to clipboard' : 'Copy note'}
								onclick={handleCopy}
							>
								{#if copied}
									<Check size={20} class={css({ color: 'emerald.400' })} aria-hidden="true" />
								{:else}
									<Copy size={20} aria-hidden="true" />
								{/if}
							</button>

							<!-- Pin -->
							<button
								type="button"
								class={iconButton({
									size: 'standard',
									variant: note.pinned ? 'hazePinned' : 'haze'
								})}
								title={note.pinned ? 'Unpin' : 'Pin'}
								aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
								onclick={handlePin}
							>
								<Pin size={20} fill={note.pinned ? 'currentColor' : 'none'} aria-hidden="true" />
							</button>

							<!-- Reminder -->
							<button
								type="button"
								class={iconButton({
									size: 'standard',
									variant: note.reminder != null ? 'hazeBlue' : 'haze'
								})}
								title={note.reminder != null ? 'Edit reminder' : 'Add reminder'}
								aria-label={note.reminder != null ? 'Edit reminder' : 'Add reminder'}
								onclick={handleReminder}
							>
								<Bell
									size={20}
									fill={note.reminder != null ? 'currentColor' : 'none'}
									aria-hidden="true"
								/>
							</button>
						</div>

						<div class={hazeGroup({ layout: 'row' })}>
							<!-- Delete -->
							<button
								type="button"
								class={iconButton({ size: 'standard', variant: 'hazeRose' })}
								title={note.trashed ? 'Delete forever' : 'Delete note'}
								aria-label={note.trashed ? 'Delete forever' : 'Delete note'}
								onclick={handleDelete}
							>
								<Trash2 size={20} aria-hidden="true" />
							</button>

							<!-- Archive -->
							<button
								type="button"
								class={iconButton({ size: 'standard', variant: 'haze' })}
								title={note.archived ? 'Unarchive' : 'Archive'}
								aria-label={note.archived ? 'Unarchive note' : 'Archive note'}
								onclick={handleArchive}
							>
								{#if note.archived}
									<ArchiveRestore size={20} aria-hidden="true" />
								{:else}
									<Archive size={20} aria-hidden="true" />
								{/if}
							</button>
						</div>
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
		<div
			{@attach portalToAppOverlay}
			class={css({ position: 'fixed', inset: 0, zIndex: 70 })}
			role="presentation"
		>
			<Dialog.Backdrop
				class={css({ position: 'fixed', inset: 0, bg: 'black/30', backdropFilter: 'blur(2px)' })}
			/>
			<Dialog.Positioner
				class={flex({ position: 'fixed', inset: 0, align: 'center', justify: 'center', p: '1rem' })}
			>
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
