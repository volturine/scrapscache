<script lang="ts">
	// The "Take a note…" bar at the top of a feed. It opens in place into a title,
	// a body and the editor's own footer, and writes a real note as soon as there
	// is something to keep, so nothing typed is lost; the feed leaves that note out
	// until the bar is put away. Done, Esc or a click outside keep a note with
	// content and drop an empty one.
	import { onMount, tick } from 'svelte';
	import { css, cx } from 'styled-system/css';
	import { button, iconButton, noteSurface } from 'styled-system/recipes';
	import { flex } from 'styled-system/patterns';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { iconSizeMd as iconMd, noteComposerStyles as styles } from '$panda/styles';
	import BodyEditor from './BodyEditor.svelte';
	import ColorPalette from './ColorPalette.svelte';
	import LabelMenu from './LabelMenu.svelte';
	import NoteEditorFooter from './NoteEditorFooter.svelte';
	import ReminderLabel from './ReminderLabel.svelte';
	import ReminderPicker from './ReminderPicker.svelte';
	import Tooltip from './Tooltip.svelte';
	import { portalToAppOverlay } from '#lib/appViewport.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import type { NotePatch, ReminderRepeat } from '#lib/model/index.js';
	import { composerStore, type ComposerSeed } from '#lib/stores/composer.svelte.js';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { reminderStore } from '#lib/stores/reminders.svelte.js';
	import { storagePersistenceStore } from '#lib/stores/storagePersistence.svelte.js';
	import type { NoteColor, NoteImage } from '#lib/types.js';
	import { plainLine } from '#lib/noteLine.js';
	import { reminderTimeForDay } from '#lib/utils.js';
	import { AlarmClock, Image, Maximize2, PenLine, SquareCheck } from '@lucide/svelte';

	let {
		labels = [],
		reminderDay = null,
		placeholder = 'Take a note…'
	}: {
		/** Labels a new note starts with: the label view's own. */
		labels?: string[];
		/** A day ("YYYY-MM-DD") a new note gets a reminder on: the reminders view's. */
		reminderDay?: string | null;
		placeholder?: string;
	} = $props();

	const { openNote } = useEditorActions();

	let root = $state<HTMLElement | null>(null);
	let open = $state(false);
	let draftId = $state<string | null>(null);
	let title = $state('');
	let body = $state('');
	let images = $state<NoteImage[]>([]);
	let color = $state<NoteColor>('default');
	let reminder = $state<number | null>(null);
	let repeat = $state<ReminderRepeat | null>(null);
	let titleEdited = false;
	let bodyEdited = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let titleInput = $state<HTMLTextAreaElement | null>(null);
	let bodyEditor = $state<BodyEditor | undefined>();
	let footer = $state<NoteEditorFooter | undefined>();
	let reminderPicker = $state<ReminderPicker | undefined>();
	let paletteOpen = $state(false);
	let labelOpen = $state(false);
	let reminderOpen = $state(false);

	/** The written note, for what other controls changed on it (labels, a reminder). */
	const draft = $derived(draftId ? notesStore.notes.find((n) => n.id === draftId) : undefined);
	const hasLabels = $derived((draft?.labels.length ?? labels.length) > 0);
	const shownReminder = $derived(draft ? draft.reminder : reminder);
	const shownRepeat = $derived(draft ? (draft.repeat ?? null) : repeat);
	const popupOpen = $derived(paletteOpen || labelOpen || reminderOpen);

	const popupBackdrop = css({
		position: 'fixed',
		inset: 0,
		bg: 'scrapscache.backdropSoft',
		backdropFilter: 'blur(2px)'
	});
	const popupPositioner = flex({
		position: 'fixed',
		inset: 0,
		align: 'center',
		justify: 'center',
		p: 'lg'
	});

	/** Words in the body, not counting an empty checklist or bullet row. */
	function bodyHasText(): boolean {
		return body.split('\n').some((line) => plainLine(line) !== '');
	}

	function hasContent(): boolean {
		return title.trim() !== '' || bodyHasText() || images.length > 0;
	}

	/** The note on disk, made the first time there is a reason to have one. */
	function ensureNote(): string {
		if (draftId) return draftId;
		const note = notesStore.createNote({
			title,
			body,
			images,
			color,
			labels,
			reminder,
			...(repeat ? { repeat } : {})
		});
		storagePersistenceStore.requestOnce();
		titleEdited = false;
		bodyEdited = false;
		draftId = note.id;
		composerStore.draftId = note.id;
		return note.id;
	}

	function scheduleCommit() {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			commitDraft();
		}, 800);
	}

	/** Save what was typed since the last time, plus any explicit change. */
	function commitDraft(patch: NotePatch = {}) {
		bodyEditor?.syncBodyNow?.();
		if (timer) clearTimeout(timer);
		timer = null;
		const next: NotePatch = { ...patch };
		if (titleEdited) next.title = title;
		if (bodyEdited) next.body = body;
		titleEdited = false;
		bodyEdited = false;
		// Nothing worth a note yet: an empty bar, or a checklist row with no words.
		if (!draftId && !hasContent()) return;
		const id = ensureNote();
		if (Object.keys(next).length > 0) notesStore.updateNote(id, next);
	}

	function openWith(seed: ComposerSeed = {}) {
		const opening = !open;
		if (opening) {
			title = seed.title ?? '';
			body = seed.checklist ? '- [ ] ' : (seed.body ?? '');
			images = [];
			color = 'default';
			reminder = reminderDay ? reminderTimeForDay(reminderDay) : null;
			repeat = null;
			open = true;
		} else if (seed.title || seed.body) {
			// Already open: what is handed over joins what is there rather than being lost.
			bodyEditor?.syncBodyNow?.();
			let incoming = seed.body ?? '';
			if (seed.title) {
				if (title.trim() === '') {
					title = seed.title;
					titleEdited = true;
				} else {
					incoming = incoming ? `${seed.title}\n${incoming}` : seed.title;
				}
			}
			if (incoming) {
				const next = body.trim() === '' ? incoming : `${body}\n${incoming}`;
				body = next;
				bodyEdited = true;
				void bodyEditor?.replaceBodyWithText(next);
			}
			commitDraft();
		}
		// Pasted text is a note already; a blank bar waits for the first key.
		if (seed.title || seed.body) ensureNote();
		void tick().then(() => {
			// A blank bar starts at the title and handed-over text at the body; asked again
			// with nothing new, an open bar leaves the writer wherever they are.
			if (seed.title || seed.body || seed.checklist) bodyEditor?.focusDefault();
			else if (opening) titleInput?.focus();
			if (seed.attach === 'drawing') void footer?.openCanvas();
			else if (seed.attach === 'photo') footer?.openAttach();
		});
	}

	function reset() {
		open = false;
		paletteOpen = false;
		labelOpen = false;
		reminderOpen = false;
		draftId = null;
		title = '';
		body = '';
		images = [];
		color = 'default';
		reminder = null;
		repeat = null;
		titleEdited = false;
		bodyEdited = false;
	}

	/** Put the bar away: a note with content stays, an empty one goes. */
	async function finish() {
		if (!open) return;
		bodyEditor?.syncBodyNow?.();
		if (timer) clearTimeout(timer);
		timer = null;
		// A checklist started and left empty is no body at all.
		if (!bodyHasText()) body = '';
		const id = draftId ?? (hasContent() ? ensureNote() : null);
		if (id) notesStore.updateNote(id, { title, body });
		reset();
		if (id) await notesStore.discardIfEmpty(id);
		composerStore.draftId = null;
		if (id) void notesStore.syncPendingChanges();
	}

	/** Carry what was typed into the full editor. */
	function openInEditor() {
		commitDraft();
		const id = ensureNote();
		reset();
		composerStore.draftId = null;
		openNote(id);
	}

	function onTitleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			bodyEditor?.focusDefault();
		}
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open && !popupOpen) {
			event.preventDefault();
			void finish();
		}
	}

	onMount(() => composerStore.attach((seed) => openWith(seed)));

	// A press anywhere else puts the bar away; its own popups and the app's overlays
	// (dialogs, menus, the canvas editor) are part of it.
	$effect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node) || root?.contains(target)) return;
			if (
				target instanceof Element &&
				target.closest('[data-app-overlay], [role="dialog"], [role="menu"], .canvas-editor-shell')
			)
				return;
			void finish();
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
	bind:this={root}
	class={styles.root}
	aria-label="New note"
	data-note-composer
	data-open={open ? '' : undefined}
	onkeydown={onKeydown}
>
	{#if !open}
		<div class={styles.bar}>
			<button type="button" class={styles.prompt} onclick={() => openWith()}>
				{placeholder}
			</button>
			<Tooltip content="New checklist">
				<button
					type="button"
					class={iconButton({ variant: 'ghost', size: 'standard' })}
					aria-label="New checklist"
					onclick={() => openWith({ checklist: true })}
				>
					<SquareCheck class={iconMd} aria-hidden="true" />
				</button>
			</Tooltip>
			<Tooltip content="New drawing">
				<button
					type="button"
					class={iconButton({ variant: 'ghost', size: 'standard' })}
					aria-label="New drawing"
					onclick={() => openWith({ attach: 'drawing' })}
				>
					<PenLine class={iconMd} aria-hidden="true" />
				</button>
			</Tooltip>
			<Tooltip content="New photo note">
				<button
					type="button"
					class={iconButton({ variant: 'ghost', size: 'standard' })}
					aria-label="New photo note"
					onclick={() => openWith({ attach: 'photo' })}
				>
					<Image class={iconMd} aria-hidden="true" />
				</button>
			</Tooltip>
		</div>
	{:else}
		<div class={cx(styles.sheet, noteSurface({ color }))}>
			<textarea
				bind:this={titleInput}
				class={styles.title}
				placeholder="Title"
				rows="1"
				bind:value={title}
				oninput={() => {
					titleEdited = true;
					scheduleCommit();
				}}
				onkeydown={onTitleKeydown}></textarea>
			<div class={styles.body}>
				<BodyEditor
					bind:this={bodyEditor}
					bind:body
					{title}
					oninput={() => {
						bodyEdited = true;
						scheduleCommit();
					}}
					placeholder="Take a note… type [ ] for a checklist, - for a bullet"
				/>
			</div>
			{#if shownReminder != null}
				<button
					type="button"
					class={styles.chip}
					aria-label="Edit reminder"
					onclick={() => (reminderOpen = true)}
				>
					<ReminderLabel reminder={shownReminder} repeat={shownRepeat} variant="chip" />
				</button>
			{/if}
			<NoteEditorFooter
				bind:this={footer}
				bind:images
				bind:body
				noteId={draftId}
				{hasLabels}
				{color}
				onOpenColor={() => (paletteOpen = true)}
				onOpenTags={() => {
					ensureNote();
					labelOpen = true;
				}}
				onImagesChange={(next) => commitDraft({ images: next })}
			>
				{#snippet trailing()}
					<Tooltip content="Reminder">
						<button
							type="button"
							class={iconButton({ variant: 'ghost', size: { base: 'compact', sm: 'standard' } })}
							title="Reminder"
							aria-label="Reminder"
							onclick={() => (reminderOpen = true)}
						>
							<AlarmClock
								class={iconMd}
								fill={shownReminder != null ? 'currentColor' : 'none'}
								aria-hidden="true"
							/>
						</button>
					</Tooltip>
					<Tooltip content="Open in the editor">
						<button
							type="button"
							class={iconButton({ variant: 'ghost', size: { base: 'compact', sm: 'standard' } })}
							title="Open in the editor"
							aria-label="Open in the editor"
							onclick={openInEditor}
						>
							<Maximize2 class={iconMd} aria-hidden="true" />
						</button>
					</Tooltip>
					<button
						type="button"
						class={cx(button({ variant: 'primary', size: 'sm' }), styles.done)}
						onclick={() => void finish()}
					>
						Done
					</button>
				{/snippet}
			</NoteEditorFooter>
		</div>
	{/if}
</section>

{#if paletteOpen}
	<Dialog.Root
		open
		onOpenChange={(details) => {
			if (!details.open) paletteOpen = false;
		}}
		preventScroll={false}
	>
		<div {@attach portalToAppOverlay} class={styles.popupLayer} role="presentation">
			<Dialog.Backdrop class={popupBackdrop} />
			<Dialog.Positioner class={popupPositioner}>
				<Dialog.Content class={css({ outline: 'none' })}>
					<ColorPalette
						{color}
						onSelect={(next) => {
							color = next;
							paletteOpen = false;
							notesStore.updateNote(ensureNote(), { color: next });
						}}
					/>
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	</Dialog.Root>
{/if}

{#if labelOpen && draftId}
	<Dialog.Root
		open
		onOpenChange={(details) => {
			if (!details.open) labelOpen = false;
		}}
		preventScroll={false}
	>
		<div {@attach portalToAppOverlay} class={styles.popupLayer} role="presentation">
			<Dialog.Backdrop class={popupBackdrop} />
			<Dialog.Positioner class={popupPositioner}>
				<Dialog.Content class={css({ outline: 'none' })}>
					<LabelMenu noteId={draftId} onClose={() => (labelOpen = false)} />
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	</Dialog.Root>
{/if}

{#if reminderOpen}
	<Dialog.Root
		open
		onOpenChange={(details) => {
			if (!details.open) reminderOpen = false;
		}}
		initialFocusEl={() => reminderPicker?.initialFocus() ?? null}
		preventScroll={false}
	>
		<div {@attach portalToAppOverlay} class={styles.popupLayer} role="presentation">
			<Dialog.Backdrop class={popupBackdrop} />
			<Dialog.Positioner class={popupPositioner}>
				<Dialog.Content class={css({ outline: 'none' })}>
					<ReminderPicker
						bind:this={reminderPicker}
						reminder={shownReminder}
						repeat={shownRepeat}
						onApply={(at, next) => {
							reminder = at;
							repeat = next;
							reminderOpen = false;
							notesStore.setReminder(ensureNote(), at, next);
							reminderStore.sync(notesStore.notes);
						}}
						onClose={() => (reminderOpen = false)}
					/>
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	</Dialog.Root>
{/if}
