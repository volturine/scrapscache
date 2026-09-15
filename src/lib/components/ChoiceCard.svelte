<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronRight } from '@lucide/svelte';

	let {
		title,
		caption,
		badge = '',
		danger = false,
		disabled = false,
		element = $bindable(null),
		icon,
		onclick
	}: {
		title: string;
		caption: string;
		badge?: string;
		danger?: boolean;
		disabled?: boolean;
		element?: HTMLButtonElement | null;
		icon: Snippet;
		onclick: () => void;
	} = $props();
</script>

<button
	bind:this={element}
	type="button"
	class={['choice', danger && 'danger']}
	{disabled}
	{onclick}
>
	<span class="icon" aria-hidden="true">{@render icon()}</span>
	<span class="body">
		<span class="title"
			>{title}{#if badge}<span class="badge">{badge}</span>{/if}</span
		>
		<span class="caption">{caption}</span>
	</span>
	<ChevronRight size={18} class="arrow" aria-hidden="true" />
</button>

<style>
	.choice {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 14px;
		border: 1px solid var(--scrapscache-border);
		border-radius: 12px;
		background: var(--scrapscache-bg);
		color: var(--scrapscache-text);
		text-align: left;
		cursor: pointer;
		transition:
			border-color 120ms ease,
			background-color 120ms ease;
		touch-action: manipulation;
	}
	.choice:hover:not(:disabled) {
		border-color: var(--scrapscache-accent);
		background: color-mix(in srgb, var(--scrapscache-accent) 7%, var(--scrapscache-bg));
	}
	.choice.danger:hover:not(:disabled) {
		border-color: var(--scrapscache-danger);
		background: color-mix(in srgb, var(--scrapscache-danger) 7%, var(--scrapscache-bg));
	}
	.choice:focus-visible {
		outline: 2px solid var(--scrapscache-focus, var(--scrapscache-accent));
		outline-offset: 2px;
	}
	.choice:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.icon {
		display: grid;
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		place-items: center;
		border-radius: 10px;
		background: color-mix(in srgb, var(--scrapscache-accent) 15%, transparent);
		color: var(--scrapscache-accent);
	}
	.danger .icon {
		background: var(--scrapscache-danger-subtle);
		color: var(--scrapscache-danger);
	}
	.body {
		min-width: 0;
		flex: 1;
	}
	.title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		font-weight: 500;
	}
	.danger .title {
		color: var(--scrapscache-danger);
	}
	.badge {
		padding: 1px 7px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--scrapscache-accent) 15%, transparent);
		color: var(--scrapscache-accent);
		font-size: 11px;
		font-weight: 500;
	}
	.caption {
		display: block;
		margin-top: 3px;
		color: var(--scrapscache-text-muted);
		font-size: 12px;
		line-height: 1.45;
	}
	.choice :global(.arrow) {
		flex-shrink: 0;
		color: var(--scrapscache-text-muted);
		transition: transform 120ms ease;
	}
	.choice:hover:not(:disabled) :global(.arrow) {
		transform: translateX(2px);
		color: var(--scrapscache-text);
	}
</style>
