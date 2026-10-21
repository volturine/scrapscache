<script lang="ts">
	import type { MoveTargets } from '#lib/kanbanMove.js';
	// Every action a card offers, behind one visible "…" on the card. A right-click
	// or long-press opens the same menu. The card owns when it opens; this owns
	// what the actions do and when they close.
	import { noteActionsStyles as styles, popover } from '$panda/styles';
	import { css, cx } from 'styled-system/css';
	import { iconButton, menuItem, noteSurface } from 'styled-system/recipes';
	import { flex } from 'styled-system/patterns';
	import { Menu } from '@ark-ui/svelte/menu';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '#lib/appViewport.js';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { selectionStore } from '#lib/stores/selection.svelte.js';
	import { reminderStore } from '#lib/stores/reminders.svelte.js';
	import { NOTE_COLOR_ORDER, type Note, type NoteColor } from '#lib/types.js';
	import { writeClipboardText } from '#lib/utils.js';
	import { noteToPlainText } from '#lib/checklistBody.js';
	import ReminderPicker from './ReminderPicker.svelte';
	import LabelMenu from './LabelMenu.svelte';
	import {
		Archive,
		ArchiveRestore,
		Bell,
		Check,
		Copy,
		Ellipsis,
		Pin,
		PinOff,
		RotateCcw,
		SquareCheck,
		Tag,
		Trash2
	} from '@lucide/svelte';
	import { onMount } from 'svelte';

	let {
		note,
		open = $bindable(false),
		moveTo
	}: {
		note: Note;
		open?: boolean;
		/** On a board: the columns the card can move to without a drag. */
		moveTo?: MoveTargets;
	} = $props();

	let trigger = $state<HTMLElement | null>(null);
	let content = $state<HTMLElement | null>(null);
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;
	let reminderDialogOpen = $state(false);
	let reminderPicker = $state<ReminderPicker | undefined>();
	let labelDialogOpen = $state(false);
	const itemClass = cx(menuItem({ density: 'compact' }), styles.item);
	const COLOR_NAMES: Record<NoteColor, string> = {
		default: 'Default',
		red: 'Red',
		orange: 'Orange',
		yellow: 'Yellow',
		green: 'Green',
		teal: 'Teal',
		blue: 'Blue',
		darkblue: 'Dark blue',
		purple: 'Purple',
		pink: 'Pink',
		brown: 'Brown',
		gray: 'Grey'
	};

	function close() {
		open = false;
	}

	/** A press on the "…" is the menu's, not the card's: no swipe, drag or open. */
	function keepToMenu(event: Event) {
		event.stopPropagation();
	}

	/** Start, or add to, a selection: the top bar then acts on every picked note. */
	function select() {
		close();
		if (!selectionStore.has(note.id)) selectionStore.toggle(note.id);
	}

	function trash() {
		close();
		if (note.trashed) void notesStore.deleteNoteForever(note.id);
		else notesStore.trashNote(note.id);
	}

	function restore() {
		close();
		notesStore.restoreNote(note.id);
	}

	function restoreToArchive() {
		close();
		notesStore.restoreToArchive(note.id);
	}

	function archive() {
		close();
		notesStore.toggleArchive(note.id);
	}

	function pin() {
		close();
		notesStore.togglePin(note.id);
	}

	async function copy() {
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

	function remind() {
		close();
		reminderDialogOpen = true;
	}

	function label() {
		close();
		labelDialogOpen = true;
	}

	function recolor(value: string) {
		if (NOTE_COLOR_ORDER.includes(value as NoteColor) && value !== note.color)
			notesStore.updateNote(note.id, { color: value as NoteColor });
	}

	/** How long after its pointerup a press may still deliver its click. */
	const CLICK_AFTER_UP_MS = 500;

	/**
	 * Swallow the click that ends the press `pointerId`, wherever it lands. The swallow
	 * gives way to the next press or key, to the press being cancelled (it turned into
	 * a scroll), and shortly after the press ends without a click.
	 */
	function swallowNextClick(pointerId: number) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		function swallow(e: MouseEvent) {
			e.preventDefault();
			e.stopImmediatePropagation();
			stop();
		}
		function ended(e: PointerEvent) {
			if (e.pointerId !== pointerId) return;
			if (e.type === 'pointercancel') stop();
			else timer = setTimeout(stop, CLICK_AFTER_UP_MS);
		}
		function stop() {
			clearTimeout(timer);
			window.removeEventListener('click', swallow, true);
			window.removeEventListener('pointerdown', stop, true);
			window.removeEventListener('keydown', stop, true);
			window.removeEventListener('pointerup', ended, true);
			window.removeEventListener('pointercancel', ended, true);
		}
		window.addEventListener('click', swallow, true);
		window.addEventListener('pointerdown', stop, true);
		window.addEventListener('keydown', stop, true);
		window.addEventListener('pointerup', ended, true);
		window.addEventListener('pointercancel', ended, true);
	}

	// An outside press closes the menu. The tap that does so must not also open the
	// note under the finger, nor start a hold, swipe or drag on it; a mouse click
	// elsewhere goes through, as it does outside any menu.
	$effect(() => {
		if (!open) return;
		function onWindowPointerDown(e: PointerEvent) {
			const target = e.target as Node | null;
			if (content?.contains(target) || trigger?.contains(target)) return;
			close();
			if (e.pointerType !== 'mouse') {
				e.stopPropagation();
				swallowNextClick(e.pointerId);
			}
		}
		window.addEventListener('pointerdown', onWindowPointerDown, true);
		return () => window.removeEventListener('pointerdown', onWindowPointerDown, true);
	});

	onMount(() => () => {
		if (copyTimer) clearTimeout(copyTimer);
	});
</script>

<Menu.Root bind:open positioning={{ placement: 'bottom-end' }} lazyMount unmountOnExit>
	<Menu.Trigger
		bind:ref={trigger}
		class={cx(iconButton({ variant: 'ghost', size: 'compact' }), styles.trigger)}
		title="Actions"
		aria-label="Note actions"
		data-note-actions-trigger
		onpointerdown={keepToMenu}
		onclick={keepToMenu}
	>
		<Ellipsis size={18} aria-hidden="true" />
	</Menu.Trigger>
	<!-- Portalled out of the card, whose frame clips its own overflow. The frame spans
	     the app, so it must not take hits: inline, because `.app-overlay > *` turns
	     pointer events back on for every overlay child. -->
	{#if open}
		<div {@attach portalToAppOverlay} class={styles.portal} style="pointer-events: none">
			<Menu.Positioner class={styles.positioner}>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<Menu.Content
					bind:ref={content}
					class={cx(popover, styles.menu)}
					aria-label="Note actions"
					data-note-actions
					onpointerdown={keepToMenu}
					onclick={keepToMenu}
					oncontextmenu={(e) => {
						e.preventDefault();
						e.stopPropagation();
					}}
				>
					{#if note.trashed}
						<Menu.Item value="select" onSelect={select} class={itemClass}>
							<SquareCheck size={16} aria-hidden="true" />Select
						</Menu.Item>
						<Menu.Item value="restore" onSelect={restore} class={itemClass}>
							<RotateCcw size={16} aria-hidden="true" />Restore
						</Menu.Item>
						<Menu.Item value="archive" onSelect={restoreToArchive} class={itemClass}>
							<Archive size={16} aria-hidden="true" />Archive
						</Menu.Item>
						<Menu.Separator class={styles.separator} />
						<Menu.Item value="delete" onSelect={trash} class={cx(itemClass, styles.danger)}>
							<Trash2 size={16} aria-hidden="true" />Delete forever
						</Menu.Item>
					{:else if note.archived}
						<Menu.Item value="select" onSelect={select} class={itemClass}>
							<SquareCheck size={16} aria-hidden="true" />Select
						</Menu.Item>
						<Menu.Item value="restore" onSelect={archive} class={itemClass}>
							<ArchiveRestore size={16} aria-hidden="true" />Restore
						</Menu.Item>
						<Menu.Separator class={styles.separator} />
						<Menu.Item value="delete" onSelect={trash} class={cx(itemClass, styles.danger)}>
							<Trash2 size={16} aria-hidden="true" />Move to trash
						</Menu.Item>
					{:else}
						<Menu.Item value="select" onSelect={select} class={itemClass}>
							<SquareCheck size={16} aria-hidden="true" />Select
						</Menu.Item>
						<Menu.Item value="pin" onSelect={pin} class={itemClass}>
							{#if note.pinned}
								<PinOff size={16} aria-hidden="true" />Unpin
							{:else}
								<Pin size={16} aria-hidden="true" />Pin to top
							{/if}
						</Menu.Item>
						<Menu.Item value="remind" onSelect={remind} class={itemClass}>
							<Bell size={16} aria-hidden="true" />{note.reminder != null
								? 'Edit reminder…'
								: 'Remind me…'}
						</Menu.Item>
						<Menu.Item value="label" onSelect={label} class={itemClass}>
							<Tag size={16} aria-hidden="true" />Add label…
						</Menu.Item>
						<Menu.ItemGroup class={styles.colorGroup}>
							<Menu.ItemGroupLabel class={styles.colorLabel}>Colour</Menu.ItemGroupLabel>
							<Menu.RadioItemGroup
								value={note.color}
								onValueChange={(details) => recolor(details.value)}
								class={styles.swatches}
							>
								{#each NOTE_COLOR_ORDER as color (color)}
									<Menu.RadioItem
										value={color}
										closeOnSelect={false}
										class={cx(styles.swatch, noteSurface({ color }))}
										aria-label={COLOR_NAMES[color]}
										title={COLOR_NAMES[color]}
									>
										<Menu.ItemIndicator class={styles.swatchCheck}>
											<Check size={12} aria-hidden="true" />
										</Menu.ItemIndicator>
									</Menu.RadioItem>
								{/each}
							</Menu.RadioItemGroup>
						</Menu.ItemGroup>
						{#if moveTo}
							<Menu.ItemGroup class={styles.colorGroup}>
								<Menu.ItemGroupLabel class={styles.colorLabel}>Move to</Menu.ItemGroupLabel>
								<Menu.RadioItemGroup
									value={moveTo.current}
									onValueChange={(details) => {
										if (details.value !== moveTo.current) moveTo.onMove(details.value);
									}}
								>
									{#each moveTo.columns as column (column.id)}
										<Menu.RadioItem value={column.id} class={itemClass}>
											<Menu.ItemIndicator><Check size={14} aria-hidden="true" /></Menu.ItemIndicator
											>
											<Menu.ItemText>{column.name}</Menu.ItemText>
										</Menu.RadioItem>
									{/each}
								</Menu.RadioItemGroup>
							</Menu.ItemGroup>
						{/if}
						<Menu.Item
							value="copy"
							closeOnSelect={false}
							onSelect={() => void copy()}
							class={itemClass}
						>
							{#if copied}
								<Check size={16} aria-hidden="true" />Copied
							{:else}
								<Copy size={16} aria-hidden="true" />Copy as text
							{/if}
						</Menu.Item>
						<Menu.Item value="archive" onSelect={archive} class={itemClass}>
							<Archive size={16} aria-hidden="true" />Archive
						</Menu.Item>
						<Menu.Separator class={styles.separator} />
						<Menu.Item value="delete" onSelect={trash} class={cx(itemClass, styles.danger)}>
							<Trash2 size={16} aria-hidden="true" />Move to trash
						</Menu.Item>
					{/if}
				</Menu.Content>
			</Menu.Positioner>
		</div>
	{/if}
</Menu.Root>

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
		initialFocusEl={() => reminderPicker?.initialFocus() ?? null}
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
						bind:this={reminderPicker}
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
