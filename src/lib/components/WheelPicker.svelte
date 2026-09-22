<script lang="ts" generics="T extends string | number">
	import { wheelItem, wheelPickerStyles as styles } from '$panda/styles';
	import { onMount } from 'svelte';
	import { css } from 'styled-system/css';

	const ITEM_H = 36;
	const VISIBLE = 5;
	const PAD = Math.floor(VISIBLE / 2);
	const COPIES = 3;
	const FRICTION = 0.95;
	const MIN_VEL = 0.03;

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

	let offset = $state(0);
	let scrollIndex = $state<number | null>(null);
	let dragging = false;
	let pointerId: number | null = null;
	let startY = 0;
	let startOffset = 0;
	let lastY = 0;
	let lastT = 0;
	let velocity = 0;
	let anim = 0;
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
	const copyH = $derived(items.length * ITEM_H);
	const minTop = $derived((middleStart - PAD) * ITEM_H);
	const valueIndex = $derived(indexOf(value));
	const centerIndex = $derived(scrollIndex ?? middleStart + valueIndex);

	const looped = $derived.by(() => {
		const result: { visual: number; item: { value: T; label: string }; primary: boolean }[] = [];
		const n = items.length;
		if (n === 0) return result;
		for (let c = 0; c < COPIES; c++) {
			for (let i = 0; i < n; i++) {
				const visual = c * n + i;
				result.push({ visual, item: items[i], primary: c === 1 });
			}
		}
		return result;
	});

	function optionId(index: number): string {
		return `${uid}-opt-${index}`;
	}

	function wrapOffset(px: number): number {
		if (copyH === 0) return px;
		let top = px;
		const span = copyH;
		while (top < minTop) top += span;
		while (top >= minTop + span) top -= span;
		return top;
	}

	function applyOffset(px: number) {
		offset = wrapOffset(px);
		scrollIndex = Math.round(offset / ITEM_H) + PAD;
	}

	function snapTo(index: number) {
		offset = (index - PAD) * ITEM_H;
		scrollIndex = null;
	}

	function commitIndex(index: number) {
		const next = items[wrapIndex(index)];
		if (!next) return;
		snapTo(middleStart + wrapIndex(index));
		if (next.value !== value) onChange(next.value);
	}

	function settle() {
		commitIndex(Math.round(offset / ITEM_H) + PAD);
	}

	function stopAnim() {
		if (anim) {
			cancelAnimationFrame(anim);
			anim = 0;
		}
	}

	function inertia() {
		stopAnim();
		lastT = 0;
		const tick = (t: number) => {
			const dt = lastT ? Math.min(t - lastT, 32) : 16;
			lastT = t;
			if (Math.abs(velocity) < MIN_VEL) {
				anim = 0;
				settle();
				return;
			}
			applyOffset(offset - velocity * dt);
			velocity *= FRICTION;
			anim = requestAnimationFrame(tick);
		};
		anim = requestAnimationFrame(tick);
	}

	function setValue(next: T) {
		if (next !== value) onChange(next);
		snapTo(middleStart + indexOf(next));
	}

	onMount(() => {
		snapTo(middleStart + valueIndex);
		return () => {
			stopAnim();
			if (settleTimer) clearTimeout(settleTimer);
		};
	});

	$effect(() => {
		if (!dragging && scrollIndex == null) {
			snapTo(middleStart + valueIndex);
		}
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

	function handleWheel(node: HTMLElement) {
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			stopAnim();
			applyOffset(offset + e.deltaY);
			if (settleTimer) clearTimeout(settleTimer);
			settleTimer = setTimeout(settle, 80);
		};
		node.addEventListener('wheel', onWheel, { passive: false });
		return () => node.removeEventListener('wheel', onWheel);
	}

	function handlePointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		stopAnim();
		if (settleTimer) clearTimeout(settleTimer);
		pointerId = e.pointerId;
		if (e.currentTarget instanceof HTMLElement) {
			e.currentTarget.setPointerCapture(e.pointerId);
		}
		dragging = false;
		startY = e.clientY;
		startOffset = offset;
		lastY = e.clientY;
		lastT = performance.now();
		velocity = 0;
	}

	function handlePointerMove(e: PointerEvent) {
		if (pointerId !== e.pointerId) return;
		const dy = e.clientY - startY;
		if (Math.abs(dy) > 6) dragging = true;
		const now = performance.now();
		const dt = now - lastT;
		if (dt > 0) velocity = (e.clientY - lastY) / dt;
		lastY = e.clientY;
		lastT = now;
		applyOffset(startOffset - dy);
	}

	function handlePointerUp(e: PointerEvent) {
		if (pointerId !== e.pointerId) return;
		pointerId = null;
		if (dragging) inertia();
		else settle();
	}

	function selectItem(item: { value: T }) {
		if (dragging) return;
		setValue(item.value);
	}
</script>

<div class={`${css({ position: 'relative' })} ${className}`} style="height: {ITEM_H * VISIBLE}px">
	<div class={styles.band} aria-hidden="true"></div>
	<div
		class={styles.viewport}
		style="height: {ITEM_H * VISIBLE}px"
		role="listbox"
		tabindex="0"
		aria-label={ariaLabel}
		aria-activedescendant={optionId(wrapIndex(centerIndex))}
		{@attach handleWheel}
		onkeydown={handleKeydown}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
	>
		<div class={styles.track} style="transform: translate3d(0, {-offset}px, 0)">
			{#each looped as row (row.visual)}
				{@const dist =
					row.visual === centerIndex
						? 'center'
						: Math.abs(row.visual - centerIndex) === 1
							? 'adjacent'
							: 'far'}
				<div
					id={row.primary ? optionId(wrapIndex(row.visual)) : undefined}
					role={row.primary ? 'option' : undefined}
					aria-hidden={!row.primary}
					aria-selected={row.primary ? row.item.value === value : undefined}
					class={wheelItem[dist]}
					style="height: {ITEM_H}px"
					onclick={() => selectItem(row.item)}
				>
					{row.item.label}
				</div>
			{/each}
		</div>
	</div>
</div>
