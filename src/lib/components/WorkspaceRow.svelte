<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronLeft, ChevronRight, CloudOff, MoreHorizontal, Pencil } from '@lucide/svelte';
	let {
		name,
		active,
		disabled,
		children,
		onselect,
		onrename,
		onunlink
	}: {
		name: string;
		active: boolean;
		disabled: boolean;
		children: Snippet;
		onselect: () => void;
		onrename: () => void;
		onunlink: () => void;
	} = $props();
	let open = $state(false);
	let offset = $state(0);
	let dragging = $state(false);
	let start: { x: number; y: number; offset: number } | null = null;
	let swiped = false;
	let rowElement: HTMLDivElement | undefined;
	function down(event: PointerEvent) {
		if (disabled || event.pointerType !== 'touch') return;
		start = { x: event.clientX, y: event.clientY, offset: open ? -144 : 0 };
		swiped = false;
		try {
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		} catch {
			// The gesture still works when a browser rejects pointer capture.
		}
	}
	function move(event: PointerEvent) {
		if (!start) return;
		const dx = event.clientX - start.x,
			dy = event.clientY - start.y;
		if (!dragging && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
			start = null;
			return;
		}
		if (!dragging && Math.abs(dx) < 8) return;
		dragging = true;
		swiped = true;
		offset = Math.max(-144, Math.min(0, start.offset + dx));
	}
	function end() {
		if (dragging) open = offset < -48;
		dragging = false;
		start = null;
	}
	function closeFromOutside(event: PointerEvent) {
		if (open && rowElement && !rowElement.contains(event.target as Node)) open = false;
	}
</script>

<svelte:document onpointerdown={closeFromOutside} />

<div class="row" class:open bind:this={rowElement}>
	<div class="actions">
		<button
			type="button"
			disabled={disabled || !open}
			tabindex={open ? 0 : -1}
			aria-label="Rename {name}"
			onclick={() => {
				open = false;
				onrename();
			}}><Pencil size={16} aria-hidden="true" />Rename</button
		>
		<button
			type="button"
			disabled={disabled || !open}
			tabindex={open ? 0 : -1}
			aria-label="Unlink {name}"
			class="unlink"
			onclick={() => {
				open = false;
				onunlink();
			}}><CloudOff size={16} aria-hidden="true" />Unlink</button
		>
	</div>
	<div
		class="front"
		class:active
		style:--swipe-offset={`${dragging ? offset : open ? -144 : 0}px`}
		class:dragging
	>
		<button
			type="button"
			class="select"
			{disabled}
			aria-label={active ? `${name} is active` : `Switch to ${name}`}
			onpointerdown={down}
			onpointermove={move}
			onpointerup={end}
			onpointercancel={() => {
				dragging = false;
				start = null;
			}}
			onclick={() => {
				if (swiped) {
					swiped = false;
					return;
				}
				if (open) open = false;
				else onselect();
			}}
		>
			{@render children()}
		</button>
		<button
			type="button"
			class="more"
			{disabled}
			aria-label="Actions for {name}"
			aria-expanded={open}
			onclick={() => {
				open = !open;
			}}
		>
			<span class="desktop-more"><MoreHorizontal size={17} aria-hidden="true" /></span>
			<span class="mobile-more">
				{#if open}<ChevronRight size={19} aria-hidden="true" />{:else}<ChevronLeft
						size={19}
						aria-hidden="true"
					/>{/if}
			</span>
		</button>
	</div>
</div>

<style>
	.row {
		position: relative;
		border-radius: 10px;
	}
	.row.open {
		z-index: 2;
	}
	.front {
		position: relative;
		display: flex;
		background: transparent;
		border-radius: 10px;
	}
	.front.active {
		background: var(--scrapscache-interactive-hover);
	}
	.front.dragging {
		transition: none;
	}
	.select {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px;
		flex: 1;
		min-width: 0;
		text-align: left;
		font-size: 14px;
		touch-action: pan-y;
		padding-right: 44px;
	}
	.more {
		position: absolute;
		top: 8px;
		right: 8px;
		display: grid;
		width: 28px;
		height: 28px;
		flex-shrink: 0;
		place-items: center;
		border-radius: 6px;
		color: var(--scrapscache-text-muted);
	}
	.actions {
		position: absolute;
		top: calc(100% - 3px);
		right: 6px;
		z-index: 3;
		display: grid;
		width: 150px;
		padding: 4px;
		border: 1px solid var(--scrapscache-border);
		border-radius: 8px;
		background: var(--scrapscache-surface, var(--scrapscache-bg));
		box-shadow: 0 10px 28px rgb(0 0 0 / 22%);
		visibility: hidden;
	}
	.row.open .actions {
		visibility: visible;
	}
	.actions button {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 8px;
		border-radius: 5px;
		font-size: 13px;
		text-align: left;
	}
	.actions button:hover {
		background: var(--scrapscache-interactive-hover);
	}
	.mobile-more {
		display: none;
	}
	@media (max-width: 640px) {
		.row {
			overflow: hidden;
		}
		.front {
			z-index: 1;
			transform: translateX(var(--swipe-offset));
			transition: transform 160ms ease;
			background: var(--scrapscache-surface, var(--scrapscache-bg));
		}
		.front.active {
			background: var(--scrapscache-interactive-hover);
		}
		.actions {
			inset: 0 0 0 auto;
			z-index: 0;
			display: flex;
			width: 144px;
			padding: 0;
			border: 0;
			border-radius: 0 10px 10px 0;
			box-shadow: none;
		}
		.row.open .actions,
		.row:has(.dragging) .actions {
			visibility: visible;
		}
		.actions button {
			width: 72px;
			flex-direction: column;
			justify-content: center;
			gap: 4px;
			padding: 0;
			border-radius: 0;
			font-size: 12px;
			text-align: center;
		}
		.actions button:hover {
			background: transparent;
		}
		.desktop-more {
			display: none;
		}
		.mobile-more {
			display: contents;
		}
		.more {
			position: static;
			width: 32px;
			height: auto;
		}
		.select {
			padding-right: 12px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.front {
			transition: none;
		}
	}
</style>
