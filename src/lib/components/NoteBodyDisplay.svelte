<script lang="ts">
	// A read-only preview of a note. Cards cover it with a shield so a press
	// anywhere drags the card and a click opens the note; attachments, links and
	// checklists are interactive in the editor instead.
	import type { Note } from '$lib/types';
	import { parseBody, noteAttachments, type BodySegment } from '$lib/checklistBody';
	import { extractHttpUrls, localLinkCard } from '$lib/linkPreview';
	import { isImageAttachment, fileIconLabel } from '$lib/noteImages';
	import { displayImageSrc } from '$lib/imageThumb';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { onMount } from 'svelte';
	import { isCanvasAttachment } from '$lib/canvasAttachment';
	import {
		highlightCodeLine,
		markdownTokenClass,
		parseInlineMarkdown,
		parseMarkdownBlocks,
		tokenizeMarkdownTableRow,
		type MarkdownBlock
	} from '$lib/markdown';
	import { uiStore } from '$lib/stores/ui.svelte';

	let { note }: { note: Note } = $props();
	type MarkdownTableBlock = Extract<MarkdownBlock, { type: 'table' }>;

	const segments = $derived(parseBody(note.body ?? ''));
	const blocks = $derived(parseMarkdownBlocks(note.body ?? ''));
	const rawLines = $derived((note.body ?? '').replace(/\r\n?/g, '\n').split('\n'));
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

	function rawTableAt(lineIndex: number): MarkdownTableBlock | undefined {
		const table = blocks.find(
			(block) =>
				block.type === 'table' &&
				lineIndex >= block.lineIndex &&
				lineIndex < block.lineIndex + block.rows.length + 2
		);
		return table?.type === 'table' ? table : undefined;
	}

	function rawTableSource(table: MarkdownTableBlock): string[] {
		return rawLines.slice(table.lineIndex, table.lineIndex + table.rows.length + 2);
	}

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

{#snippet rawTableContent(text: string)}
	{#each tokenizeMarkdownTableRow(text) as token, tokenIndex (tokenIndex)}
		{#if token.kind === 'marker'}
			<span class="markdown-raw-table-marker">{token.text}</span>
		{:else if token.text}
			{@render inlineContent(token.text)}
		{/if}
	{/each}
{/snippet}

{#snippet bodyLine(seg: BodySegment)}
	{#if seg.type === 'check'}
		<div
			class="flex items-start gap-2 py-0.5"
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
			<span
				class="flex-1 break-words {seg.checked ? 'line-through opacity-50' : ''} {seg.indent > 0
					? 'text-[13px]'
					: ''}"
			>
				{@render inlineContent(seg.text)}
			</span>
		</div>
	{:else if seg.type === 'bullet'}
		<div
			class="flex items-start gap-2 py-0.5"
			data-bullet-line={seg.lineIndex}
			style={seg.indent > 0 ? `padding-left: ${seg.indent * 1.25}rem` : undefined}
		>
			<span class="shrink-0 select-none" aria-hidden="true">•</span>
			<span class="flex-1 break-words {seg.indent > 0 ? 'text-[13px]' : ''}">
				{@render inlineContent(seg.text)}
			</span>
		</div>
	{:else if seg.text}
		<p class="whitespace-pre-wrap break-words py-0.5">{@render inlineContent(seg.text)}</p>
	{:else}
		<div class="h-2"></div>
	{/if}
{/snippet}

<div
	bind:this={contentElement}
	class="markdown-content text-sm text-[var(--scrapscache-text)]"
	class:markdown-raw={uiStore.rawMarkdown}
>
	{#if uiStore.rawMarkdown}
		{#each segments as seg (seg.lineIndex)}
			{@const rawTable = rawTableAt(seg.lineIndex)}
			{#if rawTable}
				{#if rawTable.lineIndex === seg.lineIndex}
					<div class="markdown-block-surface markdown-raw-table" data-markdown-raw-table-container>
						{#each rawTableSource(rawTable) as sourceLine, sourceLineIndex (sourceLineIndex)}
							<div>{@render rawTableContent(sourceLine)}</div>
						{/each}
					</div>
				{/if}
			{:else}
				{@render bodyLine(seg)}
			{/if}
		{/each}
	{:else}
		{#each blocks as block (block.type === 'line' ? block.segment.lineIndex : block.lineIndex)}
			{#if block.type === 'line'}
				{@render bodyLine(block.segment)}
			{:else if block.type === 'table'}
				<div class="markdown-block-surface" data-markdown-table-container>
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
					class="markdown-block-surface markdown-code-block"
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
	{/if}
</div>

{#if canvases.length > 0}
	<div class="mt-2 grid gap-1.5" aria-label="Canvases">
		{#each canvases as canvas (canvas.id)}
			<div
				class="relative block aspect-[4/3] w-full overflow-hidden rounded-lg border border-black/10 bg-white dark:border-white/10 dark:bg-slate-900"
			>
				{#if displayImageSrc(canvas)}
					<img
						src={displayImageSrc(canvas)}
						alt={canvas.name ?? 'Canvas'}
						class="h-full w-full object-cover"
						loading="lazy"
						decoding="async"
					/>
				{:else}
					<div
						class="grid h-full w-full place-items-center text-[11px] text-[var(--scrapscache-text-muted)]"
					>
						Loading canvas…
					</div>
				{/if}
				<span
					class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-2 pb-1.5 pt-5 text-left text-[10px] font-semibold text-white"
				>
					{canvas.name ?? 'Canvas'}
				</span>
			</div>
		{/each}
	</div>
{/if}

{#if files.length > 0 || links.length > 0}
	<div class="mt-2 flex flex-col gap-1" aria-label="Files and links">
		{#each files as file (file.id)}
			<div
				class="flex w-full items-center gap-2 rounded-md border border-black/10 bg-black/5 px-2 py-1.5 text-left dark:border-white/10 dark:bg-white/5"
				aria-busy={!file.dataUrl}
			>
				<span
					class="grid h-7 w-7 shrink-0 place-items-center rounded bg-black/10 text-[9px] font-bold text-[var(--scrapscache-text)] dark:bg-white/10"
					>{fileIconLabel(file.mime, file.name)}</span
				>
				<span class="min-w-0 flex-1 truncate text-xs text-[var(--scrapscache-text)]"
					>{file.name || 'File'}</span
				>
			</div>
		{/each}
		{#each links as url (url)}
			{@const card = localLinkCard(url)}
			<div
				class="flex w-full items-center gap-2 rounded-md border border-black/10 bg-black/5 px-2 py-1.5 text-left dark:border-white/10 dark:bg-white/5"
			>
				<span
					class="grid h-7 w-7 shrink-0 place-items-center rounded bg-black/10 text-[9px] font-bold text-[var(--scrapscache-text)] dark:bg-white/10"
					aria-hidden="true">{card?.badge ?? '↗'}</span
				>
				<span class="min-w-0 flex-1 truncate text-xs text-[var(--scrapscache-text)]"
					>{card?.hostname ?? url}</span
				>
			</div>
		{/each}
	</div>
{/if}

{#if photos.length > 0 || pendingPhotos.length > 0}
	<div class="mt-2 flex gap-1.5 overflow-x-auto" aria-label="Photos">
		{#each photos as img (img.id)}
			<div class="block shrink-0 overflow-hidden rounded-md">
				<img
					src={displayImageSrc(img)}
					alt={img.name ?? 'Photo'}
					class="h-24 w-auto max-w-[10rem] rounded-lg object-cover"
					loading="lazy"
					decoding="async"
					draggable="false"
				/>
			</div>
		{/each}
		{#each pendingPhotos as img (img.id)}
			<div
				class="h-24 w-24 shrink-0 animate-pulse rounded-lg bg-black/10 dark:bg-white/10"
				role="img"
				aria-label={`Loading ${img.name ?? 'photo'}`}
			></div>
		{/each}
	</div>
{/if}
