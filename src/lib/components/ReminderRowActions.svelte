<script lang="ts">
	// Done, Skip and Snooze at the end of an agenda row. Done takes a one-off
	// reminder away (Undo brings it back); a repeating one is skipped this once
	// instead. Snooze moves this time a little later, or opens the picker.
	import {
		noteActionsStyles as menuStyles,
		popover,
		reminderAgendaStyles as styles
	} from '$panda/styles';
	import { css, cx } from 'styled-system/css';
	import { menuItem } from 'styled-system/recipes';
	import { flex } from 'styled-system/patterns';
	import { Menu } from '@ark-ui/svelte/menu';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '#lib/appViewport.js';
	import { appClock } from '#lib/appClock.svelte.js';
	import { snoozeChoices, type AgendaEntry } from '#lib/reminderAgenda.js';
	import { reminderPreview } from '#lib/reminderNotify.js';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { reminderStore } from '#lib/stores/reminders.svelte.js';
	import ReminderPicker from './ReminderPicker.svelte';
	import { Check, ChevronDown, Clock, SkipForward } from '@lucide/svelte';

	let { entry }: { entry: AgendaEntry } = $props();

	const note = $derived(entry.note);
	const repeating = $derived(Boolean(note.repeat));
	const title = $derived(reminderPreview(note));
	const choices = $derived(snoozeChoices(appClock.now));
	let snoozeOpen = $state(false);
	let pickerOpen = $state(false);
	let reminderPicker = $state<ReminderPicker | undefined>();
	const itemClass = cx(menuItem({ density: 'compact' }), menuStyles.item);

	/** Other devices learn of the change through sync; the wakes follow the note. */
	function settled() {
		reminderStore.sync(notesStore.notes);
		void notesStore.flushSync();
	}

	function finish() {
		if (repeating) notesStore.skipReminderTime(note.id, entry.at);
		else notesStore.finishReminder(note.id);
		settled();
	}

	function snooze(to: number) {
		notesStore.snoozeReminder(note.id, entry.at, to);
		settled();
	}
</script>

<button
	type="button"
	class={styles.action}
	title={repeating ? 'Skip this time' : 'Done'}
	aria-label={repeating ? `Skip this time of ${title}` : `Done with ${title}`}
	onclick={finish}
>
	{#if repeating}
		<SkipForward size={16} aria-hidden="true" />
	{:else}
		<Check size={16} aria-hidden="true" />
	{/if}
	<span class={styles.actionText}>{repeating ? 'Skip' : 'Done'}</span>
</button>

<Menu.Root bind:open={snoozeOpen} positioning={{ placement: 'bottom-end' }} lazyMount unmountOnExit>
	<Menu.Trigger class={styles.action} title="Snooze" aria-label={`Snooze ${title}`}>
		<Clock size={16} aria-hidden="true" />
		<span class={styles.actionText}>Snooze</span>
		<ChevronDown size={14} class={styles.actionText} aria-hidden="true" />
	</Menu.Trigger>
	<!-- Portalled like the card's menu, so the feed's scroll frame never clips it. -->
	{#if snoozeOpen}
		<div {@attach portalToAppOverlay} class={menuStyles.portal} style="pointer-events: none">
			<Menu.Positioner class={menuStyles.positioner}>
				<Menu.Content class={cx(popover, menuStyles.menu)} aria-label="Snooze">
					{#each choices as choice (choice.id)}
						<Menu.Item value={choice.id} onSelect={() => snooze(choice.at)} class={itemClass}>
							{choice.label}
						</Menu.Item>
					{/each}
					<Menu.Separator class={menuStyles.separator} />
					<Menu.Item value="pick" onSelect={() => (pickerOpen = true)} class={itemClass}>
						Pick a time…
					</Menu.Item>
				</Menu.Content>
			</Menu.Positioner>
		</div>
	{/if}
</Menu.Root>

{#if pickerOpen}
	<Dialog.Root
		open
		onOpenChange={(details) => {
			if (!details.open) pickerOpen = false;
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
						repeat={note.repeat}
						onApply={(r, repeat) => {
							notesStore.setReminder(note.id, r, repeat);
							settled();
							pickerOpen = false;
						}}
						onClose={() => {
							pickerOpen = false;
						}}
					/>
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	</Dialog.Root>
{/if}
