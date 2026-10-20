<script lang="ts">
	// The top bar while cards are picked: how many, and one action for all of them.
	// What it offers follows the view: active notes can be pinned, reminded, labelled,
	// coloured, archived and trashed; the archive and the trash restore, and the trash
	// deletes for good.
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { Menu } from '@ark-ui/svelte/menu';
	import {
		Archive,
		Bell,
		Check,
		Palette,
		Pin,
		PinOff,
		RotateCcw,
		Tag,
		Trash2,
		X
	} from '@lucide/svelte';
	import { css, cx } from 'styled-system/css';
	import { flex } from 'styled-system/patterns';
	import { button, iconButton, menuItem, noteSurface } from 'styled-system/recipes';
	import { iconSizeMd as iconMd, noteSelectStyles as styles, popover } from '$panda/styles';
	import { portalToAppOverlay } from '#lib/appViewport.js';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { reminderStore } from '#lib/stores/reminders.svelte.js';
	import { selectionStore } from '#lib/stores/selection.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { NOTE_COLOR_NAMES, NOTE_COLOR_ORDER, type NoteColor } from '#lib/types.js';
	import ReminderPicker from './ReminderPicker.svelte';
	import Tooltip from './Tooltip.svelte';

	const ids = $derived(selectionStore.ids);
	const notes = $derived(notesStore.notes.filter((note) => ids.includes(note.id)));
	const count = $derived(ids.length);
	const place = $derived(
		uiStore.view === 'trash' ? 'trash' : uiStore.view === 'archive' ? 'archive' : 'active'
	);
	const allPinned = $derived(notes.length > 0 && notes.every((note) => note.pinned));
	const labels = $derived(
		[...notesStore.labels].sort((a, b) =>
			a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
		)
	);
	/** A label every picked note carries is on; one some carry is off, and a pick puts it on all. */
	function labelOn(labelId: string): boolean {
		return notes.length > 0 && notes.every((note) => note.labels.includes(labelId));
	}

	let reminderOpen = $state(false);
	let reminderPicker = $state<ReminderPicker | undefined>();
	let confirmingDelete = $state(false);
	const itemClass = cx(menuItem({ density: 'compact' }), styles.item);
	const action = iconButton({ variant: 'ghost', size: { base: 'compact', sm: 'standard' } });

	function done() {
		selectionStore.clear();
	}

	function pin() {
		notesStore.pinNotes(ids, !allPinned);
	}

	function archive() {
		notesStore.archiveNotes(ids);
		done();
	}

	function trash() {
		notesStore.trashNotes(ids);
		done();
	}

	function restore() {
		notesStore.restoreNotes(ids);
		done();
	}

	function deleteForever() {
		notesStore.deleteNotesForever(ids);
		confirmingDelete = false;
		done();
	}

	function recolor(value: string) {
		if (NOTE_COLOR_ORDER.includes(value as NoteColor))
			notesStore.setColorMany(ids, value as NoteColor);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented || reminderOpen) return;
		event.preventDefault();
		done();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class={styles.bar} role="toolbar" aria-label="Selected notes" data-selection-bar>
	<Tooltip content="Clear selection">
		<button
			type="button"
			class={action}
			title="Clear selection"
			aria-label="Clear selection"
			onclick={done}
		>
			<X class={iconMd} aria-hidden="true" />
		</button>
	</Tooltip>
	<span class={styles.count} aria-live="polite">{count} selected</span>
	<div class={styles.actions}>
		{#if place === 'active'}
			<Tooltip content={allPinned ? 'Unpin' : 'Pin to top'}>
				<button
					type="button"
					class={action}
					title={allPinned ? 'Unpin' : 'Pin to top'}
					aria-label={allPinned ? 'Unpin' : 'Pin to top'}
					onclick={pin}
				>
					{#if allPinned}<PinOff class={iconMd} aria-hidden="true" />{:else}<Pin
							class={iconMd}
							aria-hidden="true"
						/>{/if}
				</button>
			</Tooltip>
			<Tooltip content="Remind me…">
				<button
					type="button"
					class={action}
					title="Remind me…"
					aria-label="Remind me…"
					onclick={() => (reminderOpen = true)}
				>
					<Bell class={iconMd} aria-hidden="true" />
				</button>
			</Tooltip>
			<Menu.Root
				positioning={{ placement: 'bottom-end' }}
				lazyMount
				unmountOnExit
				closeOnSelect={false}
			>
				<Tooltip content="Labels">
					<Menu.Trigger class={action} title="Labels" aria-label="Labels">
						<Tag class={iconMd} aria-hidden="true" />
					</Menu.Trigger>
				</Tooltip>
				<div {@attach portalToAppOverlay}>
					<Menu.Positioner>
						<Menu.Content class={cx(popover, styles.menu)} aria-label="Labels">
							{#if labels.length === 0}
								<p class={cx(itemClass, css({ cursor: 'default' }))}>No labels yet</p>
							{/if}
							{#each labels as label (label.id)}
								<Menu.CheckboxItem
									value={label.id}
									checked={labelOn(label.id)}
									onCheckedChange={(checked) => notesStore.setLabelMany(ids, label.id, checked)}
									class={itemClass}
								>
									<Menu.ItemIndicator><Check size={14} aria-hidden="true" /></Menu.ItemIndicator>
									<Menu.ItemText>{label.name}</Menu.ItemText>
								</Menu.CheckboxItem>
							{/each}
						</Menu.Content>
					</Menu.Positioner>
				</div>
			</Menu.Root>
			<Menu.Root
				positioning={{ placement: 'bottom-end' }}
				lazyMount
				unmountOnExit
				closeOnSelect={false}
			>
				<Tooltip content="Colour">
					<Menu.Trigger class={action} title="Colour" aria-label="Colour">
						<Palette class={iconMd} aria-hidden="true" />
					</Menu.Trigger>
				</Tooltip>
				<div {@attach portalToAppOverlay}>
					<Menu.Positioner>
						<Menu.Content class={cx(popover, styles.menu)} aria-label="Colour">
							<Menu.RadioItemGroup
								value={notes.every((note) => note.color === notes[0]?.color)
									? (notes[0]?.color ?? '')
									: ''}
								onValueChange={(details) => recolor(details.value)}
							>
								{#each NOTE_COLOR_ORDER as color (color)}
									<Menu.RadioItem value={color} class={itemClass}>
										<Menu.ItemIndicator><Check size={14} aria-hidden="true" /></Menu.ItemIndicator>
										<span class={cx(styles.swatch, noteSurface({ color }))} aria-hidden="true"
										></span>
										<Menu.ItemText>{NOTE_COLOR_NAMES[color]}</Menu.ItemText>
									</Menu.RadioItem>
								{/each}
							</Menu.RadioItemGroup>
						</Menu.Content>
					</Menu.Positioner>
				</div>
			</Menu.Root>
			<Tooltip content="Archive">
				<button type="button" class={action} title="Archive" aria-label="Archive" onclick={archive}>
					<Archive class={iconMd} aria-hidden="true" />
				</button>
			</Tooltip>
			<Tooltip content="Move to trash">
				<button
					type="button"
					class={action}
					title="Move to trash"
					aria-label="Move to trash"
					onclick={trash}
				>
					<Trash2 class={iconMd} aria-hidden="true" />
				</button>
			</Tooltip>
		{:else}
			<Tooltip content="Restore">
				<button type="button" class={action} title="Restore" aria-label="Restore" onclick={restore}>
					<RotateCcw class={iconMd} aria-hidden="true" />
				</button>
			</Tooltip>
			{#if place === 'archive'}
				<Tooltip content="Move to trash">
					<button
						type="button"
						class={action}
						title="Move to trash"
						aria-label="Move to trash"
						onclick={trash}
					>
						<Trash2 class={iconMd} aria-hidden="true" />
					</button>
				</Tooltip>
			{:else if confirmingDelete}
				<span class={styles.confirm}>
					Delete {count} forever?
					<button
						type="button"
						class={button({ variant: 'danger', size: 'xs' })}
						onclick={deleteForever}>Delete</button
					>
					<button
						type="button"
						class={button({ variant: 'ghost', size: 'xs' })}
						onclick={() => (confirmingDelete = false)}>Keep</button
					>
				</span>
			{:else}
				<Tooltip content="Delete forever">
					<button
						type="button"
						class={action}
						title="Delete forever"
						aria-label="Delete forever"
						onclick={() => (confirmingDelete = true)}
					>
						<Trash2 class={iconMd} aria-hidden="true" />
					</button>
				</Tooltip>
			{/if}
		{/if}
	</div>
</div>

{#if reminderOpen}
	<Dialog.Root
		open
		onOpenChange={(details) => {
			if (!details.open) reminderOpen = false;
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
						reminder={null}
						onApply={(reminder) => {
							notesStore.setReminderMany(ids, reminder);
							reminderStore.sync(notesStore.notes);
							void notesStore.flushSync();
							reminderOpen = false;
						}}
						onClose={() => (reminderOpen = false)}
					/>
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	</Dialog.Root>
{/if}
