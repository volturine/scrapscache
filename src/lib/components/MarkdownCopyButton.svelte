<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';
	import { onDestroy } from 'svelte';

	let { text, label }: { text: () => string; label: 'table' | 'code' } = $props();
	let copied = $state(false);
	let resetTimer: ReturnType<typeof setTimeout> | null = null;

	function keepEditorFocus(event: PointerEvent) {
		event.preventDefault();
		event.stopPropagation();
	}

	async function copyBlock(event: MouseEvent) {
		event.stopPropagation();
		const value = text();
		let succeeded = false;
		try {
			await navigator.clipboard.writeText(value);
			succeeded = true;
		} catch {
			const textarea = document.createElement('textarea');
			textarea.value = value;
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.appendChild(textarea);
			textarea.select();
			try {
				succeeded = document.execCommand('copy');
			} catch {}
			document.body.removeChild(textarea);
		}
		if (!succeeded) return;
		copied = true;
		if (resetTimer !== null) clearTimeout(resetTimer);
		resetTimer = setTimeout(() => {
			copied = false;
			resetTimer = null;
		}, 1200);
	}

	onDestroy(() => {
		if (resetTimer !== null) clearTimeout(resetTimer);
	});
</script>

<button
	type="button"
	contenteditable="false"
	class="markdown-block-copy"
	aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
	title={copied ? 'Copied' : `Copy ${label}`}
	onpointerdown={keepEditorFocus}
	onclick={copyBlock}
>
	{#if copied}
		<Check aria-hidden="true" />
	{:else}
		<Copy aria-hidden="true" />
	{/if}
</button>
