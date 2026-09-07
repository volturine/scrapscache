<script lang="ts" generics="T extends string | number">
	import { onMount } from 'svelte';

	const ITEM_H = 36;
	const VISIBLE = 5;
	const PAD = Math.floor(VISIBLE / 2);
	const COPIES = 3;

	let {
		items,
		value,
		onChange,
		ariaLabel,
		class: className = ''
	}: {
		items: { value: T; label: string }[];
		value: T;
		onChange: (value: T) => void;
		ariaLabel: string;
		class?: string;
	} = $props();

	const uid = $props.id();

	let el = $state<HTMLDivElement | undefined>();
	let scrollIndex = $state<number | null>(null);
	let dragging = false;
	let pointerStartY = 0;
	let ignoreScroll = false;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	function indexOf(next: T): number {
		const i = items.findIndex((item) => item.value === next);
		return i < 0 ? 0 : i;
	}

	function wrapIndex(visual: number): number {
		const n = items.length;
		if (n === 0) return 0;
		return ((visual % n) + n) % n;
	}

	function stepValue(from: T, delta: number): T {
		const n = items.length;
		if (n === 0) return from;
		return items[wrapIndex(indexOf(from) + delta)].value;
	}

	const middleStart = $derived(items.length);
	const valueIndex = $derived(indexOf(value));
	const centerIndex = $derived(scrollIndex ?? middleStart + valueIndex);
	const looped = $derived(
		Array.from({ length: items.length * COPIES }, (_, visual) => ({
			visual,
			item: items[wrapIndex(visual)],
			primary: visual >= middleStart && visual < middleStart + items.length
		}))
	);

	function optionId(logical: number): string {
		return `${uid}-opt-${logical}`;
	}

	function copyHeight(): number {
		return items.length * ITEM_H;
	}

	function centerFromScroll(scrollTop: number): number {
		return Math.round(scrollTop / ITEM_H) + PAD;
	}

	function setScrollTop(top: number) {
		if (!el || Math.abs(el.scrollTop - top) < 1) return;
		const alreadyIgnoring = ignoreScroll;
		ignoreScroll = true;
		el.scrollTop = top;
		if (alreadyIgnoring) return;
		requestAnimationFrame(() => {
			ignoreScroll = false;
		});
	}

	function snapTo(index: number) {
		setScrollTop((index - PAD) * ITEM_H);
	}

	function recenter() {
		if (!el || items.length === 0) return;
		const copyH = copyHeight();
		const minTop = (middleStart - PAD) * ITEM_H;
		const maxTop = (middleStart + items.length - PAD) * ITEM_H;
		let top = el.scrollTop;
		while (top < minTop) top += copyH;
		while (top >= maxTop) top -= copyH;
		setScrollTop(top);
	}

	function commitIndex(index: number) {
		const next = items[wrapIndex(index)];
		if (!next) return;
		snapTo(middleStart + wrapIndex(index));
		if (next.value !== value) onChange(next.value);
		scrollIndex = null;
	}

	function settle() {
		if (ignoreScroll || !el) return;
		recenter();
		commitIndex(centerFromScroll(el.scrollTop));
	}

	function scheduleSettle() {
		if (settleTimer) clearTimeout(settleTimer);
		settleTimer = setTimeout(settle, 120);
	}

	function handleScroll() {
		if (!el || ignoreScroll) return;
		recenter();
		scrollIndex = centerFromScroll(el.scrollTop);
		scheduleSettle();
	}

	function setValue(next: T) {
		if (next !== value) onChange(next);
		snapTo(middleStart + indexOf(next));
	}

	onMount(() => {
		const node = el;
		if (!node) return;
		ignoreScroll = true;
		snapTo(middleStart + valueIndex);
		const onScroll = () => handleScroll();
		const onEnd = () => settle();
		node.addEventListener('scroll', onScroll);
		node.addEventListener('scrollend', onEnd);
		const frame = requestAnimationFrame(() => {
			snapTo(middleStart + valueIndex);
			requestAnimationFrame(() => {
				ignoreScroll = false;
			});
		});
		return () => {
			cancelAnimationFrame(frame);
			node.removeEventListener('scroll', onScroll);
			node.removeEventListener('scrollend', onEnd);
			if (settleTimer) clearTimeout(settleTimer);
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
			e.preventDefault();
			setValue(stepValue(value, -1));
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
			e.preventDefault();
			setValue(stepValue(value, 1));
		} else if (e.key === 'Home') {
			e.preventDefault();
			setValue(items[0].value);
		} else if (e.key === 'End') {
			e.preventDefault();
			setValue(items[items.length - 1].value);
		} else if (e.key === 'PageUp') {
			e.preventDefault();
			setValue(stepValue(value, -5));
		} else if (e.key === 'PageDown') {
			e.preventDefault();
			setValue(stepValue(value, 5));
		}
	}

	function handlePointerDown(e: PointerEvent) {
		pointerStartY = e.clientY;
		dragging = false;
	}

	function handlePointerMove(e: PointerEvent) {
		if (Math.abs(e.clientY - pointerStartY) > 6) dragging = true;
	}

	function selectItem(item: { value: T }) {
		if (dragging) return;
		setValue(item.value);
	}
</script>

<div class="relative {className}" style="height: {ITEM_H * VISIBLE}px">
	<div
		class="pointer-events-none absolute inset-x-0 top-1/2 z-0 h-9 -translate-y-1/2 rounded-lg bg-[var(--scrapscache-bg)]"
		aria-hidden="true"
	></div>
	<div
		class="wheel-picker scrollable absolute inset-0 z-10 overflow-y-auto outline-none"
		style="height: {ITEM_H * VISIBLE}px"
		role="listbox"
		tabindex="0"
		aria-label={ariaLabel}
		aria-activedescendant={optionId(wrapIndex(centerIndex))}
		bind:this={el}
		onkeydown={handleKeydown}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
	>
		{#each looped as row (row.visual)}
			<div
				id={row.primary ? optionId(wrapIndex(row.visual)) : undefined}
				role={row.primary ? 'option' : undefined}
				aria-hidden={!row.primary}
				aria-selected={row.primary ? row.item.value === value : undefined}
				class="flex cursor-pointer items-center justify-center tabular-nums transition-opacity duration-75
					{row.visual === centerIndex
					? 'text-base font-semibold text-[var(--scrapscache-text)]'
					: Math.abs(row.visual - centerIndex) === 1
						? 'text-sm font-medium text-[var(--scrapscache-text-muted)]'
						: 'text-sm text-[var(--scrapscache-text-muted)] opacity-40'}"
				style="height: {ITEM_H}px; scroll-snap-align: center"
				onclick={() => selectItem(row.item)}
			>
				{row.item.label}
			</div>
		{/each}
	</div>
</div>

<style>
	.wheel-picker {
		scrollbar-width: none;
		-ms-overflow-style: none;
		-webkit-overflow-scrolling: touch;
		touch-action: pan-y;
		scroll-snap-type: y mandatory;
		overscroll-behavior: contain;
		-webkit-mask-image: linear-gradient(
			to bottom,
			transparent 0%,
			#000 28%,
			#000 72%,
			transparent 100%
		);
		mask-image: linear-gradient(to bottom, transparent 0%, #000 28%, #000 72%, transparent 100%);
	}

	.wheel-picker::-webkit-scrollbar {
		display: none;
	}
</style>
