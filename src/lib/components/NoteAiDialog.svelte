<script lang="ts">
	import { noteAiDialogStyles as styles } from '$panda/styles';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { onMount } from 'svelte';
	import { cx } from 'styled-system/css';
	import { button, dialog } from 'styled-system/recipes';
	import { portalToAppOverlay } from '$lib/appViewport';
	import {
		NOTE_AI_ACTIONS,
		NoteAiApply,
		noteAiLabel,
		noteAiMessages,
		noteAiResult,
		translationLanguage,
		type NoteAiAction
	} from '$lib/noteAiActions';
	import { localAiStore, LocalAiStatus } from '$lib/stores/localAi.svelte';

	let {
		action,
		title,
		body,
		onApply,
		onClose
	}: {
		action: NoteAiAction;
		title: string;
		body: string;
		onApply: (result: string) => void;
		onClose: () => void;
	} = $props();

	const APPLY_LABEL: Record<NoteAiApply, string> = {
		[NoteAiApply.Append]: 'Add to note',
		[NoteAiApply.ReplaceBody]: 'Replace note text',
		[NoteAiApply.Title]: 'Use as title'
	};

	// The dialog is mounted for one action on one note; it never changes underneath it.
	// svelte-ignore state_referenced_locally
	const spec = NOTE_AI_ACTIONS[action];
	const language = translationLanguage(navigator.language);
	// svelte-ignore state_referenced_locally
	const heading = noteAiLabel(action, language);

	let result = $state('');
	let error = $state('');
	let done = $state(false);
	let copied = $state(false);
	const percent = $derived(Math.round(localAiStore.progress * 100));

	onMount(() => {
		localAiStore
			.generate(noteAiMessages(action, { title, body }, language), spec.maxTokens, (text) => {
				result = text;
			})
			.then((text) => {
				result = noteAiResult(action, text);
			})
			.catch((err) => {
				console.error('[noteAi] failed:', err);
				error =
					localAiStore.status === LocalAiStatus.Ready
						? 'The model could not finish. Try again.'
						: 'The model is no longer on this device. Download it again from Settings.';
			})
			.finally(() => {
				done = true;
			});
		return () => localAiStore.stop();
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(result);
			copied = true;
		} catch {
			error = 'Could not copy the result.';
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
					<Dialog.Title class={d.title}>{heading}</Dialog.Title>
				</div>

				<div class={cx(d.body, styles.body)}>
					{#if error}
						<p class={d.error} role="alert">{error}</p>
					{:else if result}
						<p class={styles.output} aria-live="polite">{result}</p>
					{:else if localAiStore.loading}
						<p class={styles.pending} role="status">Loading model… {percent}%</p>
					{:else if !done}
						<p class={styles.pending} role="status">Writing…</p>
					{:else}
						<p class={styles.pending}>The model returned nothing for this note.</p>
					{/if}

					{#if done && result && spec.apply === NoteAiApply.ReplaceBody}
						<p class={styles.hint}>Replaces the note text. Undo in the note restores it.</p>
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
								disabled={!result}
								class={button({ variant: 'secondary', size: 'md' })}
								>{copied ? 'Copied' : 'Copy'}</button
							>
							<button
								type="button"
								onclick={() => onApply(result)}
								disabled={!result}
								class={button({ variant: 'primary', size: 'md' })}>{APPLY_LABEL[spec.apply]}</button
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
