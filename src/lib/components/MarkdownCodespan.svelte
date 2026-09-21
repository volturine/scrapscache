<script lang="ts">
	let {
		raw = '',
		text
	}: {
		raw?: string;
		text?: string;
		[key: string]: unknown;
	} = $props();

	const content = $derived(text ?? raw.replace(/^`+|`+$/g, ''));
</script>

<code class="markdown-token-code">{content}</code>
