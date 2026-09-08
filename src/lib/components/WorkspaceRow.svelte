<script lang="ts">
	import type { Snippet } from 'svelte';
	import { MoreHorizontal, Pencil, Trash2 } from '@lucide/svelte';
	let {
		name,
		active,
		disabled,
		children,
		onselect,
		onrename,
		ondelete
	}: {
		name: string;
		active: boolean;
		disabled: boolean;
		children: Snippet;
		onselect: () => void;
		onrename: () => void;
		ondelete: () => void;
	} = $props();
	let open = $state(false);
	let offset = $state(0);
	let dragging = $state(false);
	let start: { x: number; y: number; offset: number } | null = null;
	let swiped = false;
	function down(event: PointerEvent) {
		if (disabled || event.pointerType !== 'touch') return;
		start = { x: event.clientX, y: event.clientY, offset: open ? -144 : 0 };
		swiped = false;
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
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
	}
	function end() {
		if (dragging) open = offset < -48;
		dragging = false;
		start = null;
	}
</script>

<div class="row" class:open>
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
			aria-label="Delete {name}"
			class="delete"
			onclick={() => {
				open = false;
				ondelete();
			}}><Trash2 size={16} aria-hidden="true" />Delete</button
		>
	</div>
	<div
		class="front"
		class:active
		style:transform={`translateX(${dragging ? offset : open ? -144 : 0}px)`}
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
			class="more icon-btn"
			{disabled}
			aria-label="Actions for {name}"
			aria-expanded={open}
			onclick={() => {
				open = !open;
			}}><MoreHorizontal size={18} aria-hidden="true" /></button
		>
	</div>
</div>

<style>
	.row {
		position: relative;
		overflow: hidden;
		border-radius: 10px;
	}
	.front {
		position: relative;
		display: flex;
		background: var(--scrapscache-surface, var(--scrapscache-bg));
		transition: transform 160ms ease;
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
	}
	.more {
		width: 40px;
		flex-shrink: 0;
	}
	.actions {
		position: absolute;
		inset: 0 0 0 auto;
		display: flex;
		width: 144px;
		visibility: hidden;
	}
	.row.open .actions,
	.row:has(.dragging) .actions {
		visibility: visible;
	}
	.actions button {
		width: 72px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		font-size: 12px;
		background: var(--scrapscache-interactive-hover);
	}
	.actions .delete {
		color: var(--scrapscache-danger);
	}
	@media (prefers-reduced-motion: reduce) {
		.front {
			transition: none;
		}
	}
</style>
