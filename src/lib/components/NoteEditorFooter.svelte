<script lang="ts">
	import { canvasPreview, filePreview, iconSizeMd as iconMd, photoPreview } from '$panda/styles';
	import { css, cx } from 'styled-system/css';
	import { button, choiceCard, dialog, iconButton } from 'styled-system/recipes';
	import { hstack, grid, flex } from 'styled-system/patterns';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { Format } from '@ark-ui/svelte/format';
	import AttachmentFullscreen from '$lib/components/AttachmentFullscreen.svelte';
	import CanvasEditor from '$lib/components/CanvasEditor.svelte';
	import PhotoFullscreen from '$lib/components/PhotoFullscreen.svelte';
	import Tooltip from './Tooltip.svelte';
	import type { NoteImage } from '$lib/types';
	import {
		fileToNoteImage,
		isImageAttachment,
		isInlinePreviewable,
		fileIconLabel,
		formatBytes,
		dataUrlByteLength,
		openAttachment,
		looksLikePhoto
	} from '$lib/noteImages';
	import { displayImageSrc } from '$lib/imageThumb';
	import type { ImageQuality } from '$lib/imageOptimize';
	import { extractHttpUrls, localLinkCard } from '$lib/linkPreview';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { sha256 } from '$lib/syncHash';
	import { formatStorageError } from '$lib/imageBlob';
	import { isKeyboardField } from '$lib/appViewport';
	import { isCanvasAttachment, mergeCanvasEdit } from '$lib/canvasAttachment';
	import { mergeHydratedImages } from '$lib/noteAttachmentHydration';
	import {
		Archive,
		ArchiveRestore,
		Check,
		Copy,
		Palette,
		Paperclip,
		PenLine,
		RotateCcw,
		Tag,
		Trash2,
		X
	} from '@lucide/svelte';

	let {
		images = $bindable<NoteImage[]>([]),
		body = $bindable(''),
		noteId = null as string | null,
		hasLabels = false,
		showCopy = false,
		showArchive = false,
		showDelete = false,
		archived = false,
		trashed = false,
		copyFlash = false,
		fillPhotos = false,
		onOpenColor,
		onOpenTags,
		onCopy,
		onRestore,
		onArchive,
		onDelete,
		onImagesChange,
		onClose
	}: {
		images?: NoteImage[];
		body?: string;
		noteId?: string | null;
		hasLabels?: boolean;
		showCopy?: boolean;
		showArchive?: boolean;
		showDelete?: boolean;
		archived?: boolean;
		trashed?: boolean;
		copyFlash?: boolean;
		/** Grow the photo strip to the editor's free height (for notes with no body text). */
		fillPhotos?: boolean;
		onOpenColor?: () => void;
		onOpenTags?: () => void;
		onCopy?: () => void;
		onRestore?: () => void;
		onArchive?: () => void;
		onDelete?: () => void;
		onImagesChange?: (images: NoteImage[]) => void;
		onClose?: () => void;
	} = $props();

	let focusedImageIndex = $state<number | null>(null);
	let focusedAttachment = $state<NoteImage | null>(null);
	let canvasEditorOpen = $state(false);
	let focusedCanvas = $state<NoteImage | null>(null);
	let attachError = $state('');
	let filesAwaitingQuality = $state<File[] | null>(null);

	const imageAttachments = $derived(images.filter(isImageAttachment));
	const canvases = $derived(images.filter(isCanvasAttachment));
	const photos = $derived(imageAttachments.filter((attachment) => !!displayImageSrc(attachment)));
	const pendingPhotos = $derived(
		imageAttachments.filter((attachment) => !displayImageSrc(attachment))
	);
	const files = $derived(images.filter((a) => !isImageAttachment(a) && !isCanvasAttachment(a)));
	const links = $derived(extractHttpUrls(body));
	const photoIndexById = $derived(new Map(photos.map((p, i) => [p.id, i])));

	/**
	 * Normal button: each press creates a one-shot file input in this gesture,
	 * opens the system picker, then discards the input so cancel cannot stick.
	 */
	function openAttach() {
		attachError = '';
		const active = document.activeElement;
		if (active instanceof HTMLElement && isKeyboardField(active)) active.blur();
		const input = document.createElement('input');
		input.type = 'file';
		input.multiple = true;
		// Off-screen but not display:none (iOS blocks programmatic open on those).
		input.setAttribute('aria-hidden', 'true');
		Object.assign(input.style, {
			position: 'fixed',
			left: '0',
			top: '0',
			width: '1px',
			height: '1px',
			opacity: '0',
			pointerEvents: 'none',
			zIndex: '-1'
		});
		document.body.appendChild(input);

		let done = false;
		const openedAt = Date.now();
		const cleanup = () => {
			if (done) return;
			done = true;
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('visibilitychange', onVis);
			queueMicrotask(() => {
				try {
					input.remove();
				} catch {
					/* ignore */
				}
			});
		};

		// Ignore focus blips while the sheet is still opening.
		const onFocus = () => {
			if (Date.now() - openedAt < 400) return;
			cleanup();
		};
		const onVis = () => {
			if (document.visibilityState !== 'visible') return;
			if (Date.now() - openedAt < 400) return;
			cleanup();
		};

		input.addEventListener(
			'change',
			() => {
				const picked = Array.from(input.files ?? []);
				cleanup();
				if (picked.length > 0) handlePickedFiles(picked);
			},
			{ once: true }
		);

		window.addEventListener('focus', onFocus);
		document.addEventListener('visibilitychange', onVis);

		input.click();
	}

	export function handlePickedFiles(picked: File[]) {
		if (picked.length === 0) return;
		if (picked.some(looksLikePhoto)) {
			filesAwaitingQuality = picked;
			return;
		}
		void addFiles(picked, 'compressed');
	}

	function chooseImageQuality(quality: ImageQuality) {
		const picked = filesAwaitingQuality;
		filesAwaitingQuality = null;
		if (picked) void addFiles(picked, quality);
	}

	async function addFiles(picked: File[], imageQuality: ImageQuality) {
		attachError = '';
		try {
			const added = await Promise.all(picked.map((file) => fileToNoteImage(file, imageQuality)));
			const knownHashes = new Set(
				await Promise.all(images.map((image) => image.contentHash || sha256(image.dataUrl)))
			);
			const unique: NoteImage[] = [];
			for (const att of added) {
				const hash = att.contentHash || (await sha256(att.dataUrl));
				if (knownHashes.has(hash)) continue;
				knownHashes.add(hash);
				unique.push(att);
			}
			if (unique.length === 0) return;
			const next = [...images, ...unique];
			images = next;
			onImagesChange?.(next);
			if (noteId) {
				try {
					await notesStore.flushNote(noteId, { images: next });
				} catch (err) {
					console.error('[footer] attachment flush:', err);
					attachError = `Could not save attachment: ${formatStorageError(err)}`;
				}
			}
		} catch (err) {
			attachError = err instanceof Error ? err.message : 'Could not add file';
		}
	}

	async function saveCroppedPhoto(cropped: NoteImage) {
		attachError = '';
		const next = images.map((image) => (image.id === cropped.id ? cropped : image));
		images = next;
		onImagesChange?.(next);
		if (noteId) {
			try {
				await notesStore.flushNote(noteId, { images: next });
			} catch (err) {
				console.error('[footer] crop flush:', err);
				attachError = `Could not save crop: ${formatStorageError(err)}`;
			}
		}
	}

	function removeAttachment(id: string) {
		const next = images.filter((i) => i.id !== id);
		images = next;
		onImagesChange?.(next);
		if (noteId) {
			notesStore.flushNote(noteId, { images: next }).catch((err) => {
				console.error('[footer] remove attachment flush:', err);
			});
		}
	}

	function openTags(e: MouseEvent) {
		e.stopPropagation();
		if (!noteId) {
			attachError = 'Save the note first to add labels';
			return;
		}
		onOpenTags?.();
	}

	async function openPhoto(id: string) {
		if (noteId) {
			await notesStore.ensureNoteAttachments(noteId);
			const hydratedNote = notesStore.notes.find((note) => note.id === noteId);
			if (hydratedNote?.images) {
				images = mergeHydratedImages(images, hydratedNote.images);
			}
		}
		const idx = photoIndexById.get(id) ?? photos.findIndex((photo) => photo.id === id);
		if (idx >= 0) focusedImageIndex = idx;
	}

	async function openFile(file: NoteImage) {
		attachError = '';
		let source = file;
		if (!source.dataUrl && noteId) {
			await notesStore.ensureNoteAttachments(noteId);
			const hydratedNote = notesStore.notes.find((note) => note.id === noteId);
			if (hydratedNote?.images) {
				images = mergeHydratedImages(images, hydratedNote.images);
				source = images.find((item) => item.id === file.id) ?? source;
			}
		}
		if (!source.dataUrl) {
			attachError = 'File is not available on this device.';
			return;
		}
		if (isInlinePreviewable(source)) focusedAttachment = { ...source };
		else void openAttachment(source);
	}

	async function openCanvas(attachment?: NoteImage) {
		attachError = '';
		if (!attachment) {
			focusedCanvas = null;
			canvasEditorOpen = true;
			return;
		}
		let source = attachment;
		if (!source.dataUrl && noteId) {
			await notesStore.ensureNoteAttachments(noteId);
			const hydratedNote = notesStore.notes.find((note) => note.id === noteId);
			source = hydratedNote?.images?.find((item) => item.id === attachment.id) ?? source;
		}
		if (!source.dataUrl) {
			attachError = 'Canvas data is not available on this device.';
			return;
		}
		focusedCanvas = { ...source };
		canvasEditorOpen = true;
	}

	async function saveCanvas(saved: NoteImage, sourceHash?: string) {
		const storeNote = noteId ? notesStore.notes.find((note) => note.id === noteId) : undefined;
		const currentImages = storeNote?.images ?? images;
		const merged = mergeCanvasEdit(currentImages, saved, sourceHash);
		if (merged.conflict) {
			attachError = 'The synced canvas changed while you were drawing, so both versions were kept.';
		}
		const next = merged.attachments;
		images = next;
		onImagesChange?.(next);
		if (noteId) await notesStore.flushNote(noteId, { images: next });
	}

	function keepFooterStationary(event: PointerEvent) {
		if (event.pointerType !== 'touch') return;
		const target = event.target instanceof Element ? event.target : null;
		if (!target?.closest('button')) return;
		// Moving focus on pointerdown starts Android's keyboard-close resize. The
		// footer then moves before pointerup and Chrome cancels the button click.
		event.preventDefault();
	}

	function footerInteractions(node: HTMLElement) {
		node.addEventListener('pointerdown', keepFooterStationary);
		return {
			destroy() {
				node.removeEventListener('pointerdown', keepFooterStationary);
			}
		};
	}

	const c = canvasPreview.editor;
	const f = filePreview.editor;
	const p = $derived(fillPhotos ? photoPreview.editorFill : photoPreview.editor);
	const d = dialog({ size: 'sm' });

	const qualityCompressedCard = choiceCard({ kind: 'compressed' });
	const qualityHdCard = choiceCard();
</script>

{#if attachError}
	<p class={css({ px: 'md', pb: '2xs', textStyle: 'label', color: 'scrapscache.danger' })}>
		{attachError}
	</p>
{/if}

{#if canvases.length > 0}
	<div class={`scrollable ${c.strip}`} aria-label="Canvases">
		{#each canvases as canvas (canvas.id)}
			<div class={c.wrap}>
				<button
					type="button"
					class={c.btn}
					onclick={() => void openCanvas(canvas)}
					aria-label={`Edit ${canvas.name ?? 'canvas'}`}
				>
					{#if displayImageSrc(canvas)}
						<img
							src={displayImageSrc(canvas)}
							alt={canvas.name ?? 'Canvas'}
							class={c.img}
							loading="lazy"
							decoding="async"
							draggable="false"
						/>
					{:else}
						<div class={c.loading}>Loading canvas…</div>
					{/if}
					<span class={c.caption}>
						{canvas.name ?? 'Canvas'}
					</span>
				</button>
				<button
					type="button"
					class={c.delBtn}
					onclick={() => removeAttachment(canvas.id)}
					aria-label="Remove canvas"
				>
					<X size={12} aria-hidden="true" />
				</button>
			</div>
		{/each}
	</div>
{/if}

{#if files.length > 0 || links.length > 0}
	<ul class={`note-scrollbar-hidden scrollable ${f.list}`} aria-label="Files and links">
		{#each files as file (file.id)}
			<li class={f.row}>
				<span class={f.badge} aria-hidden="true">{fileIconLabel(file.mime, file.name)}</span>
				<button
					type="button"
					class={f.openBtn}
					onclick={() => void openFile(file)}
					aria-label={`Open ${file.name ?? 'file'}`}
				>
					<div class={f.title}>
						{file.name || 'Attachment'}
					</div>
					<div class={f.size}>
						<Format.Byte value={dataUrlByteLength(file.dataUrl)} unitSystem="binary" />
					</div>
				</button>
				<button
					type="button"
					class={f.removeBtn}
					onclick={() => removeAttachment(file.id)}
					aria-label="Remove file"
				>
					<X size={14} aria-hidden="true" />
				</button>
			</li>
		{/each}
		{#each links as url (url)}
			{@const card = localLinkCard(url)}
			<li class={f.row}>
				<span class={f.badge} aria-hidden="true">{card?.badge ?? '↗'}</span>
				<a
					href={url}
					target="_blank"
					rel="noreferrer noopener"
					class={f.openBtn}
					aria-label={`Open ${card?.hostname ?? url}`}
				>
					<div class={f.title}>
						{card?.hostname ?? url}
					</div>
					<div class={f.size}>
						{card?.path || url}
					</div>
				</a>
			</li>
		{/each}
	</ul>
{/if}

{#if photos.length > 0 || pendingPhotos.length > 0}
	<div class={`scrollable ${p.strip}`} aria-label="Photos">
		{#each photos as img (img.id)}
			<div class={p.wrap}>
				<button
					type="button"
					class={p.btn}
					onclick={() => void openPhoto(img.id)}
					aria-label={`Open ${img.name ?? 'photo'}`}
				>
					<img
						src={fillPhotos ? img.dataUrl || displayImageSrc(img) : displayImageSrc(img)}
						alt={img.name ?? 'Photo'}
						class={p.img}
						loading="lazy"
						decoding="async"
						draggable="false"
					/>
				</button>
				<button
					type="button"
					class={p.delBtn}
					onclick={() => removeAttachment(img.id)}
					aria-label="Remove photo"
				>
					<X size={14} aria-hidden="true" />
				</button>
			</div>
		{/each}
		{#each pendingPhotos as img (img.id)}
			<div class={p.skeleton} role="img" aria-label={`Loading ${img.name ?? 'photo'}`}></div>
		{/each}
	</div>
{/if}

<PhotoFullscreen
	images={photos}
	bind:activeIndex={focusedImageIndex}
	onCrop={saveCroppedPhoto}
	onDelete={removeAttachment}
/>
{#if canvasEditorOpen}
	<CanvasEditor
		attachment={focusedCanvas}
		onSave={saveCanvas}
		onClose={() => {
			canvasEditorOpen = false;
			focusedCanvas = null;
		}}
	/>
{/if}
{#if focusedAttachment}
	<AttachmentFullscreen
		attachment={focusedAttachment}
		onClose={() => {
			focusedAttachment = null;
		}}
	/>
{/if}

{#if filesAwaitingQuality}
	<Dialog.Root
		open
		onOpenChange={(details) => {
			if (!details.open) filesAwaitingQuality = null;
		}}
		preventScroll={false}
	>
		<Dialog.Backdrop class={d.backdrop} />
		<Dialog.Positioner
			class={css({
				position: 'fixed',
				inset: 0,
				zIndex: 101,
				display: 'grid',
				placeItems: 'center',
				p: 'lg'
			})}
		>
			<Dialog.Content class={cx(d.panel, css({ w: 'full', maxW: 'sm', p: 'lg' }))}>
				<div
					class={flex({
						mb: 'md',
						align: 'flex-start',
						justify: 'space-between',
						gap: 'md'
					})}
				>
					<div>
						<Dialog.Title
							id="photo-quality-title"
							class={cx(d.title, css({ textStyle: 'subtitleStrong' }))}>Photo quality</Dialog.Title
						>
						<p class={cx(d.description, css({ mt: '3xs', textStyle: 'caption' }))}>
							Choose once for {filesAwaitingQuality.length === 1
								? 'this attachment'
								: `these ${filesAwaitingQuality.length} attachments`}.
						</p>
					</div>
					<Dialog.CloseTrigger
						type="button"
						class={iconButton({ variant: 'ghost', size: 'compact' })}
						aria-label="Cancel attachments"
					>
						<X size={16} aria-hidden="true" />
					</Dialog.CloseTrigger>
				</div>
				<div class={grid({ columns: 2, gap: 'sm' })}>
					<button
						type="button"
						class={cx(button({ variant: 'primary' }), qualityCompressedCard.root)}
						onclick={() => chooseImageQuality('compressed')}
					>
						<span class={qualityCompressedCard.title}>Compressed</span>
						<span class={qualityCompressedCard.description}>
							Small file · A4 text stays readable
						</span>
					</button>
					<button
						type="button"
						class={cx(button({ variant: 'secondary' }), qualityHdCard.root)}
						onclick={() => chooseImageQuality('hd')}
					>
						<span class={qualityHdCard.title}>HD</span>
						<span class={qualityHdCard.description}> Sharper image · larger file </span>
					</button>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Dialog.Root>
{/if}

{#snippet footerButton(
	content: string,
	label: string,
	icon: typeof RotateCcw,
	variant: 'ghost' | 'danger' = 'ghost',
	action: () => void
)}
	{@const Icon = icon}
	<Tooltip {content}>
		<button
			type="button"
			class={iconButton({ variant, size: 'standard' })}
			title={label}
			aria-label={label}
			onclick={action}
		>
			<Icon class={iconMd} aria-hidden="true" />
		</button>
	</Tooltip>
{/snippet}

{#if trashed}
	<footer
		use:footerInteractions
		class={hstack({
			justify: 'flex-end',
			gap: '2xs',
			px: 'md',
			py: 'sm',
			borderTopWidth: 'hairline',
			borderColor: 'scrapscache.borderFaint'
		})}
	>
		{@render footerButton('Restore', 'Restore', RotateCcw, 'ghost', () => onRestore?.())}
		{@render footerButton('Archive', 'Archive', Archive, 'ghost', () => onArchive?.())}
		{@render footerButton('Delete forever', 'Delete forever', Trash2, 'danger', () => onDelete?.())}
	</footer>
{:else if archived}
	<footer
		use:footerInteractions
		class={hstack({
			justify: 'flex-end',
			gap: '2xs',
			px: 'md',
			py: 'sm',
			borderTopWidth: 'hairline',
			borderColor: 'scrapscache.borderFaint'
		})}
	>
		{@render footerButton('Restore', 'Restore', ArchiveRestore, 'ghost', () => onArchive?.())}
		{@render footerButton('Delete note', 'Delete note', Trash2, 'danger', () => onDelete?.())}
	</footer>
{:else}
	<footer
		use:footerInteractions
		class={hstack({
			justify: 'space-between',
			gap: 'sm',
			px: 'md',
			py: 'sm',
			borderTopWidth: 'hairline',
			borderColor: 'scrapscache.borderFaint'
		})}
	>
		<div class={hstack({ gap: '2xs', flexShrink: 0 })}>
			{@render footerButton('Attach', 'Attach', Paperclip, 'ghost', openAttach)}
			{@render footerButton('New canvas', 'New canvas', PenLine, 'ghost', () => void openCanvas())}
			<Tooltip content="Labels">
				<button
					type="button"
					class={iconButton({ variant: 'ghost', size: 'standard' })}
					title="Labels"
					onclick={openTags}
					aria-label="Labels"
				>
					<Tag class={iconMd} fill={hasLabels ? 'currentColor' : 'none'} aria-hidden="true" />
				</button>
			</Tooltip>
		</div>
		<div
			class={hstack({
				gap: '2xs',
				flexWrap: 'wrap',
				justify: 'flex-end',
				maxW: 'calc(100% - 5.5rem)'
			})}
		>
			{@render footerButton('Color', 'Color', Palette, 'ghost', () => onOpenColor?.())}
			{#if showCopy}
				<Tooltip content="Copy note">
					<button
						type="button"
						class={iconButton({ variant: 'ghost', size: 'standard' })}
						title="Copy note"
						aria-label="Copy note"
						onclick={() => onCopy?.()}
					>
						{#if copyFlash}<Check class={iconMd} aria-hidden="true" />{:else}<Copy
								class={iconMd}
								aria-hidden="true"
							/>{/if}
					</button>
				</Tooltip>
			{/if}
			{#if showArchive}
				{@render footerButton(
					archived ? 'Unarchive' : 'Archive',
					archived ? 'Unarchive' : 'Archive',
					Archive,
					'ghost',
					() => onArchive?.()
				)}
			{/if}
			{#if showDelete}
				{@render footerButton('Delete note', 'Delete note', Trash2, 'danger', () => onDelete?.())}
			{/if}
			{#if onClose}
				{@render footerButton('Done', 'Done', Check, 'ghost', () => onClose?.())}
			{/if}
		</div>
	</footer>
{/if}
