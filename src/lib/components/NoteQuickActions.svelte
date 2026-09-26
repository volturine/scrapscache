<script lang="ts">
	// Quick actions a card offers on right-click, over a haze on the card itself.
	// The card owns when it opens; this owns what the actions do and when they
	// close. Only one card's haze is open at a time, across every view.
	import {
		noteCardHazeGroup as hazeGroup,
		noteCardSuccessIcon as successIcon
	} from '$panda/styles';
	import { css } from 'styled-system/css';
	import { iconButton, noteCard } from 'styled-system/recipes';
	import { flex } from 'styled-system/patterns';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import type { Note } from '$lib/types';
	import { writeClipboardText } from '$lib/utils';
	import ReminderPicker from './ReminderPicker.svelte';
	import LabelMenu from './LabelMenu.svelte';
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
		Tag,
		Trash2
	} from '@lucide/svelte';
	import { onMount } from 'svelte';

	const HAZE_OPEN_EVENT = 'scrapscache-card-haze-open';

	let { note, open = $bindable(false) }: { note: Note; open?: boolean } = $props();

	let overlay = $state<HTMLDivElement | null>(null);
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;
	let reminderDialogOpen = $state(false);
	let labelDialogOpen = $state(false);
	/** This haze, not this note: a note in two label columns shows as two cards. */
	const token = {};
	const card = noteCard();

	function close() {
		open = false;
	}

	function handleDelete(e: MouseEvent) {
		e.stopPropagation();
		close();
		if (note.trashed) {
			void notesStore.deleteNoteForever(note.id);
		} else {
			notesStore.trashNote(note.id);
		}
	}

	function handleRestore(e: MouseEvent) {
		e.stopPropagation();
		close();
		notesStore.restoreNote(note.id);
	}

	function handleRestoreToArchive(e: MouseEvent) {
		e.stopPropagation();
		close();
		notesStore.restoreToArchive(note.id);
	}

	function handleArchive(e: MouseEvent) {
		e.stopPropagation();
		close();
		notesStore.toggleArchive(note.id);
	}

	async function handleCopy(e: MouseEvent) {
		e.stopPropagation();
		if (await writeClipboardText(noteToPlainText(note))) {
			copied = true;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => {
				copied = false;
				copyTimer = null;
				close();
			}, 800);
		} else {
			close();
		}
	}

	function handlePin(e: MouseEvent) {
		e.stopPropagation();
		close();
		notesStore.togglePin(note.id);
	}

	function handleReminder(e: MouseEvent) {
		e.stopPropagation();
		close();
		reminderDialogOpen = true;
	}

	function handleTag(e: MouseEvent) {
		e.stopPropagation();
		close();
		labelDialogOpen = true;
	}

	// Opening one haze closes every other; an outside press or Escape closes this one.
	$effect(() => {
		if (!open) return;
		window.dispatchEvent(new CustomEvent(HAZE_OPEN_EVENT, { detail: token }));
		function onWindowPointerDown(e: PointerEvent) {
			if (!overlay?.parentElement?.contains(e.target as Node)) close();
		}
		function onWindowKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.stopPropagation();
				close();
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
			if ((e as CustomEvent<object>).detail !== token) close();
		}
		window.addEventListener(HAZE_OPEN_EVENT, onOtherHazeOpen);
		return () => {
			window.removeEventListener(HAZE_OPEN_EVENT, onOtherHazeOpen);
			if (copyTimer) clearTimeout(copyTimer);
		};
	});
</script>

{#if open}
	<!-- Clicking the haze is a pointer convenience; Escape and outside taps dismiss it. -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		bind:this={overlay}
		class={card.hazeOverlay}
		data-card-haze
		role="presentation"
		onclick={(e) => {
			e.stopPropagation();
			close();
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
					class={iconButton({ size: 'standard', variant: 'haze' })}
					title="Restore"
					aria-label="Restore note"
					onclick={handleRestore}
				>
					<RotateCcw size={20} aria-hidden="true" />
				</button>

				<!-- Archive -->
				<button
					type="button"
					class={iconButton({ size: 'standard', variant: 'haze' })}
					title="Archive"
					aria-label="Archive note"
					onclick={handleRestoreToArchive}
				>
					<Archive size={20} aria-hidden="true" />
				</button>

				<!-- Delete forever -->
				<button
					type="button"
					class={iconButton({
						size: 'standard',
						variant: 'hazeRose'
					})}
					title="Delete forever"
					aria-label="Delete forever"
					onclick={handleDelete}
				>
					<Trash2 size={20} aria-hidden="true" />
				</button>
			</div>
		{:else if note.archived}
			<div class={hazeGroup.row}>
				<!-- Restore -->
				<button
					type="button"
					class={iconButton({ size: 'standard', variant: 'haze' })}
					title="Restore"
					aria-label="Restore note"
					onclick={handleArchive}
				>
					<ArchiveRestore size={20} aria-hidden="true" />
				</button>

				<!-- Delete note -->
				<button
					type="button"
					class={iconButton({
						size: 'standard',
						variant: 'hazeRose'
					})}
					title="Delete note"
					aria-label="Delete note"
					onclick={handleDelete}
				>
					<Trash2 size={20} aria-hidden="true" />
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
					<!-- Tag -->
					<button
						type="button"
						class={iconButton({
							size: 'standard',
							variant: note.labels.length ? 'hazeBlue' : 'haze'
						})}
						title="Tag"
						aria-label="Tag note"
						onclick={handleTag}
					>
						<Tag size={20} fill={note.labels.length ? 'currentColor' : 'none'} aria-hidden="true" />
					</button>

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

{#if labelDialogOpen}
	<Dialog.Root
		open
		onOpenChange={(details) => {
			if (!details.open) labelDialogOpen = false;
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
					<LabelMenu
						noteId={note.id}
						onClose={() => {
							labelDialogOpen = false;
						}}
					/>
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	</Dialog.Root>
{/if}

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
