<script lang="ts">
	import { css } from 'styled-system/css';
	import { button, dialog } from 'styled-system/recipes';
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
		onOpenColor,
		onOpenTags,
		onCopy,
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
		onOpenColor?: () => void;
		onOpenTags?: () => void;
		onCopy?: () => void;
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

	const attachErrorClass = css({
		px: '0.75rem',
		pb: '0.25rem',
		fontSize: 'xs',
		color: { base: 'red.600', _dark: 'red.400' }
	});
	const canvasesScroller = css({
		display: 'flex',
		maxH: '11rem',
		gap: '0.5rem',
		overflowX: 'auto',
		px: '0.75rem',
		pb: '0.5rem'
	});
	const canvasWrap = css({ position: 'relative', w: '9rem', flexShrink: 0 });
	const canvasBtn = css({
		position: 'relative',
		display: 'block',
		aspectRatio: '4/3',
		w: 'full',
		overflow: 'hidden',
		rounded: 'lg',
		borderWidth: '1px',
		borderColor: { base: 'black/10', _dark: 'white/10' },
		bg: { base: 'white', _dark: 'slate.900' },
		touchAction: 'manipulation',
		cursor: 'pointer'
	});
	const canvasImg = css({ h: 'full', w: 'full', objectFit: 'contain' });
	const canvasLoading = css({
		display: 'grid',
		h: 'full',
		placeItems: 'center',
		fontSize: 'xs',
		color: 'scrapscache.textMuted'
	});
	const canvasCaption = css({
		position: 'absolute',
		insetX: 0,
		bottom: 0,
		bgGradient: 'to-t',
		gradientFrom: 'black/65',
		gradientTo: 'transparent',
		px: '0.5rem',
		pb: '0.375rem',
		pt: '1.25rem',
		textAlign: 'left',
		fontSize: '11px',
		fontWeight: 'medium',
		color: 'white'
	});
	const canvasDelBtn = css({
		position: 'absolute',
		right: '0.25rem',
		top: '0.25rem',
		rounded: 'full',
		bg: 'black/60',
		px: '0.375rem',
		py: '0.125rem',
		fontSize: 'xs',
		color: 'white',
		touchAction: 'manipulation',
		cursor: 'pointer'
	});
	const filesList = css({
		maxH: '9rem',
		gap: '0.375rem',
		overflowY: 'auto',
		px: '0.75rem',
		pb: '0.5rem',
		display: 'flex',
		flexDirection: 'column'
	});
	const fileItem = css({
		display: 'flex',
		alignItems: 'center',
		gap: '0.5rem',
		rounded: 'lg',
		borderWidth: '1px',
		borderColor: { base: 'black/10', _dark: 'white/10' },
		bg: { base: 'black/5', _dark: 'white/5' },
		px: '0.5rem',
		py: '0.375rem'
	});
	const fileBadge = css({
		display: 'grid',
		h: '2rem',
		w: '2rem',
		flexShrink: 0,
		placeItems: 'center',
		rounded: 'md',
		bg: { base: 'black/10', _dark: 'white/10' },
		fontSize: '10px',
		fontWeight: 'bold',
		letterSpacing: 'wide',
		color: 'scrapscache.text'
	});
	const fileActionBtn = css({
		minW: 0,
		flex: '1',
		textAlign: 'left',
		touchAction: 'manipulation',
		cursor: 'pointer'
	});
	const fileTitle = css({
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		fontSize: 'sm',
		color: 'scrapscache.text'
	});
	const fileSize = css({ fontSize: '10px', color: 'scrapscache.textMuted' });
	const fileRemoveBtn = css({
		flexShrink: 0,
		rounded: 'full',
		px: '0.375rem',
		py: '0.125rem',
		fontSize: 'xs',
		color: 'scrapscache.textMuted',
		touchAction: 'manipulation',
		cursor: 'pointer',
		_hover: { bg: { base: 'black/5', _dark: 'white/10' } }
	});
	const photosScroller = css({
		display: 'flex',
		gap: '0.5rem',
		overflowX: 'auto',
		px: '0.75rem',
		pb: '0.5rem'
	});
	const photoWrap = css({ position: 'relative', flexShrink: 0 });
	const photoBtn = css({
		display: 'block',
		h: '8rem',
		overflow: 'hidden',
		rounded: 'lg',
		touchAction: 'manipulation',
		cursor: 'pointer'
	});
	const photoImg = css({ h: '8rem', w: 'auto', maxW: '15rem', objectFit: 'cover' });
	const photoDelBtn = css({
		position: 'absolute',
		right: '0.375rem',
		top: '0.375rem',
		display: 'grid',
		h: '1.5rem',
		w: '1.5rem',
		placeItems: 'center',
		rounded: 'full',
		bg: 'black/60',
		color: 'white',
		touchAction: 'manipulation',
		cursor: 'pointer'
	});
	const photoPulse = css({
		h: '8rem',
		w: '8rem',
		flexShrink: 0,
		animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
		rounded: 'lg',
		bg: { base: 'black/10', _dark: 'white/10' }
	});
	const dialogBackdrop = css({ position: 'fixed', inset: 0, zIndex: 50, bg: 'black/45' });
	const dialogPositioner = css({
		position: 'fixed',
		inset: 0,
		zIndex: 50,
		display: 'grid',
		placeItems: 'center',
		p: '1rem'
	});
	const dialogContentClass = css({ w: 'full', maxW: 'sm', p: '1rem', color: 'scrapscache.text' });
	const dialogHeader = css({
		mb: '0.75rem',
		display: 'flex',
		alignItems: 'flex-start',
		justifyContent: 'space-between',
		gap: '0.75rem'
	});
	const dialogTitleClass = css({ fontSize: 'base', fontWeight: 'semibold' });
	const dialogSubtitle = css({ mt: '0.125rem', fontSize: 'xs', color: 'scrapscache.textMuted' });
	const dialogCloseTrigger = css({
		h: '2.25rem',
		w: '2.25rem',
		flexShrink: 0,
		p: '0.5rem',
		touchAction: 'manipulation'
	});
	const qualityChoiceGrid = css({
		display: 'grid',
		gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
		gap: '0.5rem'
	});
	const qualityChoiceBtn = css({
		minH: '5rem',
		px: '0.75rem',
		py: '0.75rem',
		textAlign: 'left',
		cursor: 'pointer'
	});
	const qualityTitle = css({ display: 'block', fontSize: 'sm', fontWeight: 'semibold' });
	const qualityDescCompressed = css({
		mt: '0.25rem',
		display: 'block',
		fontSize: '11px',
		lineHeight: '1rem',
		opacity: 0.85
	});
	const qualityDescHd = css({
		mt: '0.25rem',
		display: 'block',
		fontSize: '11px',
		lineHeight: '1rem',
		color: 'scrapscache.textMuted'
	});
	const footerBar = css({
		display: 'flex',
		flexShrink: 0,
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: '0.5rem',
		borderTopWidth: '1px',
		borderColor: { base: 'black/5', _dark: 'white/10' },
		px: '0.75rem',
		py: '0.5rem'
	});
	const footerGroupLeft = css({
		display: 'flex',
		flexShrink: 0,
		alignItems: 'center',
		gap: '0.25rem'
	});
	const footerGroupRight = css({
		display: 'flex',
		maxW: 'calc(100% - 5.5rem)',
		flexWrap: 'wrap',
		alignItems: 'center',
		justifyContent: 'flex-end',
		gap: '0.25rem'
	});
	const footerActionBtn = css({
		h: '2.5rem',
		w: '2.5rem',
		p: '0.5rem',
		touchAction: 'manipulation'
	});
	const footerTrashBtn = css({
		h: '2.5rem',
		w: '2.5rem',
		p: '0.5rem',
		color: { base: 'red.600', _dark: 'red.400' },
		touchAction: 'manipulation'
	});
	const iconMd = css({ h: '1.25rem', w: '1.25rem' });
</script>

{#if attachError}
	<p class={attachErrorClass}>{attachError}</p>
{/if}

{#if canvases.length > 0}
	<div class={`scrollable ${canvasesScroller}`} aria-label="Canvases">
		{#each canvases as canvas (canvas.id)}
			<div class={canvasWrap}>
				<button
					type="button"
					class={canvasBtn}
					onclick={() => void openCanvas(canvas)}
					aria-label={`Edit ${canvas.name ?? 'canvas'}`}
				>
					{#if displayImageSrc(canvas)}
						<img
							src={displayImageSrc(canvas)}
							alt={canvas.name ?? 'Canvas'}
							class={canvasImg}
							loading="lazy"
							decoding="async"
							draggable="false"
						/>
					{:else}
						<div class={canvasLoading}>Loading canvas…</div>
					{/if}
					<span class={canvasCaption}>
						{canvas.name ?? 'Canvas'}
					</span>
				</button>
				<button
					type="button"
					class={canvasDelBtn}
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
	<ul
		class={`note-scrollbar-hidden scrollable overflow-y-auto ${filesList}`}
		aria-label="Files and links"
	>
		{#each files as file (file.id)}
			<li class={fileItem}>
				<span class={fileBadge} aria-hidden="true">{fileIconLabel(file.mime, file.name)}</span>
				<button
					type="button"
					class={fileActionBtn}
					onclick={() => void openFile(file)}
					aria-label={`Open ${file.name ?? 'file'}`}
				>
					<div class={fileTitle}>
						{file.name || 'Attachment'}
					</div>
					<div class={fileSize}>
						<Format.Byte value={dataUrlByteLength(file.dataUrl)} unitSystem="binary" />
					</div>
				</button>
				<button
					type="button"
					class={fileRemoveBtn}
					onclick={() => removeAttachment(file.id)}
					aria-label="Remove file"
				>
					<X size={14} aria-hidden="true" />
				</button>
			</li>
		{/each}
		{#each links as url (url)}
			{@const card = localLinkCard(url)}
			<li class={fileItem}>
				<span class={fileBadge} aria-hidden="true">{card?.badge ?? '↗'}</span>
				<a
					href={url}
					target="_blank"
					rel="noreferrer noopener"
					class={fileActionBtn}
					aria-label={`Open ${card?.hostname ?? url}`}
				>
					<div class={fileTitle}>
						{card?.hostname ?? url}
					</div>
					<div class={fileSize}>
						{card?.path || url}
					</div>
				</a>
			</li>
		{/each}
	</ul>
{/if}

{#if photos.length > 0 || pendingPhotos.length > 0}
	<div class={`scrollable overflow-x-auto ${photosScroller}`} aria-label="Photos">
		{#each photos as img (img.id)}
			<div class={photoWrap}>
				<button
					type="button"
					class={photoBtn}
					onclick={() => void openPhoto(img.id)}
					aria-label={`Open ${img.name ?? 'photo'}`}
				>
					<img
						src={displayImageSrc(img)}
						alt={img.name ?? 'Photo'}
						class={photoImg}
						loading="lazy"
						decoding="async"
						draggable="false"
					/>
				</button>
				<button
					type="button"
					class={photoDelBtn}
					onclick={() => removeAttachment(img.id)}
					aria-label="Remove photo"
				>
					<X size={14} aria-hidden="true" />
				</button>
			</div>
		{/each}
		{#each pendingPhotos as img (img.id)}
			<div class={photoPulse} role="img" aria-label={`Loading ${img.name ?? 'photo'}`}></div>
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
		<Dialog.Backdrop class={dialogBackdrop} />
		<Dialog.Positioner class={dialogPositioner}>
			<Dialog.Content class={`${dialog().panel} ${dialogContentClass}`}>
				<div class={dialogHeader}>
					<div>
						<Dialog.Title id="photo-quality-title" class={dialogTitleClass}
							>Photo quality</Dialog.Title
						>
						<p class={dialogSubtitle}>
							Choose once for {filesAwaitingQuality.length === 1
								? 'this attachment'
								: `these ${filesAwaitingQuality.length} attachments`}.
						</p>
					</div>
					<Dialog.CloseTrigger
						type="button"
						class={`icon-btn ${dialogCloseTrigger}`}
						aria-label="Cancel attachments"
					>
						<X size={16} aria-hidden="true" />
					</Dialog.CloseTrigger>
				</div>
				<div class={qualityChoiceGrid}>
					<button
						type="button"
						class={`${button({ variant: 'primary' })} ${qualityChoiceBtn}`}
						onclick={() => chooseImageQuality('compressed')}
					>
						<span class={qualityTitle}>Compressed</span>
						<span class={qualityDescCompressed}> Small file · A4 text stays readable </span>
					</button>
					<button
						type="button"
						class={`${button({ variant: 'secondary' })} ${qualityChoiceBtn}`}
						onclick={() => chooseImageQuality('hd')}
					>
						<span class={qualityTitle}>HD</span>
						<span class={qualityDescHd}> Sharper image · larger file </span>
					</button>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Dialog.Root>
{/if}

<footer use:footerInteractions class={footerBar}>
	<div class={footerGroupLeft}>
		<Tooltip content="Attach">
			<button
				type="button"
				class={`icon-btn ${footerActionBtn}`}
				title="Attach"
				onclick={openAttach}
				aria-label="Attach"
			>
				<Paperclip class={iconMd} aria-hidden="true" />
			</button>
		</Tooltip>
		<Tooltip content="New canvas">
			<button
				type="button"
				class={`icon-btn ${footerActionBtn}`}
				title="New canvas"
				onclick={() => void openCanvas()}
				aria-label="New canvas"
			>
				<PenLine class={iconMd} aria-hidden="true" />
			</button>
		</Tooltip>
		<Tooltip content="Labels">
			<button
				type="button"
				class={`icon-btn ${footerActionBtn}`}
				title="Labels"
				onclick={openTags}
				aria-label="Labels"
			>
				<Tag class={iconMd} fill={hasLabels ? 'currentColor' : 'none'} aria-hidden="true" />
			</button>
		</Tooltip>
	</div>

	<div class={footerGroupRight}>
		<Tooltip content="Color">
			<button
				type="button"
				class={`icon-btn ${footerActionBtn}`}
				title="Color"
				aria-label="Color"
				onclick={() => onOpenColor?.()}
			>
				<Palette class={iconMd} aria-hidden="true" />
			</button>
		</Tooltip>
		{#if showCopy}
			<Tooltip content="Copy note">
				<button
					type="button"
					class={`icon-btn ${footerActionBtn}`}
					title="Copy note"
					aria-label="Copy note"
					onclick={() => onCopy?.()}
				>
					{#if copyFlash}
						<Check class={iconMd} aria-hidden="true" />
					{:else}
						<Copy class={iconMd} aria-hidden="true" />
					{/if}
				</button>
			</Tooltip>
		{/if}
		{#if showArchive}
			<Tooltip content={trashed ? 'Restore' : archived ? 'Unarchive' : 'Archive'}>
				<button
					type="button"
					class={`icon-btn ${footerActionBtn}`}
					title={trashed ? 'Restore' : archived ? 'Unarchive' : 'Archive'}
					aria-label={trashed ? 'Restore' : archived ? 'Unarchive' : 'Archive'}
					onclick={() => onArchive?.()}
				>
					{#if trashed}
						<RotateCcw class={iconMd} aria-hidden="true" />
					{:else if archived}
						<ArchiveRestore class={iconMd} aria-hidden="true" />
					{:else}
						<Archive class={iconMd} aria-hidden="true" />
					{/if}
				</button>
			</Tooltip>
		{/if}
		{#if showDelete}
			<Tooltip content="Delete note">
				<button
					type="button"
					class={`icon-btn ${footerTrashBtn}`}
					title="Delete note"
					aria-label="Delete note"
					onclick={() => onDelete?.()}
				>
					<Trash2 class={iconMd} aria-hidden="true" />
				</button>
			</Tooltip>
		{/if}
		{#if onClose}
			<Tooltip content="Done">
				<button
					type="button"
					class={`icon-btn ${footerActionBtn}`}
					title="Done"
					aria-label="Done"
					onclick={() => onClose?.()}
				>
					<Check class={iconMd} aria-hidden="true" />
				</button>
			</Tooltip>
		{/if}
	</div>
</footer>
