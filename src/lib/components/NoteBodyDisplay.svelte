<script lang="ts">
	// A read-only preview of a note. Cards cover it with a shield so a press
	// anywhere drags the card and a click opens the note; attachments, links and
	// checklists are interactive in the editor instead.
	import type { Note } from '$lib/types';
	import { noteBody } from 'styled-system/recipes';
	import { parseBody, noteAttachments, type BodySegment } from '$lib/checklistBody';
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
		parseMarkdownBlocks,
		tokenizeMarkdownTableRow,
		type MarkdownBlock
	} from '$lib/markdown';
	import { uiStore } from '$lib/stores/ui.svelte';

	let { note, maxBodyLines }: { note: Note; maxBodyLines?: number } = $props();
	type MarkdownTableBlock = Extract<MarkdownBlock, { type: 'table' }>;

	const MAX_PREVIEW_CHARACTERS = 12_000;

	function previewBody(source: string): string {
		if (maxBodyLines === undefined) return source;
		let end = Math.min(source.length, MAX_PREVIEW_CHARACTERS);
		let lineCount = 1;
		for (let index = 0; index < end; index++) {
			if (source[index] !== '\n') continue;
			lineCount++;
			if (lineCount > maxBodyLines) {
				end = index;
				break;
			}
		}
		return source.slice(0, end);
	}

	const body = $derived(previewBody(note.body ?? ''));
	const segments = $derived(parseBody(body));
	const blocks = $derived(parseMarkdownBlocks(body));
	const rawLines = $derived(body.replace(/\r\n?/g, '\n').split('\n'));
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
	const links = $derived(extractHttpUrls(body));
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

{#snippet rawTableContent(text: string)}
	{@const tableTokens = tokenizeMarkdownTableRow(text)}
	{@const lastCellIndex = tableTokens.filter((token) => token.kind === 'cell').length - 1}
	<span class="markdown-raw-table-display-line">
		{#each tableTokens as token, tokenIndex (tokenIndex)}
			{#if token.kind === 'marker'}
				<span class="markdown-raw-table-source-marker">{token.text}</span>
			{:else}
				<span
					class="markdown-raw-table-display-cell"
					class:markdown-table-last-cell={token.columnIndex === lastCellIndex}
				>
					{@render inlineContent(token.text)}
				</span>
			{/if}
		{/each}
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
	class={[body.container, markdownStyles, 'markdown-content', uiStore.rawMarkdown && 'markdown-raw']}
>
	{#if uiStore.rawMarkdown}
		{#each segments as seg (seg.lineIndex)}
			{@const rawTable = rawTableAt(seg.lineIndex)}
			{#if rawTable}
				{#if rawTable.lineIndex === seg.lineIndex}
					<div
						class="markdown-block-surface markdown-table-scroll markdown-raw-table-scroll note-scrollbar-hidden"
						data-markdown-raw-table-container
						role="region"
						tabindex="-1"
						aria-label="Raw Markdown table"
					>
						<div class="markdown-raw-display-table">
							{#each rawTableSource(rawTable) as sourceLine, sourceLineIndex (sourceLineIndex)}
								<div class="markdown-raw-table-display-row">
									{@render rawTableContent(sourceLine)}
								</div>
							{/each}
						</div>
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
				<div
					class="markdown-block-surface markdown-table-scroll note-scrollbar-hidden"
					data-markdown-table-container
					role="region"
					tabindex="-1"
					aria-label="Markdown table"
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
	{/if}
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
