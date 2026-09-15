<script lang="ts">
	import {
		noteCardHazeGroup as hazeGroup,
		noteCardSuccessIcon as successIcon
	} from '$panda/styles';
	import { css, cx } from 'styled-system/css';
	import { badge, iconButton, noteCard, noteSurface } from 'styled-system/recipes';
	import { flex } from 'styled-system/patterns';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import type { Note } from '$lib/types';
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
		Lock,
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

	function handleRestore(e: MouseEvent) {
		e.stopPropagation();
		closeHaze();
		notesStore.restoreNote(note.id);
	}

	function handleRestoreToArchive(e: MouseEvent) {
		e.stopPropagation();
		closeHaze();
		notesStore.restoreToArchive(note.id);
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

	$effect(() => {
		if (!cardEl) return;
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) cardHeight = entry.contentRect.height;
		});
		observer.observe(cardEl);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (!hazeActive) return;
		function onWindowPointerDown(e: PointerEvent) {
			if (cardEl && !cardEl.contains(e.target as Node)) closeHaze();
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

	const card = $derived(noteCard({ pinned: note.pinned, trashed: note.trashed }));
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

<div class={cx(card.cardOuter, css({ _motionSafe: { animation: 'cardIn' } }))}>
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
		class={cx(card.cardBody, noteSurface({ color: note.color }))}
		style={cardSwipeStyle(offsetX, dragging)}
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
			class={`note-scrollbar-hidden ${!note.secret ? 'scrollable' : ''} ${css({
				minH: 0,
				flex: '1',
				overflowX: 'hidden',
				overflowY: note.secret ? 'hidden' : 'auto'
			})}`}
			data-secret-body={note.secret ? '' : undefined}
		>
			<div
				class={cx(
					css({ position: 'relative' }),
					note.secret && css({ flex: '1', minH: 0, display: 'flex', flexDirection: 'column' })
				)}
			>
				<div
					class={cx(
						note.secret
							? css({ flex: '1', minH: 0, display: 'flex', flexDirection: 'column' })
							: card.contentPad,
						note.trashed && css({ opacity: 0.6 })
					)}
				>
					{#if note.title}
						<h3
							class={cx(
								card.title,
								css({ flexShrink: 0 }),
								note.secret && css({ px: 'md', pt: 'md', pb: 'sm' })
							)}
						>
							{note.title}
						</h3>
					{/if}
					<div
						class={cx(
							css({ position: 'relative', minH: '3rem' }),
							note.secret && css({ flex: '1', minH: 0, overflow: 'hidden' })
						)}
					>
						<div
							class={note.secret
								? css({
										filter: 'blur(4px)',
										userSelect: 'none',
										h: 'full',
										overflow: 'hidden',
										px: 'md',
										pb: 'md',
										pt: !note.title ? 'sm' : 0
									})
								: undefined}
							data-secret-content={note.secret ? '' : undefined}
						>
							<NoteBodyDisplay {note} />
						</div>
						{#if note.secret}
							<div
								class={cx(card.hazeOverlay, css({ pointerEvents: 'none', zIndex: 10 }))}
								data-secret-overlay
								aria-hidden="true"
							>
								<Lock
									class={css({
										w: '1.5rem',
										h: '1.5rem',
										color: 'scrapscache.textMuted',
										filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.35))'
									})}
								/>
							</div>
						{/if}
					</div>
				</div>
				<!-- Every press lands here, so links, photos, canvases and files can
				     never swallow a swipe or start a drag of their own. -->
				<div class={card.shield} data-card-shield aria-hidden="true"></div>
			</div>
		</div>

		{#if labelsForNote.length}
			<div class={card.labelsRow}>
				{#each labelsForNote as label (label.id)}
					<span class={badge()}>
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
				{#if note.trashed}
					<div class={hazeGroup.row}>
						<!-- Restore -->
						<button
							type="button"
							class={iconButton({ size: compactActions ? 'compact' : 'standard', variant: 'haze' })}
							title="Restore"
							aria-label="Restore note"
							onclick={handleRestore}
						>
							<RotateCcw size={compactActions ? 16 : 20} aria-hidden="true" />
						</button>

						<!-- Archive -->
						<button
							type="button"
							class={iconButton({ size: compactActions ? 'compact' : 'standard', variant: 'haze' })}
							title="Archive"
							aria-label="Archive note"
							onclick={handleRestoreToArchive}
						>
							<Archive size={compactActions ? 16 : 20} aria-hidden="true" />
						</button>

						<!-- Delete forever -->
						<button
							type="button"
							class={iconButton({
								size: compactActions ? 'compact' : 'standard',
								variant: 'hazeRose'
							})}
							title="Delete forever"
							aria-label="Delete forever"
							onclick={handleDelete}
						>
							<Trash2 size={compactActions ? 16 : 20} aria-hidden="true" />
						</button>
					</div>
				{:else if note.archived}
					<div class={hazeGroup.row}>
						<!-- Restore -->
						<button
							type="button"
							class={iconButton({ size: compactActions ? 'compact' : 'standard', variant: 'haze' })}
							title="Restore"
							aria-label="Restore note"
							onclick={handleArchive}
						>
							<ArchiveRestore size={compactActions ? 16 : 20} aria-hidden="true" />
						</button>

						<!-- Delete note -->
						<button
							type="button"
							class={iconButton({
								size: compactActions ? 'compact' : 'standard',
								variant: 'hazeRose'
							})}
							title="Delete note"
							aria-label="Delete note"
							onclick={handleDelete}
						>
							<Trash2 size={compactActions ? 16 : 20} aria-hidden="true" />
						</button>
					</div>
				{:else if compactActions}
					<div class={hazeGroup.compact}>
						<button
							type="button"
							class={iconButton({ size: 'compact', variant: copied ? 'hazeCopied' : 'haze' })}
							title={copied ? 'Copied!' : 'Copy note'}
							aria-label={copied ? 'Copied to clipboard' : 'Copy note'}
							onclick={handleCopy}
						>
							{#if copied}
								<Check size={16} class={successIcon} aria-hidden="true" />
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
					<div class={hazeGroup.column}>
						<div class={hazeGroup.row}>
							<!-- Copy -->
							<button
								type="button"
								class={iconButton({ size: 'standard', variant: copied ? 'hazeCopied' : 'haze' })}
								title={copied ? 'Copied!' : 'Copy note'}
								aria-label={copied ? 'Copied to clipboard' : 'Copy note'}
								onclick={handleCopy}
							>
								{#if copied}
									<Check size={20} class={successIcon} aria-hidden="true" />
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

						<div class={hazeGroup.row}>
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
				class={css({
					position: 'fixed',
					inset: 0,
					bg: 'scrapscache.backdropSoft',
					backdropFilter: 'blur(2px)'
				})}
			/>
			<Dialog.Positioner
				class={flex({ position: 'fixed', inset: 0, align: 'center', justify: 'center', p: 'lg' })}
			>
				<Dialog.Content class={css({ outline: 'none' })} onclick={(e) => e.stopPropagation()}>
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
