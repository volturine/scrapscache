<script lang="ts">
	import { noteEditorReminderTone, noteEditorStyles as styles } from '$panda/styles';
	import { cx } from 'styled-system/css';
	import { dialog, iconButton, input, noteSurface } from 'styled-system/recipes';
	import { flex, hstack, spacer } from 'styled-system/patterns';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { flushSync, onMount, tick, untrack } from 'svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { noteToPlainText, noteAttachments, splitPastedHeading } from '$lib/checklistBody';
	import { mergeHydratedImages } from '$lib/noteAttachmentHydration';
	import type { Note, NoteImage } from '$lib/types';
	import type { NotePatch } from '$lib/model';
	import ColorPalette from './ColorPalette.svelte';
	import ReminderPicker from './ReminderPicker.svelte';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import LabelMenu from './LabelMenu.svelte';
	import NoteEditorFooter from './NoteEditorFooter.svelte';
	import BodyEditor from './BodyEditor.svelte';
	import TimeTravel from './TimeTravel.svelte';
	import { syncStore } from '$lib/stores/sync.svelte';
	import type { NoteHistoryEntry } from '$lib/historyClient';
	import { BackupImportMode, prepareImportedNotes } from '$lib/backup';
	import { editContext } from '$lib/editContext';
	import { appClock } from '$lib/appClock.svelte';
	import { formatReminder, isReminderOverdue, noteActivity } from '$lib/utils';
	import ReminderLabel from './ReminderLabel.svelte';
	import {
		Bell,
		ChevronLeft,
		Lock,
		LockOpen,
		Maximize2,
		Minimize2,
		Paperclip,
		Pin
	} from '@lucide/svelte';

	import { revealEditorField, revealEditorPoint } from '$lib/editorVisibility';
	import { getClipboardFiles, isImageAttachment } from '$lib/noteImages';
	import { matchTrailingEmoticon } from '$lib/emoticons';
	import { isKeyboardField } from '$lib/appViewport';

	let {
		noteId = $bindable(),
		onClose,
		registerClose,
		autofocusBody = false
	}: {
		noteId: string | null;
		onClose: () => void;
		registerClose?: (close: () => void) => void;
		autofocusBody?: boolean;
	} = $props();

	const note = $derived(noteId ? notesStore.notes.find((n) => n.id === noteId) : null);
	const isOpen = $derived(noteId !== null && note !== null);
	const reminderOverdue = $derived(
		note?.reminder != null && isReminderOverdue(note.reminder, appClock.now)
	);
	const reminderLabel = $derived(formatReminder(note?.reminder ?? null, appClock.now));
	const activity = $derived(note ? noteActivity(note, appClock.now) : null);
	const activityLabel = $derived(
		activity && note && !note.trashed && note.updatedAt > note.createdAt
			? activity.absoluteLabel
			: activity?.label
	);

	let taskFocusLine = $state<number | null>(null);

	// Parent remounts this editor when the note id changes. The draft starts from
	// the store and takes later store changes only for fields not being edited.
	// svelte-ignore state_referenced_locally
	let title = $state(note?.title ?? '');
	// svelte-ignore state_referenced_locally
	let body = $state(note?.body ?? '');

	let paletteOpen = $state(false);
	let reminderOpen = $state(false);
	let labelOpen = $state(false);
	let historyPreview = $state.raw<{ note: Note; entry: NoteHistoryEntry } | null>(null);
	let restoreConfirmOpen = $state(false);
	let restoringPreview = $state(false);
	let historyRestoreError = $state('');
	let copyFlash = $state(false);
	let copyFlashTimer: ReturnType<typeof setTimeout> | null = null;
	// svelte-ignore state_referenced_locally
	let images = $state<NoteImage[]>(
		note ? noteAttachments(note).map((attachment) => ({ ...attachment })) : []
	);
	/** Edits in this session were committed and need a durable flush on close. */
	let draftDirty = false;
	// Only fields edited here are saved. Stamping an untouched field would make
	// this draft's stale copy beat a newer edit from another device in the merge.
	let titleEdited = false;
	let bodyEdited = false;
	let bodyEditor = $state<{
		focusDefault(): void;
		replaceBodyWithText(text: string): Promise<void>;
		syncBodyNow?(): void;
		finishInput?(): void;
		adoptBody?(text: string): boolean;
	} | null>(null);
	let footer = $state<{ handlePickedFiles(files: File[]): void } | null>(null);
	let editorDialog = $state<HTMLDivElement | null>(null);
	let fileDropActive = $state(false);
	let editorScroller = $state<HTMLDivElement | null>(null);
	let revealTimer: ReturnType<typeof setTimeout> | null = null;
	let editorTouchGesture:
		| {
				pointerId: number;
				field: HTMLElement;
				startX: number;
				startY: number;
				startScrollTop: number;
				moved: boolean;
		  }
		| undefined;
	const TOUCH_TAP_SLOP = 8;
	const AUTO_EXPAND_MAX_LINES = 8;
	let autoExpanded = $state(false);
	// The header toggle applies to this open note only and overrides auto-expand.
	let manualExpanded = $state<boolean | null>(null);
	const expanded = $derived(manualExpanded ?? autoExpanded);
	let autoExpandFrame = 0;
	const photosFillEditor = $derived(body.trim() === '' && images.some(isImageAttachment));
	function exitTaskFocus() {
		taskFocusLine = null;
	}

	function focusBodyFromPage(event: MouseEvent) {
		if (historyPreview) return;
		const target = event.target;
		const el = target instanceof Element ? target : null;
		// Task rows and the focused envelope manage their own chrome.
		if (el?.closest('[data-focus-group], [data-task-row], [data-add-subtask]')) return;

		// Match any contenteditable host (including plaintext-only). A strict ="true"
		// check lets page clicks steal focus and collapse multi-line iOS selections.
		if (el?.closest('button, input, textarea, select, a, [contenteditable]')) return;
		const active = document.activeElement;
		if (active instanceof HTMLElement && editorDialog?.contains(active)) {
			// Android keeps a contenteditable focused after its software-keyboard
			// dismiss action. Treat a tap on empty note chrome like the header buttons:
			// explicitly blur the field so the keyboard can close reliably.
			exitTaskFocus();
			active.blur();
			return;
		}
		if (taskFocusLine !== null) exitTaskFocus();
		bodyEditor?.focusDefault();
	}

	function revealFocusedEditorField() {
		if (!isOpen || !editorDialog || !editorScroller) return;
		const focused = document.activeElement;
		if (!(focused instanceof HTMLElement) || !editorDialog.contains(focused)) return;
		let field = focused.closest('input, textarea, select, [contenteditable]') as HTMLElement | null;
		if (!field) return;
		if (field.matches('[data-body-editor]')) {
			const anchor = window.getSelection()?.anchorNode;
			const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
			const selectedLine = anchorElement?.closest('[data-editor-line]') as HTMLElement | null;
			if (selectedLine && field.contains(selectedLine)) field = selectedLine;
		}

		revealEditorField(editorScroller, field);
	}

	function queueFocusedEditorReveal() {
		if (revealTimer !== null) clearTimeout(revealTimer);
		// Mobile browsers emit resize/scroll events throughout the keyboard animation.
		// Reveal once after those events settle instead of chasing every animation frame.
		revealTimer = setTimeout(() => {
			revealTimer = null;
			revealFocusedEditorField();
		}, 100);
	}

	onMount(() => {
		registerClose?.(() => {
			if (isOpen) void close();
		});
		const viewport = window.visualViewport;
		const onViewportChange = () => {
			if (!isOpen) return;
			lockPageScroll();
			queueFocusedEditorReveal();
		};
		const onFocusIn = (event: FocusEvent) => {
			if (event.target instanceof Node && editorDialog?.contains(event.target)) {
				lockPageScroll();
				queueFocusedEditorReveal();
			}
		};
		const onOuterScroll = () => lockPageScroll();
		viewport?.addEventListener('resize', onViewportChange);
		viewport?.addEventListener('scroll', onViewportChange);
		window.addEventListener('resize', onViewportChange);
		window.addEventListener('resize', onResizeAutoExpand);
		document.addEventListener('focusin', onFocusIn);
		queueAutoExpand(false);
		if (noteId) {
			lockPageScroll();
			const id = noteId;
			void notesStore.ensureNoteAttachments(id).then(() => {
				const hydrated = notesStore.notes.find((item) => item.id === id);
				if (!hydrated) return;
				images = mergeHydratedImages(images, noteAttachments(hydrated));
			});
			window.addEventListener('scroll', onOuterScroll, { capture: true, passive: false });
			viewport?.addEventListener('scroll', onOuterScroll);
		}
		if (autofocusBody) {
			void tick().then(() => {
				bodyEditor?.focusDefault();
				setTimeout(() => bodyEditor?.focusDefault(), 50);
			});
		}
		return () => {
			registerClose?.(() => {});
			viewport?.removeEventListener('resize', onViewportChange);
			viewport?.removeEventListener('scroll', onViewportChange);
			window.removeEventListener('resize', onViewportChange);
			window.removeEventListener('resize', onResizeAutoExpand);
			cancelAnimationFrame(autoExpandFrame);
			document.removeEventListener('focusin', onFocusIn);
			window.removeEventListener('scroll', onOuterScroll, { capture: true });
			viewport?.removeEventListener('scroll', onOuterScroll);
			if (revealTimer !== null) clearTimeout(revealTimer);
			if (copyFlashTimer !== null) clearTimeout(copyFlashTimer);
		};
	});

	$effect(() => {
		if (!isOpen || !expanded || !editorDialog) return;
		void note?.color;
		void uiStore.effectiveDark;
		const root = document.documentElement;
		// Paint the safe areas around a full-page note in the note's own colour.
		root.style.setProperty('--editor-page-bg', getComputedStyle(editorDialog).backgroundColor);
		root.classList.add('editor-expanded');
		return () => {
			root.classList.remove('editor-expanded');
			root.style.removeProperty('--editor-page-bg');
		};
	});

	function toggleExpanded() {
		manualExpanded = !expanded;
	}

	/** Body lines the note area fits, or Infinity before layout. */
	function visibleBodyLines(): number {
		const dialog = editorDialog;
		const field = dialog?.querySelector('[data-body-editor]');
		if (!dialog || !field || dialog.clientHeight === 0) return Infinity;
		const lineHeight = parseFloat(getComputedStyle(field).lineHeight);
		if (!(lineHeight > 0)) return Infinity;
		const chrome = dialog.querySelectorAll<HTMLElement>(
			':scope > header, :scope > footer, :scope > [data-preview-panel]'
		);
		let space = dialog.clientHeight;
		for (const el of chrome) space -= el.offsetHeight;
		return space / lineHeight;
	}

	function updateAutoExpand(resized: boolean) {
		if (!isOpen || manualExpanded !== null) return;
		// The software keyboard shrinks the viewport; never flip the layout while typing.
		if (
			document.documentElement.classList.contains('keyboard-open') ||
			(resized && navigator.maxTouchPoints > 0 && isKeyboardField(document.activeElement))
		) {
			return;
		}
		// Lay the note out at its normal size within this frame, then measure it.
		autoExpanded = false;
		flushSync();
		autoExpanded = visibleBodyLines() <= AUTO_EXPAND_MAX_LINES;
	}

	function queueAutoExpand(resized: boolean) {
		cancelAnimationFrame(autoExpandFrame);
		// Runs before the next paint, so the normal-size measurement never shows.
		autoExpandFrame = requestAnimationFrame(() => updateAutoExpand(resized));
	}
	const onResizeAutoExpand = () => queueAutoExpand(true);

	function lockPageScroll() {
		window.scrollTo(0, 0);
		document.documentElement.scrollTop = 0;
		document.body.scrollTop = 0;
	}

	function editorFieldFromTarget(target: EventTarget | null): HTMLElement | null {
		if (!(target instanceof Element) || !editorScroller) return null;
		const field = target.closest('textarea, input[type="text"], [contenteditable]');
		return field instanceof HTMLElement && editorScroller.contains(field) ? field : null;
	}

	function beginEditorTouch(event: PointerEvent) {
		if (event.pointerType !== 'touch' || !editorScroller) return;
		const field = editorFieldFromTarget(event.target);
		if (!field) return;
		editorTouchGesture = {
			pointerId: event.pointerId,
			field,
			startX: event.clientX,
			startY: event.clientY,
			startScrollTop: editorScroller.scrollTop,
			moved: false
		};
	}

	function moveEditorTouch(event: PointerEvent) {
		const gesture = editorTouchGesture;
		if (!gesture || event.pointerId !== gesture.pointerId || !editorScroller) return;
		if (
			Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > TOUCH_TAP_SLOP ||
			Math.abs(editorScroller.scrollTop - gesture.startScrollTop) > 1
		) {
			gesture.moved = true;
		}
	}

	function cancelEditorTouch(event: PointerEvent) {
		if (editorTouchGesture?.pointerId === event.pointerId) editorTouchGesture = undefined;
	}

	function completeEditorTouch(event: PointerEvent) {
		const gesture = editorTouchGesture;
		editorTouchGesture = undefined;
		if (
			event.pointerType !== 'touch' ||
			!editorScroller ||
			!gesture ||
			event.pointerId !== gesture.pointerId ||
			gesture.moved ||
			Math.abs(editorScroller.scrollTop - gesture.startScrollTop) > 1 ||
			editorFieldFromTarget(event.target) !== gesture.field
		) {
			return;
		}
		const field = gesture.field;

		// Establish the touch point's safe area inside the note body before Safari
		// handles the gesture. This also covers an already-active or wrapped field:
		// native caret placement no longer needs to pan the visual viewport.
		revealEditorPoint(editorScroller, event.clientY);
		lockPageScroll();
		if (document.activeElement === field) return;

		// Run the focusing step inside the touch gesture before Safari's default
		// focus action. Flush the task-focus chrome in that same transaction, then
		// compensate for its layout change around the tapped row. The note body is
		// the only scroll owner; the later native action only places the exact caret.
		const anchorTop = field.getBoundingClientRect().top;
		try {
			field.focus({ preventScroll: true });
		} catch {
			field.focus();
		}
		flushSync();
		const movedBy = field.getBoundingClientRect().top - anchorTop;
		editorScroller.scrollTop += movedBy;
		lockPageScroll();
	}

	function focusTask(line: number) {
		// The task row stays mounted, so the browser already owns the exact caret
		// and keyboard focus from the tap. Only update the inline focus chrome.
		taskFocusLine = line;
	}

	function handleBack() {
		// Always leave the note. Task focus mode must not trap the user behind a
		// second back press or block dismissing the editor.
		void close();
	}

	function closePopups() {
		paletteOpen = false;
		reminderOpen = false;
		labelOpen = false;
	}

	function previewHistoryVersion(version: Note, entry: NoteHistoryEntry) {
		historyPreview = { note: version, entry };
		restoreConfirmOpen = false;
		historyRestoreError = '';
	}

	function exitHistoryPreview() {
		historyPreview = null;
		restoreConfirmOpen = false;
		historyRestoreError = '';
		void tick().then(() =>
			editorDialog?.querySelector<HTMLTextAreaElement>('[data-note-title]')?.focus()
		);
	}

	function beginRestoreConfirmation() {
		restoreConfirmOpen = true;
		void tick().then(() =>
			editorDialog
				?.querySelector<HTMLButtonElement>('[data-history-restore-action="confirm"]')
				?.focus()
		);
	}

	function cancelRestoreConfirmation() {
		restoreConfirmOpen = false;
		void tick().then(() =>
			editorDialog
				?.querySelector<HTMLButtonElement>('[data-history-restore-action="start"]')
				?.focus()
		);
	}

	async function confirmHistoryRestore() {
		if (!historyPreview || restoringPreview) return;
		restoringPreview = true;
		historyRestoreError = '';
		try {
			await restoreNoteVersion(historyPreview.note);
		} catch (cause) {
			historyRestoreError =
				cause instanceof Error ? cause.message : 'Could not restore this note version.';
		} finally {
			restoringPreview = false;
		}
	}

	function openReminder() {
		closePopups();
		reminderOpen = true;
	}

	function keepEditorFocused(event: PointerEvent) {
		if (event.pointerType === 'touch') event.preventDefault();
	}

	function eventInsideEditor(target: EventTarget | null): boolean {
		if (!(target instanceof Node)) return false;
		if (editorDialog?.contains(target)) return true;
		const element = target instanceof Element ? target : target.parentElement;
		return !!element?.closest('[data-editor-popup]');
	}

	function dataTransferHasFiles(dataTransfer: DataTransfer | null): boolean {
		return !!dataTransfer && Array.from(dataTransfer.types).includes('Files');
	}

	function pointerLeftElement(event: DragEvent, el: EventTarget | null): boolean {
		if (!(el instanceof Element)) return true;
		const rect = el.getBoundingClientRect();
		return (
			event.clientX <= rect.left ||
			event.clientX >= rect.right ||
			event.clientY <= rect.top ||
			event.clientY >= rect.bottom
		);
	}

	function handleFileDragEnter(event: DragEvent) {
		if (!dataTransferHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		fileDropActive = true;
	}

	function handleFileDragOver(event: DragEvent) {
		if (!dataTransferHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		fileDropActive = true;
	}

	function handleFileDragLeave(event: DragEvent) {
		if (!fileDropActive || !pointerLeftElement(event, event.currentTarget)) return;
		fileDropActive = false;
	}

	function handleFileDrop(event: DragEvent) {
		if (!dataTransferHasFiles(event.dataTransfer)) return;
		event.preventDefault();
		fileDropActive = false;
		backdropPressOutside = false;
		const files = Array.from(event.dataTransfer?.files ?? []);
		if (files.length > 0) footer?.handlePickedFiles(files);
	}

	function transformPaste(text: string): string | null {
		if (title || body) return null;
		const split = splitPastedHeading(text);
		if (!split) return null;
		title = split.title;
		titleEdited = true;
		return split.body;
	}

	// Same empty-note rule when the paste lands on the title field itself.
	function handleTitlePaste(event: ClipboardEvent) {
		if (!isOpen || !note) return;
		if (title || body) return;
		const text = event.clipboardData?.getData('text/plain');
		if (!text) return;
		const split = splitPastedHeading(text);
		if (!split) return;
		event.preventDefault();
		title = split.title;
		markTitleEdited();
		if (split.body) void bodyEditor?.replaceBodyWithText(split.body);
	}

	function handlePaste(event: ClipboardEvent) {
		if (!isOpen || !note) return;
		if (event.target instanceof Element && event.target.closest('.canvas-editor-shell')) return;
		const files = getClipboardFiles(event.clipboardData);
		if (files.length === 0) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		footer?.handlePickedFiles(files);
	}

	let backdropPressOutside = false;

	function handleBackdropPointerDown(event: PointerEvent) {
		backdropPressOutside = !eventInsideEditor(event.target);
	}

	function handleBackdropClick(event: MouseEvent) {
		// A press that starts in the note and ends on the overlay still emits a click here.
		if (!backdropPressOutside || eventInsideEditor(event.target)) return;
		void close();
	}

	function commit(patch: NotePatch) {
		if (!note) return;
		notesStore.updateNote(note.id, patch);
	}

	let timer: ReturnType<typeof setTimeout> | null = null;
	function scheduleCommit() {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			commitDraft();
		}, 800);
	}

	function markTitleEdited() {
		titleEdited = true;
		scheduleCommit();
	}

	function markBodyEdited() {
		bodyEdited = true;
		scheduleCommit();
	}

	/** Save the fields edited since the last commit, plus any explicit patch. */
	function commitDraft(patch: NotePatch = {}) {
		if (!note) return;
		// Syncing can report input and arm the save timer; this commit covers it.
		bodyEditor?.syncBodyNow?.();
		if (timer) clearTimeout(timer);
		timer = null;
		const next: NotePatch = { ...patch };
		if (titleEdited) next.title = title;
		// Link previews follow the body, so editing it drops imported ones.
		if (bodyEdited) Object.assign(next, { body, linkPreviews: [] });
		titleEdited = false;
		bodyEdited = false;
		if (Object.keys(next).length === 0) return;
		draftDirty = true;
		commit(next);
	}

	function commitNow(nextImages?: NoteImage[]) {
		commitDraft({ images: nextImages ?? images });
	}

	/** Attachment identity and metadata; loaded bytes are not an edit. */
	function attachmentSignature(attachments: NoteImage[]): string {
		return JSON.stringify(
			attachments.map(({ dataUrl: _dataUrl, thumbUrl: _thumbUrl, ...meta }) => meta)
		);
	}

	/** Take a store change made elsewhere into every field this draft is not editing. */
	function adoptStoreNote(current: Note) {
		if (!titleEdited && current.title !== title) title = current.title;
		const currentBody = current.body ?? '';
		// With no editor mounted (a history preview is showing), nothing is mid-typing.
		if (
			!bodyEdited &&
			currentBody !== body &&
			(!bodyEditor || bodyEditor.adoptBody?.(currentBody))
		) {
			body = currentBody;
		}
		// Attachment edits commit immediately, so the store owns the list; the
		// draft only contributes bytes it has already loaded.
		const stored = noteAttachments(current);
		if (attachmentSignature(stored) !== attachmentSignature(images)) {
			images = mergeHydratedImages(
				stored.map((attachment) => ({ ...attachment })),
				images
			);
		}
	}

	$effect(() => {
		const current = note;
		if (current) untrack(() => adoptStoreNote(current));
	});

	async function flushDraft() {
		// Text still being composed (an accent, a prediction) is on screen but not yet in the body.
		bodyEditor?.finishInput?.();
		commitDraft();
		if (note && draftDirty) {
			try {
				await notesStore.flushNote(note.id);
			} catch (err) {
				console.error('[NoteEditor] flush failed:', err);
			}
		}
		draftDirty = false;
	}

	async function close(preserveEmpty = false) {
		// Drop task-focus chrome immediately so dismiss is never gated on focus mode.
		taskFocusLine = null;
		await flushDraft();
		if (note && !preserveEmpty) await notesStore.discardIfEmpty(note.id);
		onClose();
		void notesStore.syncPendingChanges();
	}

	async function restoreNoteVersion(version: Note) {
		if (!note || version.id !== note.id || !syncStore.account) return;
		const id = note.id;
		const accountId = syncStore.account.accountId;
		await flushDraft();
		if (syncStore.account?.accountId !== accountId || !note) return;
		const restored = prepareImportedNotes([version], BackupImportMode.Keep, editContext)[0];
		const availableLabels = new Set(notesStore.labels.map((label) => label.id));
		notesStore.updateNote(id, {
			title: restored.title,
			body: restored.body,
			color: restored.color,
			pinned: restored.pinned,
			archived: restored.archived,
			trashed: restored.trashed,
			secret: restored.secret ?? false,
			reminder: restored.reminder,
			labels: restored.labels.filter((labelId) => availableLabels.has(labelId)),
			images: restored.images,
			linkPreviews: restored.linkPreviews ?? []
		});
		// adoptStoreNote carries the restored fields into the draft.
		exitHistoryPreview();
		void notesStore.syncPendingChanges();
	}

	async function copyText() {
		if (!note) return;
		bodyEditor?.syncBodyNow?.();
		const text = noteToPlainText({ ...note, title, body });
		let copied = false;
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
		} catch {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			try {
				copied = document.execCommand('copy');
			} catch {}
			document.body.removeChild(ta);
		}
		// Only confirm when the write actually landed; the button must not claim a
		// copy that failed (e.g. insecure origins where the async API is missing).
		if (!copied) return;
		copyFlash = true;
		if (copyFlashTimer !== null) clearTimeout(copyFlashTimer);
		copyFlashTimer = setTimeout(() => {
			copyFlash = false;
			copyFlashTimer = null;
		}, 1500);
	}
	function handleTitleInput(event: Event) {
		const target = event.target as HTMLTextAreaElement | null;
		if (title.includes('\n') || title.includes('\r')) {
			const start = target?.selectionStart ?? 0;
			const end = target?.selectionEnd ?? 0;
			title = title.replace(/[\r\n]+/g, ' ');
			if (target) {
				target.value = title;
				target.setSelectionRange(start, end);
			}
		}
		// `:)` + space becomes an emoji when the space is typed at the end.
		if (
			target &&
			title.endsWith(' ') &&
			target.selectionStart === title.length &&
			target.selectionEnd === title.length
		) {
			const before = title.slice(0, -1);
			const match = matchTrailingEmoticon(before);
			if (match) {
				title = before.slice(0, match.start) + match.emoji + ' ';
				target.value = title;
				const caret = match.start + match.emoji.length + 1;
				target.setSelectionRange(caret, caret);
			}
		}
		markTitleEdited();
	}

	function autoResizeTitle(node: HTMLTextAreaElement, _value?: string) {
		const resize = () => {
			node.style.height = 'auto';
			if (node.scrollHeight > 0) {
				node.style.height = `${node.scrollHeight}px`;
			}
		};
		resize();
		if (typeof requestAnimationFrame !== 'undefined') {
			requestAnimationFrame(resize);
		}
		node.addEventListener('input', resize);
		window.addEventListener('resize', resize);
		return {
			update() {
				resize();
			},
			destroy() {
				node.removeEventListener('input', resize);
				window.removeEventListener('resize', resize);
			}
		};
	}
	const editorDialogClass = $derived(
		cx(
			styles.dialogSurface,
			note ? noteSurface({ color: note.color }) : undefined,
			paletteOpen || labelOpen ? 'editor-caret-hidden' : undefined
		)
	);
	const titleField = cx(input({ variant: 'unstyled' }), styles.title);
	const subDialog = dialog({ size: 'sm' });
	const dialogBackdrop = cx(subDialog.backdrop, styles.subDialogBackdrop);
	const dialogPositioner = flex({
		position: 'fixed',
		inset: 0,
		zIndex: 61,
		align: 'center',
		justify: 'center'
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (!isOpen || e.key !== 'Escape') return;
		if (historyPreview) {
			exitHistoryPreview();
			return;
		}
		if (paletteOpen || reminderOpen || labelOpen) return;
		void close();
	}}
	onpastecapture={handlePaste}
/>

{#if isOpen && note}
	<div
		class={styles.overlay}
		data-editor-overlay
		role="presentation"
		onpointerdown={handleBackdropPointerDown}
		onclick={handleBackdropClick}
		ondragenter={handleFileDragEnter}
		ondragovercapture={handleFileDragOver}
		ondragleave={handleFileDragLeave}
		ondropcapture={handleFileDrop}
	>
		<div class={styles.sheetWrap({ expanded })} role="presentation">
			<!-- Clicking blank editor chrome is a pointer convenience; keyboard users focus the fields directly. -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div class={styles.sheetBox({ expanded })}>
				<div
					bind:this={editorDialog}
					class={editorDialogClass}
					role="dialog"
					tabindex="-1"
					aria-modal="true"
					aria-label="Note editor"
					onpointerdown={beginEditorTouch}
					onpointermove={moveEditorTouch}
					onpointerup={completeEditorTouch}
					onpointercancel={cancelEditorTouch}
					onclick={focusBodyFromPage}
				>
					{#if syncStore.account}
						{#key syncStore.account.accountId}
							<TimeTravel
								account={syncStore.account}
								{note}
								previewEntry={historyPreview?.entry ?? null}
								{restoreConfirmOpen}
								{restoringPreview}
								restoreError={historyRestoreError}
								onPreviewVersion={previewHistoryVersion}
								onCancelPreview={exitHistoryPreview}
								onStartRestore={beginRestoreConfirmation}
								onCancelRestore={cancelRestoreConfirmation}
								onConfirmRestore={() => void confirmHistoryRestore()}
							/>
						{/key}
					{/if}
					<!-- Header -->
					<header class={styles.header}>
						<button
							type="button"
							class={iconButton({ variant: 'ghost', size: 'standard' })}
							title="Close note"
							onclick={handleBack}
							aria-label="Close note"
						>
							<ChevronLeft size={24} aria-hidden="true" />
						</button>

						<div class={spacer()} aria-hidden="true"></div>

						<div class={hstack({ minW: 0, gap: '2xs' })}>
							{#if !historyPreview && !note.trashed && !note.archived}
								{#if note.reminder != null}
									<button
										type="button"
										class={styles.reminderButton}
										title={reminderOverdue ? `Overdue · ${reminderLabel}` : reminderLabel}
										onclick={openReminder}
										aria-label={reminderOverdue
											? `Overdue reminder, ${reminderLabel}`
											: `Reminder, ${reminderLabel}`}
									>
										<ReminderLabel reminder={note.reminder} variant="chip" />
									</button>
								{/if}
								<button
									type="button"
									class={cx(
										iconButton({ variant: 'ghost', size: 'sm' }),
										note.reminder == null
											? ''
											: noteEditorReminderTone[reminderOverdue ? 'overdue' : 'active']
									)}
									title="Reminder"
									onclick={openReminder}
									aria-label="Reminder"
								>
									<Bell size={20} aria-hidden="true" />
								</button>
								<button
									type="button"
									class={iconButton({ variant: 'ghost', size: 'sm' })}
									title={note.pinned ? 'Unpin' : 'Pin'}
									onclick={() => commit({ pinned: !note.pinned })}
									aria-label="Pin"
								>
									<Pin size={20} fill={note.pinned ? 'currentColor' : 'none'} aria-hidden="true" />
								</button>
								<button
									type="button"
									class={iconButton({ variant: 'ghost', size: 'sm' })}
									title={note.secret ? 'Remove secret' : 'Make secret'}
									onclick={() => commit({ secret: !note.secret })}
									aria-label={note.secret ? 'Remove secret' : 'Make secret'}
								>
									{#if note.secret}
										<Lock size={20} class={noteEditorReminderTone.active} aria-hidden="true" />
									{:else}
										<LockOpen size={20} aria-hidden="true" />
									{/if}
								</button>
							{/if}
							<button
								type="button"
								class={iconButton({ variant: 'ghost', size: 'sm' })}
								title={expanded ? 'Shrink note' : 'Expand note'}
								onclick={toggleExpanded}
								aria-label={expanded ? 'Shrink note' : 'Expand note'}
								aria-pressed={expanded}
							>
								{#if expanded}
									<Minimize2 size={20} aria-hidden="true" />
								{:else}
									<Maximize2 size={20} aria-hidden="true" />
								{/if}
							</button>
						</div>
					</header>

					<div
						bind:this={editorScroller}
						class={cx(
							'note-scrollbar-hidden scrollable',
							styles.scroller,
							historyPreview && styles.scrollerPreview,
							syncStore.account && styles.scrollerWithHistory,
							uiStore.rawMarkdown && styles.rawScroller,
							!historyPreview && photosFillEditor ? styles.scrollerFill : undefined
						)}
					>
						{#if historyPreview}
							{#key historyPreview.entry.historyId}
								<div class={styles.historyPreviewContent}>
									<h1 class={styles.historyPreviewTitle}>
										{historyPreview.note.title || 'Untitled note'}
									</h1>
									<BodyEditor
										body={historyPreview.note.body}
										readOnly
										placeholder="This note has no text."
									/>
									{#if historyPreview.note.images?.length}
										<div class={styles.historyPreviewMedia}>
											{#each historyPreview.note.images as image (image.id)}
												{#if image.mime.startsWith('image/')}
													<img
														class={styles.historyPreviewImage}
														src={image.dataUrl}
														alt={image.name || 'Note attachment'}
													/>
												{:else}
													<span class={styles.historyPreviewAttachment}
														>{image.name || 'Attachment'}</span
													>
												{/if}
											{/each}
										</div>
									{/if}
								</div>
							{/key}
						{:else}
							<textarea
								use:autoResizeTitle={title}
								data-note-title
								placeholder="Title"
								bind:value={title}
								oninput={handleTitleInput}
								onpaste={handleTitlePaste}
								onfocus={exitTaskFocus}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										bodyEditor?.focusDefault();
									}
								}}
								rows="1"
								class:markdown-raw={uiStore.rawMarkdown}
								class={titleField}></textarea>

							{#if activity}
								<p class={styles.meta} data-note-meta>
									<time datetime={new Date(activity.at).toISOString()} title={activity.detail}
										>{activityLabel}</time
									>
								</p>
							{/if}

							<BodyEditor
								bind:this={bodyEditor}
								bind:body
								oninput={markBodyEdited}
								{transformPaste}
								placeholder="Take a note… type [ ] for a checklist, - for a bullet, Tab for sub-task"
								focusLine={taskFocusLine}
								onFocusTask={focusTask}
								onExitTaskFocus={exitTaskFocus}
							/>
						{/if}
					</div>

					{#if !historyPreview}
						{#if fileDropActive}
							<div class={styles.fileDropHint} data-file-drop-hint aria-hidden="true">
								<div
									class={hstack({
										gap: 'sm',
										rounded: 'pill',
										bg: 'scrapscache.surface',
										px: 'lg',
										py: 'sm',
										textStyle: 'button',
										boxShadow: 'sm'
									})}
								>
									<Paperclip size={16} aria-hidden="true" />
									Drop to attach
								</div>
							</div>
						{/if}

						<NoteEditorFooter
							bind:this={footer}
							bind:images
							bind:body
							noteId={note.id}
							hasLabels={(note.labels?.length ?? 0) > 0}
							showCopy={true}
							showArchive={true}
							showDelete={true}
							archived={note.archived}
							trashed={note.trashed}
							{copyFlash}
							fillPhotos={photosFillEditor}
							color={note.color}
							onOpenColor={() => {
								closePopups();
								paletteOpen = true;
							}}
							onOpenTags={() => {
								closePopups();
								labelOpen = true;
							}}
							onCopy={() => void copyText()}
							onRestore={() => {
								notesStore.restoreNote(note.id);
								void close();
							}}
							onArchive={() => {
								if (note.trashed) notesStore.restoreToArchive(note.id);
								else notesStore.toggleArchive(note.id);
								void close();
							}}
							onDelete={() => {
								if (note.trashed) void notesStore.deleteNoteForever(note.id);
								else notesStore.trashNote(note.id);
								close();
							}}
							onImagesChange={(imgs) => commitNow(imgs)}
						/>
					{/if}
				</div>
			</div>
		</div>
	</div>

	{#if paletteOpen}
		<Dialog.Root
			open
			onOpenChange={(details) => {
				if (!details.open) paletteOpen = false;
			}}
			preventScroll={false}
		>
			<Dialog.Backdrop class={dialogBackdrop} />
			<Dialog.Positioner
				class={dialogPositioner}
				data-editor-popup
				onpointerdown={keepEditorFocused}
			>
				<Dialog.Content class={styles.popupContent}>
					<ColorPalette
						color={note.color}
						onSelect={(c) => {
							commit({ color: c });
							paletteOpen = false;
						}}
					/>
				</Dialog.Content>
			</Dialog.Positioner>
		</Dialog.Root>
	{/if}

	{#if reminderOpen}
		<Dialog.Root
			open
			onOpenChange={(details) => {
				if (!details.open) reminderOpen = false;
			}}
			preventScroll={false}
		>
			<Dialog.Backdrop class={dialogBackdrop} />
			<Dialog.Positioner class={dialogPositioner} data-editor-popup>
				<Dialog.Content class={styles.popupContent}>
					<ReminderPicker
						reminder={note.reminder}
						onApply={(r) => {
							commit({ reminder: r });
							reminderStore.sync(notesStore.notes);
							void notesStore.flushSync();
						}}
						onClose={() => {
							reminderOpen = false;
						}}
					/>
				</Dialog.Content>
			</Dialog.Positioner>
		</Dialog.Root>
	{/if}

	{#if labelOpen}
		<Dialog.Root
			open
			onOpenChange={(details) => {
				if (!details.open) labelOpen = false;
			}}
			preventScroll={false}
		>
			<Dialog.Backdrop class={dialogBackdrop} />
			<Dialog.Positioner
				class={dialogPositioner}
				data-editor-popup
				onpointerdown={keepEditorFocused}
			>
				<Dialog.Content class={styles.popupContent}>
					<LabelMenu
						noteId={note.id}
						onClose={() => {
							labelOpen = false;
						}}
					/>
				</Dialog.Content>
			</Dialog.Positioner>
		</Dialog.Root>
	{/if}
{/if}
