<script lang="ts">
	import { localAiAssistantStyles as styles } from '$panda/styles';
	import { Sparkles, X } from '@lucide/svelte';
	import { cx } from 'styled-system/css';
	import { button, input } from 'styled-system/recipes';
	import { hstack } from 'styled-system/patterns';
	import { onDestroy, onMount, tick } from 'svelte';
	import {
		localAiAssistantMessages,
		type AssistantTurn,
		type LocalAiAssistantMode
	} from '$lib/localAiAssistant';
	import { localAiStore } from '$lib/stores/localAi.svelte';
	import { writeClipboardText } from '$lib/utils';

	let {
		title,
		body,
		selection = '',
		commandMenu = false,
		onApply,
		onDismiss
	}: {
		title: string;
		body: string;
		selection?: string;
		commandMenu?: boolean;
		onApply: (result: string, mode: LocalAiAssistantMode) => boolean | void;
		onDismiss: () => void;
	} = $props();

	type ResultState = 'idle' | 'working' | 'proposal' | 'answer' | 'empty' | 'error';
	let mode = $state<LocalAiAssistantMode>('edit');
	let promptText = $state('');
	let refineText = $state('');
	let output = $state('');
	let error = $state('');
	let resultState = $state<ResultState>('idle');
	let turns = $state<AssistantTurn[]>([]);
	let copied = $state(false);
	let quickActionsOpen = $state(false);
	let promptField = $state<HTMLInputElement | null>(null);
	let nextTurnId = 0;
	let requestId = 0;
	const progress = $derived(Math.round(localAiStore.progress * 100));

	onMount(() => {
		quickActionsOpen = commandMenu;
		promptField?.focus();
	});
	onDestroy(() => {
		if (resultState === 'working') stop();
	});

	async function generate(request: string) {
		const id = ++requestId;
		const trimmed = request.trim();
		if (!trimmed) return;
		error = '';
		output = '';
		copied = false;
		resultState = 'working';
		try {
			const messages = localAiAssistantMessages(
				mode,
				trimmed,
				{ title, body, selection },
				undefined,
				mode === 'ask' ? turns : []
			);
			const result = await localAiStore.generate(messages, mode === 'edit' ? 1200 : 512, (text) => {
				if (id === requestId && mode === 'edit') output = text;
			});
			if (id !== requestId) return;
			output = result.trim();
			if (!output) {
				resultState = 'empty';
				return;
			}
			if (mode === 'edit') {
				resultState = 'proposal';
			} else {
				turns = [...turns, { id: ++nextTurnId, question: trimmed, answer: output }].slice(-4);
				promptText = '';
				resultState = 'answer';
				await tick();
				promptField?.blur();
			}
		} catch (cause) {
			if (id !== requestId) return;
			console.error('[localAi] assistant request failed:', cause);
			error = 'The on-device model could not finish. Try again.';
			resultState = 'error';
		} finally {
			if (id === requestId && resultState === 'working') resultState = 'empty';
		}
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		void generate(promptText);
	}

	function refine(event: SubmitEvent) {
		event.preventDefault();
		const instruction = refineText.trim();
		if (!instruction || resultState !== 'proposal') return;
		const currentProposal = output;
		refineText = '';
		void generateRefinement(instruction, currentProposal);
	}

	async function generateRefinement(instruction: string, previousProposal: string) {
		const id = ++requestId;
		error = '';
		output = '';
		resultState = 'working';
		try {
			const messages = localAiAssistantMessages(
				'edit',
				instruction,
				{ title, body, selection },
				{ previousProposal, instruction }
			);
			const result = await localAiStore.generate(messages, 1200, (text) => {
				if (id === requestId) output = text;
			});
			if (id !== requestId) return;
			output = result.trim();
			resultState = output ? 'proposal' : 'empty';
		} catch (cause) {
			if (id !== requestId) return;
			console.error('[localAi] proposal refinement failed:', cause);
			error = 'The on-device model could not refine this proposal. Try again.';
			resultState = 'error';
		}
	}

	function stop() {
		requestId++;
		localAiStore.stop();
		resultState = 'idle';
	}

	async function copy() {
		if (await writeClipboardText(output)) copied = true;
		else error = 'Could not copy the result.';
	}

	function close() {
		if (resultState === 'working') stop();
		onDismiss();
	}

	function applyResult(mode: LocalAiAssistantMode) {
		if (onApply(output, mode) === false) {
			error =
				'The note changed while this result was open. Close it and ask again before applying.';
		}
	}

	function chooseQuickAction(instruction: string, selectedMode: LocalAiAssistantMode = 'edit') {
		mode = selectedMode;
		promptText = instruction;
		quickActionsOpen = false;
		void tick().then(() => promptField?.focus());
	}
</script>

<section class={styles.panel} aria-label="On-device note assistant" data-local-ai-assistant>
	<div class={styles.header}>
		<Sparkles class={styles.icon} aria-hidden="true" />
		<strong class={styles.label}
			>{selection ? 'Work with selected text' : 'Ask or edit this note'}</strong
		>
		<span class={styles.privacy}>Runs on this device</span>
		<button
			type="button"
			class={button({ variant: 'quiet', size: 'xs' })}
			onclick={close}
			aria-label="Close assistant"
		>
			<X size={16} aria-hidden="true" />
		</button>
	</div>

	<div class={styles.modeRow} role="group" aria-label="Assistant mode">
		<button
			type="button"
			class={button({ variant: mode === 'edit' ? 'secondary' : 'quiet', size: 'sm' })}
			aria-pressed={mode === 'edit'}
			disabled={resultState === 'working'}
			onclick={() => {
				mode = 'edit';
				resultState = 'idle';
				output = '';
			}}>Edit note</button
		>
		<button
			type="button"
			class={button({ variant: mode === 'ask' ? 'secondary' : 'quiet', size: 'sm' })}
			aria-pressed={mode === 'ask'}
			disabled={resultState === 'working'}
			onclick={() => {
				mode = 'ask';
				resultState = 'idle';
				output = '';
			}}>Ask</button
		>
	</div>
	{#if quickActionsOpen}
		<div class={styles.quickActions} role="group" aria-label="Note assistant actions">
			<button
				type="button"
				class={button({ variant: 'quiet', size: 'xs' })}
				onclick={() => chooseQuickAction('Continue writing from where the note leaves off.')}
				>Continue writing</button
			>
			<button
				type="button"
				class={button({ variant: 'quiet', size: 'xs' })}
				onclick={() => chooseQuickAction('Rewrite this note more clearly.')}>Rewrite note</button
			>
			<button
				type="button"
				class={button({ variant: 'quiet', size: 'xs' })}
				onclick={() => chooseQuickAction('Summarize this note in a few short sentences.')}
				>Summarize</button
			>
			<button
				type="button"
				class={button({ variant: 'quiet', size: 'xs' })}
				onclick={() => chooseQuickAction('', 'ask')}>Ask…</button
			>
		</div>
	{/if}

	{#if turns.length > 1}
		<details>
			<summary class={styles.status}>{turns.length - 1} earlier answers</summary>
			<div class={styles.conversation}>
				{#each turns.slice(0, -1) as turn (turn.id)}
					<div class={styles.turn}>
						<strong>{turn.question}</strong>
						<p class={styles.status}>{turn.answer}</p>
					</div>
				{/each}
			</div>
		</details>
	{/if}

	<form class={hstack({ gap: 'xs', minW: 0 })} onsubmit={submit}>
		<input
			bind:this={promptField}
			bind:value={promptText}
			type="text"
			class={cx(input({ variant: 'unstyled' }), styles.prompt)}
			placeholder={mode === 'edit'
				? 'What should change?'
				: turns.length
					? 'Ask a follow-up…'
					: 'Ask about this note…'}
			aria-label={mode === 'edit'
				? 'Edit instruction'
				: turns.length
					? 'Ask a follow-up'
					: 'Question about this note'}
			disabled={resultState === 'working'}
		/>
		{#if resultState === 'working'}
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
				disabled={!promptText.trim()}>{mode === 'edit' ? 'Propose' : 'Ask'}</button
			>
		{/if}
	</form>

	{#if error}<p class={styles.status} role="alert">{error}</p>{/if}
	{#if resultState === 'empty'}
		<p class={styles.status} role="status">The model returned no text. Try a smaller request.</p>
	{/if}
	{#if resultState === 'proposal' && output}
		<div class={styles.proposal} data-ai-proposal>
			<p class={styles.privacy}>Proposal · nothing has changed yet</p>
			{#if selection}
				<p class={styles.oldText}>{selection}</p>
			{:else if body}
				<details>
					<summary class={styles.privacy}>Current note text</summary>
					<p class={styles.oldText}>{body}</p>
				</details>
			{/if}
			<p class={styles.output} aria-live="polite">{output}</p>
			<form class={hstack({ gap: 'xs', minW: 0 })} onsubmit={refine}>
				<input
					bind:value={refineText}
					type="text"
					class={cx(input({ variant: 'unstyled' }), styles.prompt)}
					placeholder="Refine the proposal…"
					aria-label="Refine the proposal"
				/>
				<button
					type="submit"
					class={button({ variant: 'secondary', size: 'sm' })}
					disabled={!refineText.trim()}>Refine</button
				>
			</form>
			<div class={styles.footer}>
				<button type="button" class={button({ variant: 'quiet', size: 'sm' })} onclick={close}
					>Discard</button
				>
				<button
					type="button"
					class={button({ variant: 'primary', size: 'sm' })}
					onclick={() => applyResult('edit')}>Accept</button
				>
			</div>
		</div>
	{/if}
	{#if resultState === 'answer' && output}
		<div class={styles.proposal} data-ai-answer>
			{#if turns.length > 1}<p class={styles.privacy}>Answer · based on this note</p>{/if}
			<p class={styles.output} aria-live="polite">{output}</p>
			<div class={styles.footer}>
				<button type="button" class={button({ variant: 'quiet', size: 'sm' })} onclick={close}
					>Dismiss</button
				>
				<button
					type="button"
					class={button({ variant: 'secondary', size: 'sm' })}
					onclick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button
				>
				<button
					type="button"
					class={button({ variant: 'primary', size: 'sm' })}
					onclick={() => applyResult('ask')}>Insert</button
				>
			</div>
		</div>
	{/if}
</section>
