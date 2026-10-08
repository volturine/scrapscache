<script lang="ts">
	import {
		CaseSensitive,
		ChevronDown,
		ChevronRight,
		ChevronUp,
		Replace,
		ReplaceAll,
		X
	} from '@lucide/svelte';
	import { cx } from 'styled-system/css';
	import { iconButton, input } from 'styled-system/recipes';
	import { editorFindStyles as styles } from '$panda/styles';
	import { findShortcut, type FindShortcut } from '#lib/findInNote.js';
	import { isApplePlatform } from '#lib/platform.js';

	let {
		query = $bindable(''),
		replacement = $bindable(''),
		caseSensitive = $bindable(false),
		replaceOpen = $bindable(false),
		findField = $bindable(),
		replaceField = $bindable(),
		total,
		current,
		onquery,
		onshortcut,
		onreplace,
		onclose
	}: {
		query?: string;
		replacement?: string;
		caseSensitive?: boolean;
		replaceOpen?: boolean;
		findField?: HTMLInputElement;
		replaceField?: HTMLInputElement;
		total: number;
		/** Index of the current match, or -1. */
		current: number;
		onquery: () => void;
		onshortcut: (shortcut: FindShortcut) => void;
		onreplace: () => void;
		onclose: () => void;
	} = $props();

	const apple = isApplePlatform();
	const mod = apple ? '⌘' : 'Ctrl+';
	const status = $derived(
		query.length === 0 ? '' : total === 0 ? 'No results' : `${current + 1} of ${total}`
	);

	function handleKeydown(event: KeyboardEvent) {
		const shortcut = findShortcut(event, apple);
		if (shortcut) {
			event.preventDefault();
			onshortcut(shortcut);
			return;
		}
		if (event.key === 'Escape') {
			// The note sheet closes on Escape; here it only closes the bar.
			event.preventDefault();
			event.stopPropagation();
			onclose();
			return;
		}
		if (event.altKey && !event.metaKey && !event.ctrlKey && event.code === 'KeyC') {
			event.preventDefault();
			caseSensitive = !caseSensitive;
			onquery();
		}
	}

	function handleFindKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.isComposing || event.altKey) return;
		event.preventDefault();
		onshortcut(event.shiftKey ? 'previous' : 'next');
	}

	function handleReplaceKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.isComposing || event.altKey) return;
		event.preventDefault();
		onreplace();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class={styles.bar}
	role="search"
	aria-label="Find in note"
	data-editor-find
	onkeydown={handleKeydown}
>
	<div class={styles.row}>
		<button
			type="button"
			class={iconButton({ variant: 'ghost', size: 'xs' })}
			aria-label={replaceOpen ? 'Hide replace' : 'Show replace'}
			aria-expanded={replaceOpen}
			title="Toggle replace"
			onclick={() => (replaceOpen = !replaceOpen)}
		>
			{#if replaceOpen}
				<ChevronDown size={14} aria-hidden="true" />
			{:else}
				<ChevronRight size={14} aria-hidden="true" />
			{/if}
		</button>
		<input
			bind:this={findField}
			bind:value={query}
			class={cx(input({ size: 'sm' }), styles.field)}
			type="text"
			placeholder="Find"
			aria-label="Find"
			spellcheck="false"
			autocomplete="off"
			data-editor-find-query
			oninput={onquery}
			onkeydown={handleFindKeydown}
		/>
		<span class={styles.count} aria-live="polite" data-editor-find-count>{status}</span>
		<button
			type="button"
			class={cx(iconButton({ variant: 'ghost', size: 'xs' }), styles.toggle)}
			aria-label="Match case"
			aria-pressed={caseSensitive}
			title="Match case (Alt+C)"
			onclick={() => {
				caseSensitive = !caseSensitive;
				onquery();
			}}
		>
			<CaseSensitive size={16} aria-hidden="true" />
		</button>
		<button
			type="button"
			class={iconButton({ variant: 'ghost', size: 'xs' })}
			aria-label="Previous match"
			title="Previous match (Shift+Enter)"
			disabled={total === 0}
			onclick={() => onshortcut('previous')}
		>
			<ChevronUp size={16} aria-hidden="true" />
		</button>
		<button
			type="button"
			class={iconButton({ variant: 'ghost', size: 'xs' })}
			aria-label="Next match"
			title="Next match (Enter)"
			disabled={total === 0}
			onclick={() => onshortcut('next')}
		>
			<ChevronDown size={16} aria-hidden="true" />
		</button>
		<button
			type="button"
			class={iconButton({ variant: 'ghost', size: 'xs' })}
			aria-label="Close find"
			title="Close (Escape)"
			onclick={onclose}
		>
			<X size={16} aria-hidden="true" />
		</button>
	</div>
	{#if replaceOpen}
		<div class={styles.row}>
			<span class={iconButton({ variant: 'ghost', size: 'xs' })} aria-hidden="true"></span>
			<input
				bind:this={replaceField}
				bind:value={replacement}
				class={cx(input({ size: 'sm' }), styles.field)}
				type="text"
				placeholder="Replace"
				aria-label="Replace"
				spellcheck="false"
				autocomplete="off"
				data-editor-find-replacement
				onkeydown={handleReplaceKeydown}
			/>
			<button
				type="button"
				class={iconButton({ variant: 'ghost', size: 'xs' })}
				aria-label="Replace"
				title="Replace (Enter)"
				disabled={total === 0}
				onclick={onreplace}
			>
				<Replace size={16} aria-hidden="true" />
			</button>
			<button
				type="button"
				class={iconButton({ variant: 'ghost', size: 'xs' })}
				aria-label="Replace all"
				title={`Replace all (${mod}${apple ? '⌥' : 'Alt+'}Enter)`}
				disabled={total === 0}
				onclick={() => onshortcut('replaceAll')}
			>
				<ReplaceAll size={16} aria-hidden="true" />
			</button>
		</div>
	{/if}
</div>
