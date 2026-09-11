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
	import { canvasPreview, filePreview, photoPreview } from './attachmentPreviewStyles';

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
	const c = canvasPreview({ mode: 'display' });
	const f = filePreview({ mode: 'display' });
	const p = photoPreview({ mode: 'display' });
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
	<div class={c.strip} aria-label="Canvases">
		{#each canvases as canvas (canvas.id)}
			<div class={c.btn}>
				{#if displayImageSrc(canvas)}
					<img
						src={displayImageSrc(canvas)}
						alt={canvas.name ?? 'Canvas'}
						class={c.img}
						loading="lazy"
						decoding="async"
					/>
				{:else}
					<div class={c.loading}>Loading canvas…</div>
				{/if}
				<span class={c.caption}>
					{canvas.name ?? 'Canvas'}
				</span>
			</div>
		{/each}
	</div>
{/if}

{#if files.length > 0 || links.length > 0}
	<div class={f.list} aria-label="Files and links">
		{#each files as file (file.id)}
			<div class={f.row} aria-busy={!file.dataUrl}>
				<span class={f.badge}>{fileIconLabel(file.mime, file.name)}</span>
				<span class={f.title}>{file.name || 'File'}</span>
			</div>
		{/each}
		{#each links as url (url)}
			{@const card = localLinkCard(url)}
			<div class={f.row}>
				<span class={f.badge} aria-hidden="true">{card?.badge ?? '↗'}</span>
				<span class={f.title}>{card?.hostname ?? url}</span>
			</div>
		{/each}
	</div>
{/if}

{#if photos.length > 0 || pendingPhotos.length > 0}
	<div class={p.strip} aria-label="Photos">
		{#each photos as img (img.id)}
			<div class={p.wrap}>
				<img
					src={displayImageSrc(img)}
					alt={img.name ?? 'Photo'}
					class={p.img}
					loading="lazy"
					decoding="async"
					draggable="false"
				/>
			</div>
		{/each}
		{#each pendingPhotos as img (img.id)}
			<div class={p.skeleton} role="img" aria-label={`Loading ${img.name ?? 'photo'}`}></div>
		{/each}
	</div>
{/if}
