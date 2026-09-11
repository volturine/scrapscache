<script lang="ts">
	// A read-only preview of a note. Cards cover it with a shield so a press
	// anywhere drags the card and a click opens the note; attachments, links and
	// checklists are interactive in the editor instead.
	import type { Note } from '$lib/types';
	import { css } from 'styled-system/css';
	import { parseBody, noteAttachments } from '$lib/checklistBody';
	import { extractHttpUrls, localLinkCard } from '$lib/linkPreview';
	import { isImageAttachment, fileIconLabel } from '$lib/noteImages';
	import { displayImageSrc } from '$lib/imageThumb';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { onMount } from 'svelte';
	import { isCanvasAttachment } from '$lib/canvasAttachment';

	let { note }: { note: Note } = $props();

	const segments = $derived(parseBody(note.body ?? ''));
	const attachments = $derived(noteAttachments(note));
	const imageAttachments = $derived(attachments.filter(isImageAttachment));
	const canvases = $derived(attachments.filter(isCanvasAttachment));
	const photos = $derived(imageAttachments.filter((attachment) => !!displayImageSrc(attachment)));
	const pendingPhotos = $derived(
		imageAttachments.filter((attachment) => !displayImageSrc(attachment))
	);
	const files = $derived(
		attachments.filter((a) => !isImageAttachment(a) && !isCanvasAttachment(a))
	);
	const links = $derived(extractHttpUrls(note.body ?? ''));
	let contentElement: HTMLDivElement | null = $state(null);

	onMount(() => {
		// Cards only need thumbs. Full bytes load on explicit open / editor focus.
		const node = contentElement;
		const needsThumbOrFile = (note.images ?? []).some((attachment) => {
			if (isImageAttachment(attachment) || isCanvasAttachment(attachment)) {
				return !displayImageSrc(attachment);
			}
			return !attachment.dataUrl;
		});
		if (!node || !needsThumbOrFile) return;
		const request = () => notesStore.requestVisibleNoteAttachments(note.id);
		if (!('IntersectionObserver' in window)) {
			const frame = requestAnimationFrame(request);
			return () => cancelAnimationFrame(frame);
		}
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			observer.disconnect();
			request();
		});
		observer.observe(node);
		return () => observer.disconnect();
	});

	const containerClass = css({ fontSize: 'sm', color: 'scrapscache.text' });
	const itemRowClass = css({
		display: 'flex',
		alignItems: 'flex-start',
		gap: '0.5rem',
		py: '0.125rem'
	});
	const bulletSymbolClass = css({ flexShrink: 0, userSelect: 'none' });
	const itemTextClass = (checked: boolean, indented: boolean) =>
		css({
			flex: '1',
			wordBreak: 'break-word',
			textDecoration: checked ? 'line-through' : 'none',
			opacity: checked ? 0.5 : 1,
			fontSize: indented ? '13px' : 'inherit'
		});
	const plainParagraphClass = css({
		whiteSpace: 'pre-wrap',
		wordBreak: 'break-word',
		py: '0.125rem'
	});
	const spacerClass = css({ h: '0.5rem' });
	const canvasesGridClass = css({ mt: '0.5rem', display: 'grid', gap: '0.375rem' });
	const canvasCardClass = css({
		position: 'relative',
		display: 'block',
		aspectRatio: '4/3',
		w: 'full',
		overflow: 'hidden',
		rounded: 'lg',
		borderWidth: '1px',
		borderColor: { base: 'black/10', _dark: 'white/10' },
		bg: { base: 'white', _dark: 'slate.900' }
	});
	const canvasImgClass = css({ h: 'full', w: 'full', objectFit: 'cover' });
	const canvasLoadingClass = css({
		display: 'grid',
		h: 'full',
		w: 'full',
		placeItems: 'center',
		fontSize: '11px',
		color: 'scrapscache.textMuted'
	});
	const canvasLabelClass = css({
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
		fontSize: '10px',
		fontWeight: 'semibold',
		color: 'white'
	});
	const filesListClass = css({
		mt: '0.5rem',
		display: 'flex',
		flexDirection: 'column',
		gap: '0.25rem'
	});
	const fileRowClass = css({
		display: 'flex',
		w: 'full',
		alignItems: 'center',
		gap: '0.5rem',
		rounded: 'md',
		borderWidth: '1px',
		borderColor: { base: 'black/10', _dark: 'white/10' },
		bg: { base: 'black/5', _dark: 'white/5' },
		px: '0.5rem',
		py: '0.375rem',
		textAlign: 'left'
	});
	const fileBadgeClass = css({
		display: 'grid',
		h: '1.75rem',
		w: '1.75rem',
		flexShrink: 0,
		placeItems: 'center',
		rounded: 'sm',
		bg: { base: 'black/10', _dark: 'white/10' },
		fontSize: '9px',
		fontWeight: 'bold',
		color: 'scrapscache.text'
	});
	const fileTitleClass = css({
		minW: 0,
		flex: '1',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		fontSize: 'xs',
		color: 'scrapscache.text'
	});
	const photosStripClass = css({
		mt: '0.5rem',
		display: 'flex',
		gap: '0.375rem',
		overflowX: 'auto'
	});
	const photoWrapClass = css({
		display: 'block',
		flexShrink: 0,
		overflow: 'hidden',
		rounded: 'md'
	});
	const photoImgClass = css({
		h: '6rem',
		w: 'auto',
		maxW: '10rem',
		rounded: 'lg',
		objectFit: 'cover'
	});
	const photoSkeletonClass = css({
		h: '6rem',
		w: '6rem',
		flexShrink: 0,
		animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
		rounded: 'lg',
		bg: { base: 'black/10', _dark: 'white/10' }
	});
</script>

<div bind:this={contentElement} class={containerClass}>
	{#each segments as seg (seg.lineIndex)}
		{#if seg.type === 'check'}
			<div
				class={itemRowClass}
				data-check-line={seg.lineIndex}
				style={seg.indent > 0 ? `padding-left: ${seg.indent * 1.25}rem` : undefined}
			>
				<span
					class="checklist-toggle shrink-0 {seg.indent > 0 ? 'checklist-toggle-sub' : ''}"
					class:checked={seg.checked}
					aria-hidden="true"
				>
					{#if seg.checked}
						<svg viewBox="0 0 16 16" class="checklist-toggle-mark">
							<path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
						</svg>
					{/if}
				</span>
				<span class={itemTextClass(seg.checked, seg.indent > 0)}>
					{seg.text || '\u00a0'}
				</span>
			</div>
		{:else if seg.type === 'bullet'}
			<div
				class={itemRowClass}
				data-bullet-line={seg.lineIndex}
				style={seg.indent > 0 ? `padding-left: ${seg.indent * 1.25}rem` : undefined}
			>
				<span class={bulletSymbolClass} aria-hidden="true">•</span>
				<span class={itemTextClass(false, seg.indent > 0)}>
					{seg.text || '\u00a0'}
				</span>
			</div>
		{:else if seg.text}
			<p class={plainParagraphClass}>{seg.text}</p>
		{:else}
			<div class={spacerClass}></div>
		{/if}
	{/each}
</div>

{#if canvases.length > 0}
	<div class={canvasesGridClass} aria-label="Canvases">
		{#each canvases as canvas (canvas.id)}
			<div class={canvasCardClass}>
				{#if displayImageSrc(canvas)}
					<img
						src={displayImageSrc(canvas)}
						alt={canvas.name ?? 'Canvas'}
						class={canvasImgClass}
						loading="lazy"
						decoding="async"
					/>
				{:else}
					<div class={canvasLoadingClass}>Loading canvas…</div>
				{/if}
				<span class={canvasLabelClass}>
					{canvas.name ?? 'Canvas'}
				</span>
			</div>
		{/each}
	</div>
{/if}

{#if files.length > 0 || links.length > 0}
	<div class={filesListClass} aria-label="Files and links">
		{#each files as file (file.id)}
			<div class={fileRowClass} aria-busy={!file.dataUrl}>
				<span class={fileBadgeClass}>{fileIconLabel(file.mime, file.name)}</span>
				<span class={fileTitleClass}>{file.name || 'File'}</span>
			</div>
		{/each}
		{#each links as url (url)}
			{@const card = localLinkCard(url)}
			<div class={fileRowClass}>
				<span class={fileBadgeClass} aria-hidden="true">{card?.badge ?? '↗'}</span>
				<span class={fileTitleClass}>{card?.hostname ?? url}</span>
			</div>
		{/each}
	</div>
{/if}

{#if photos.length > 0 || pendingPhotos.length > 0}
	<div class={photosStripClass} aria-label="Photos">
		{#each photos as img (img.id)}
			<div class={photoWrapClass}>
				<img
					src={displayImageSrc(img)}
					alt={img.name ?? 'Photo'}
					class={photoImgClass}
					loading="lazy"
					decoding="async"
					draggable="false"
				/>
			</div>
		{/each}
		{#each pendingPhotos as img (img.id)}
			<div
				class={photoSkeletonClass}
				role="img"
				aria-label={`Loading ${img.name ?? 'photo'}`}
			></div>
		{/each}
	</div>
{/if}
