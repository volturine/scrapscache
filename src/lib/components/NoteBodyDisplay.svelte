<script lang="ts">
	// A read-only preview of a note. Cards cover it with a shield so a press
	// anywhere drags the card and a click opens the note; attachments, links and
	// checklists are interactive in the editor instead.
	import type { Note } from '$lib/types';
	import { noteBody } from 'styled-system/recipes';
	import { noteAttachments, type BodySegment } from '$lib/checklistBody';
	import { extractHttpUrls, localLinkCard } from '$lib/linkPreview';
	import { isImageAttachment, fileIconLabel } from '$lib/noteImages';
	import { displayImageSrc } from '$lib/imageThumb';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { onMount } from 'svelte';
	import { isCanvasAttachment } from '$lib/canvasAttachment';
	import { canvasPreview, filePreview, photoPreview, markdownStyles } from '$panda/styles';
	import { checklist } from 'styled-system/recipes';
	import {
		highlightCodeLine,
		markdownTokenClass,
		parseInlineMarkdown,
		parseMarkdownBlocks
	} from '$lib/markdown';
	import { uiStore } from '$lib/stores/ui.svelte';

	let { note }: { note: Note } = $props();

	const CARD_PREVIEW_LIMIT = 64;
	const blocks = $derived(parseMarkdownBlocks(note.body ?? ''));
	const displayBlocks = $derived(
		blocks.length > CARD_PREVIEW_LIMIT ? blocks.slice(0, CARD_PREVIEW_LIMIT) : blocks
	);
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

	const body = noteBody();
	const c = canvasPreview.display;
	const f = filePreview.display;
	const p = photoPreview.display;
</script>

{#snippet inlineContent(text: string)}
	<span class:markdown-raw={uiStore.rawMarkdown}>
		{#if text}
			{@const inlineTokens = parseInlineMarkdown(text)}
			{#each inlineTokens as token, tokenIndex (tokenIndex)}
				<span
					class={markdownTokenClass(token, uiStore.rawMarkdown)}
					data-markdown-token={token.kind === 'marker' ? token.marker : token.styles.join(' ')}
					>{token.text}</span
				>
			{/each}
		{:else}
			&nbsp;
		{/if}
	</span>
{/snippet}

{#snippet bodyLine(seg: BodySegment)}
	{#if seg.type === 'check'}
		{@const check = checklist({ checked: seg.checked, indented: seg.indent > 0 })}
		<div
			class={body.row}
			data-check-line={seg.lineIndex}
			style={seg.indent > 0 ? `padding-left: ${seg.indent * 1.25}rem` : undefined}
		>
			<span class={[check.root, body.check]} aria-hidden="true">
				{#if seg.checked}
					<svg viewBox="0 0 16 16" class={check.mark}>
						<path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
					</svg>
				{/if}
			</span>
			<span class={noteBody({ checked: seg.checked, indented: seg.indent > 0 }).line}>
				{@render inlineContent(seg.text)}
			</span>
		</div>
	{:else if seg.type === 'bullet'}
		<div
			class={body.row}
			data-bullet-line={seg.lineIndex}
			style={seg.indent > 0 ? `padding-left: ${seg.indent * 1.25}rem` : undefined}
		>
			<span class={body.bullet} aria-hidden="true">•</span>
			<span class={noteBody({ indented: seg.indent > 0 }).line}>
				{@render inlineContent(seg.text)}
			</span>
		</div>
	{:else if seg.text}
		<p class={body.paragraph}>{@render inlineContent(seg.text)}</p>
	{:else}
		<div class={body.spacer}></div>
	{/if}
{/snippet}

<div
	bind:this={contentElement}
	class={[body.container, markdownStyles, 'markdown-content', 'markdown-raw']}
>
	{#each displayBlocks as block (block.type === 'line' ? block.segment.lineIndex : block.lineIndex)}
		{#if block.type === 'line'}
			{@render bodyLine(block.segment)}
		{:else if block.type === 'table'}
			<div
				class="markdown-block-surface markdown-table-scroll note-scrollbar-hidden"
				data-markdown-table-container
			>
				<table class="markdown-table" data-markdown-table>
					<thead>
						<tr>
							{#each block.header as cell, columnIndex (columnIndex)}
								<th scope="col" style={`text-align: ${block.alignments[columnIndex]};`}>
									{@render inlineContent(cell)}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each block.rows as row, rowIndex (rowIndex)}
							<tr>
								{#each block.header as _, columnIndex (columnIndex)}
									<td style={`text-align: ${block.alignments[columnIndex]};`}>
										{@render inlineContent(row[columnIndex] ?? '')}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			{@const codeLines = block.code.split('\n')}
			<pre
				class="markdown-block-surface markdown-code-block note-scrollbar-hidden"
				data-markdown-code-block
				data-language={block.language || undefined}><code
					>{#each codeLines as codeLine, codeLineIndex (`${block.lineIndex}-${codeLineIndex}`)}<span
							class="markdown-code-line"
							>{#each highlightCodeLine(codeLine, block.language) as token, tokenIndex (tokenIndex)}{#if token.kind === 'plain'}{token.text}{:else}<span
										class="markdown-code-token-{token.kind}">{token.text}</span
									>{/if}{/each}</span
						>{/each}</code
				></pre>
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
