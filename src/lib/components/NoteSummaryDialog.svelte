<script lang="ts">
	import { localAiSummaryStyles as styles } from '$panda/styles';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { onMount } from 'svelte';
	import { cx } from 'styled-system/css';
	import { button, dialog } from 'styled-system/recipes';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { localAiStore, LocalAiStatus } from '$lib/stores/localAi.svelte';

	let {
		title,
		body,
		onInsert,
		onClose
	}: {
		title: string;
		body: string;
		onInsert: (summary: string) => void;
		onClose: () => void;
	} = $props();

	let summary = $state('');
	let error = $state('');
	let done = $state(false);
	let copied = $state(false);
	const percent = $derived(Math.round(localAiStore.progress * 100));

	onMount(() => {
		localAiStore
			.summarize(title, body, (text) => {
				summary = text;
			})
			.then((text) => {
				summary = text;
			})
			.catch((err) => {
				console.error('[summary] failed:', err);
				error =
					localAiStore.status === LocalAiStatus.Ready
						? 'Could not summarize this note.'
						: 'The model is no longer on this device. Download it again from Settings.';
			})
			.finally(() => {
				done = true;
			});
		return () => localAiStore.stop();
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(summary);
			copied = true;
		} catch {
			error = 'Could not copy the summary.';
		}
	}

	const d = dialog({ size: 'sm', presentation: 'appOverlay' });
</script>

<Dialog.Root
	open
	onOpenChange={(details) => {
		if (!details.open) onClose();
	}}
	onEscapeKeyDown={(event) => {
		// Escape closes this dialog only, not the note it was opened from.
		event.stopPropagation();
	}}
	preventScroll={false}
>
	<div {@attach portalToAppOverlay} class={d.portal} role="presentation">
		<Dialog.Backdrop class={d.backdrop} />
		<Dialog.Positioner class={d.positioner}>
			<Dialog.Content class={d.panel}>
				<div class={d.header}>
					<p class={styles.eyebrow}>Generated on this device</p>
					<Dialog.Title class={d.title}>Summary</Dialog.Title>
				</div>

				<div class={cx(d.body, styles.body)}>
					{#if error}
						<p class={d.error} role="alert">{error}</p>
					{:else if summary}
						<p class={styles.output} aria-live="polite">{summary}</p>
					{:else if localAiStore.loading}
						<p class={styles.pending} role="status">Loading model… {percent}%</p>
					{:else if !done}
						<p class={styles.pending} role="status">Summarizing…</p>
					{:else}
						<p class={styles.pending}>The model returned nothing for this note.</p>
					{/if}

					<div class={cx(d.footer, styles.footer)}>
						{#if done}
							<button
								type="button"
								onclick={onClose}
								class={button({ variant: 'quiet', size: 'md' })}>Close</button
							>
							<button
								type="button"
								onclick={() => void copy()}
								disabled={!summary}
								class={button({ variant: 'secondary', size: 'md' })}
								>{copied ? 'Copied' : 'Copy'}</button
							>
							<button
								type="button"
								onclick={() => onInsert(summary)}
								disabled={!summary}
								class={button({ variant: 'primary', size: 'md' })}>Add to note</button
							>
						{:else}
							<button
								type="button"
								onclick={() => localAiStore.stop()}
								class={button({ variant: 'quiet', size: 'md' })}>Stop</button
							>
						{/if}
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
