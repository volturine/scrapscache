<script lang="ts">
	import type { NoteImage } from '$lib/types';
	import { X } from '@lucide/svelte';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { displayImageSrc } from '$lib/imageThumb';

	let {
		images,
		activeIndex = $bindable<number | null>(null)
	}: {
		images: NoteImage[];
		activeIndex?: number | null;
	} = $props();

	let touchStartX = 0;
	const portal = portalToAppOverlay;
	const current = $derived(activeIndex === null ? null : (images[activeIndex] ?? null));
	const currentSrc = $derived(current ? current.dataUrl || displayImageSrc(current) : '');

	function close() {
		activeIndex = null;
	}

	function select(index: number) {
		activeIndex = index;
	}

	function move(offset: number) {
		if (activeIndex === null || images.length < 2) return;
		activeIndex = (activeIndex + offset + images.length) % images.length;
	}

	function handleKey(event: KeyboardEvent) {
		if (activeIndex === null) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopImmediatePropagation();
			close();
			return;
		}
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			event.stopImmediatePropagation();
			move(event.key === 'ArrowLeft' ? -1 : 1);
		}
	}

	function trapKeys(node: HTMLElement) {
		const onKey = (event: KeyboardEvent) => handleKey(event);
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	}

	function swipeArea(node: HTMLElement) {
		const onTouchStart = (event: TouchEvent) => {
			touchStartX = event.touches[0]?.clientX ?? 0;
		};
		const onTouchEnd = (event: TouchEvent) => {
			if (activeIndex === null || images.length < 2) return;
			const deltaX = (event.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
			if (Math.abs(deltaX) < 48) return;
			move(deltaX < 0 ? 1 : -1);
		};
		node.addEventListener('touchstart', onTouchStart, { passive: true });
		node.addEventListener('touchend', onTouchEnd, { passive: true });
		return () => {
			node.removeEventListener('touchstart', onTouchStart);
			node.removeEventListener('touchend', onTouchEnd);
		};
	}
</script>

{#if current}
	<div
		{@attach portal}
		{@attach trapKeys}
		class="absolute inset-0 z-[80] flex flex-col bg-black"
		role="dialog"
		aria-modal="true"
		aria-label="Photo"
	>
		<button
			type="button"
			class="absolute left-2 top-2 z-10 grid h-11 w-11 place-items-center text-white touch-manipulation"
			onclick={close}
			aria-label="Close photo"
		>
			<X class="h-6 w-6 drop-shadow" aria-hidden="true" />
		</button>
		<div class="relative min-h-0 flex-1">
			<button
				type="button"
				class="absolute inset-0 cursor-zoom-out"
				onclick={close}
				aria-label="Close photo"
			></button>
			<div
				{@attach swipeArea}
				class="pointer-events-none relative z-[1] flex h-full items-center justify-center px-4"
			>
				<img
					src={currentSrc}
					alt={current.name ?? 'Photo'}
					class="pointer-events-auto max-h-full max-w-full select-none object-contain"
					decoding="async"
					draggable="false"
				/>
			</div>
		</div>
		{#if images.length > 1}
			<div
				class="scrollable relative z-[1] flex shrink-0 gap-2 overflow-x-auto px-4 py-3"
				aria-label="Photo thumbnails"
			>
				{#each images as image, index (image.id)}
					<button
						type="button"
						class="h-14 w-14 shrink-0 overflow-hidden rounded-md touch-manipulation {index ===
						activeIndex
							? 'ring-2 ring-white ring-offset-2 ring-offset-black'
							: 'opacity-60'}"
						onclick={() => select(index)}
						aria-label={image.name ?? `Photo ${index + 1}`}
						aria-current={index === activeIndex ? 'true' : undefined}
					>
						<img
							src={displayImageSrc(image)}
							alt=""
							class="h-full w-full object-cover"
							draggable="false"
						/>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}
