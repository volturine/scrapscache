<script lang="ts">
	import { localAiAssistantStyles as styles } from '$panda/styles';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { onMount, tick } from 'svelte';
	import { cx } from 'styled-system/css';
	import { button, dialog, input } from 'styled-system/recipes';
	import { hstack } from 'styled-system/patterns';
	import { Copy, Sparkles, X } from '@lucide/svelte';
	import { portalToAppOverlay } from '$lib/appViewport';
	import {
		notesQuestionMessages,
		relevantNotesForQuestion,
		type AssistantTurn,
		type RelevantNote
	} from '$lib/localAiAssistant';
	import type { Note } from '$lib/types';
	import { localAiStore } from '$lib/stores/localAi.svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { writeClipboardText } from '$lib/utils';

	let { notes, onClose }: { notes: Note[]; onClose: () => void } = $props();
	let query = $state('');
	let answer = $state('');
	let error = $state('');
	let sources = $state<RelevantNote[]>([]);
	let turns = $state<AssistantTurn[]>([]);
	let loading = $state(false);
	let copied = $state(false);
	let questionField = $state<HTMLInputElement | null>(null);
	let activeQuestion = $state('');
	let nextTurnId = 0;
	let requestId = 0;
	const progress = $derived(Math.round(localAiStore.progress * 100));
	const d = dialog({ size: 'sm', presentation: 'appOverlay' });

	onMount(() => questionField?.focus());

	async function ask(event: SubmitEvent) {
		event.preventDefault();
		const question = query.trim();
		if (!question || loading) return;
		const freshMatches = relevantNotesForQuestion(question, notes);
		const seen = new Set(sources.map((note) => note.id));
		const matching = turns.length
			? [...sources, ...freshMatches.filter((note) => !seen.has(note.id))].slice(0, 4)
			: freshMatches;
		if (matching.length === 0) {
			activeQuestion = question;
			sources = [];
			answer = '';
			error = '';
			query = '';
			return;
		}
		const id = ++requestId;
		activeQuestion = question;
		sources = matching;
		answer = '';
		error = '';
		copied = false;
		loading = true;
		try {
			const result = await localAiStore.generate(
				notesQuestionMessages(question, matching, turns),
				512,
				(text) => {
					if (id === requestId) answer = text;
				}
			);
			if (id !== requestId) return;
			answer = result.trim();
			if (answer) {
				turns = [...turns, { id: ++nextTurnId, question, answer }].slice(-4);
				query = '';
				await tick();
				questionField?.blur();
			}
		} catch (cause) {
			if (id !== requestId) return;
			console.error('[localAi] cross-note question failed:', cause);
			answer = '';
			error = 'Could not finish the answer. Your notes stayed on this device.';
		} finally {
			if (id === requestId) loading = false;
		}
	}

	function stop() {
		requestId++;
		localAiStore.stop();
		loading = false;
	}

	function close() {
		if (loading) stop();
		onClose();
	}

	async function copy() {
		if (await writeClipboardText(answer)) copied = true;
		else error = 'Could not copy the answer.';
	}

	function saveAsNote() {
		if (!answer) return;
		notesStore.createNote({ title: activeQuestion.slice(0, 80), body: answer });
		close();
	}
</script>

<Dialog.Root
	open
	onOpenChange={(details) => {
		if (!details.open) close();
	}}
	onEscapeKeyDown={(event) => event.stopPropagation()}
	preventScroll={false}
>
	<div {@attach portalToAppOverlay} class={d.portal} role="presentation">
		<Dialog.Backdrop class={d.backdrop} />
		<Dialog.Positioner class={d.positioner}>
			<Dialog.Content class={d.panel}>
				<div class={d.header}>
					<div class={styles.header}>
						<Sparkles class={styles.icon} aria-hidden="true" />
						<div class={styles.label}>
							<Dialog.Title class={d.title}>Ask across notes</Dialog.Title>
							<Dialog.Description class={styles.privacy}>
								Answers use matching active notes on this device. Secret notes and attachments are
								left out.
							</Dialog.Description>
						</div>
						<button
							type="button"
							class={button({ variant: 'quiet', size: 'xs' })}
							onclick={close}
							aria-label="Close Ask across notes"
						>
							<X size={16} aria-hidden="true" />
						</button>
					</div>
				</div>

				<div class={d.body}>
					{#if turns.length > 0}
						<details>
							<summary class={styles.status}>{turns.length} earlier answers</summary>
							<div class={styles.conversation}>
								{#each turns as turn (turn.id)}
									<div class={styles.turn}>
										<strong>{turn.question}</strong>
										<p class={styles.status}>{turn.answer}</p>
									</div>
								{/each}
							</div>
						</details>
					{/if}

					<form class={hstack({ gap: 'xs', minW: 0 })} onsubmit={ask}>
						<input
							bind:this={questionField}
							bind:value={query}
							type="text"
							class={cx(input({ variant: 'unstyled' }), styles.prompt)}
							placeholder="Ask a question about your notes…"
							aria-label="Ask a question across notes"
							disabled={loading}
						/>
						{#if loading}
							<span class={styles.status} role="status">
								{localAiStore.loading ? `Loading model… ${progress}%` : 'Thinking…'}
							</span>
							<button type="button" class={button({ variant: 'quiet', size: 'sm' })} onclick={stop}
								>Stop</button
							>
						{:else}
							<button
								type="submit"
								class={button({ variant: 'primary', size: 'sm' })}
								disabled={!query.trim()}>Ask</button
							>
						{/if}
					</form>

					{#if error}<p class={d.error} role="alert">{error}</p>{/if}
					{#if activeQuestion && !loading && sources.length === 0 && !error}
						<p class={styles.status} role="status">No matching non-secret notes found.</p>
					{/if}
					{#if activeQuestion && !loading && sources.length > 0 && !answer && !error}
						<p class={styles.status} role="status">
							The model returned no text. Try another question.
						</p>
					{/if}
					{#if sources.length > 0}
						<div class={styles.proposal}>
							<p class={styles.privacy}>
								Based on {sources.length} matching note{sources.length === 1 ? '' : 's'}
							</p>
							{#if answer}<p class={styles.output} aria-live="polite">{answer}</p>{/if}
							<details>
								<summary class={styles.status}>Sources</summary>
								<div class={styles.conversation}>
									{#each sources as source (source.id)}
										<div class={styles.turn}>
											<strong>{source.title}</strong>
											<p class={styles.status}>{source.body}</p>
										</div>
									{/each}
								</div>
							</details>
							{#if answer && !loading}
								<div class={styles.footer}>
									<button
										type="button"
										class={button({ variant: 'quiet', size: 'sm' })}
										onclick={close}>Dismiss</button
									>
									<button
										type="button"
										class={button({ variant: 'secondary', size: 'sm' })}
										onclick={() => void copy()}
									>
										<Copy size={14} aria-hidden="true" />{copied ? 'Copied' : 'Copy'}
									</button>
									<button
										type="button"
										class={button({ variant: 'primary', size: 'sm' })}
										onclick={saveAsNote}>Save as note</button
									>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
