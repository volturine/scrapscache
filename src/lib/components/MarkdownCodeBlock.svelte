<script lang="ts">
	import { highlightCodeLine } from '$lib/markdown';
	import MarkdownCopyButton from './MarkdownCopyButton.svelte';

	let {
		lang = '',
		text = ''
	}: {
		lang?: string;
		text?: string;
		[key: string]: unknown;
	} = $props();

	const codeLines = $derived(text.split('\n'));
</script>

<div class="markdown-block-shell" data-markdown-code-shell>
	<MarkdownCopyButton text={() => text} label="code" />
	<div class="markdown-block-scroll markdown-code-block note-scrollbar-hidden">
		<pre data-markdown-code-block data-language={lang || undefined}><code
				>{#each codeLines as codeLine, index (`${index}-${codeLine}`)}<span
						class="markdown-code-line"
						>{#each highlightCodeLine(codeLine, lang) as token, tokenIndex (`${tokenIndex}-${token.text}`)}{#if token.kind === 'plain'}{token.text}{:else}<span
									class="markdown-code-token-{token.kind}">{token.text}</span
								>{/if}{/each}</span
					>{/each}</code
			></pre>
	</div>
</div>
