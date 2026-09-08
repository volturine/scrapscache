<script lang="ts">
	import type { NoteImage } from '$lib/types';
	import {
		Check,
		ChevronLeft,
		ChevronRight,
		Crop,
		Download,
		RotateCcw,
		RotateCw,
		Trash2,
		X
	} from '@lucide/svelte';
	import { ImageCropper, type UseImageCropperContext } from '@ark-ui/svelte/image-cropper';
	import { DownloadTrigger } from '@ark-ui/svelte/download-trigger';
	import { SegmentGroup } from '@ark-ui/svelte/segment-group';
	import Tooltip from './Tooltip.svelte';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { displayImageSrc } from '$lib/imageThumb';
	import { noteImageFromCroppedDataUrl } from '$lib/noteImages';

	let {
		images,
		activeIndex = $bindable<number | null>(null),
		onCrop,
		onDelete
	}: {
		images: NoteImage[];
		activeIndex?: number | null;
		onCrop?: (image: NoteImage) => void | Promise<void>;
		onDelete?: (id: string) => void | Promise<void>;
	} = $props();

	let touchStartX = 0;
	let cropping = $state(false);
	let cropBusy = $state(false);
	let cropError = $state('');
	let selectedRatio = $state<'free' | '1:1' | '4:3' | '16:9'>('free');
	let imgNaturalWidth = $state(0);
	let imgNaturalHeight = $state(0);
	let cropContainerW = $state(0);
	let cropContainerH = $state(0);

	$effect(() => {
		if (!currentSrc) return;
		const img = new Image();
		img.src = currentSrc;
		if (img.complete && img.naturalWidth) {
			imgNaturalWidth = img.naturalWidth;
			imgNaturalHeight = img.naturalHeight;
		} else {
			img.onload = () => {
				imgNaturalWidth = img.naturalWidth;
				imgNaturalHeight = img.naturalHeight;
			};
		}
	});

	const viewportDimensions = $derived.by(() => {
		const nw = imgNaturalWidth || current?.width || 800;
		const nh = imgNaturalHeight || current?.height || 600;
		const pad = cropContainerW < 640 ? 16 : 48;
		const maxW = Math.max(100, (cropContainerW || 800) - pad);
		const maxH = Math.max(100, (cropContainerH || 600) - pad);
		const scale = Math.min(maxW / nw, maxH / nh);
		return {
			width: Math.max(40, Math.round(nw * scale)),
			height: Math.max(40, Math.round(nh * scale))
		};
	});

	const portal = portalToAppOverlay;
	const current = $derived(activeIndex === null ? null : (images[activeIndex] ?? null));
	const currentSrc = $derived(current ? current.dataUrl || displayImageSrc(current) : '');
	const canCrop = $derived(!!onCrop && !!current?.dataUrl);
	const canDelete = $derived(!!onDelete && !!current);

	const currentAspectRatio = $derived(
		selectedRatio === '1:1'
			? 1
			: selectedRatio === '4:3'
				? 4 / 3
				: selectedRatio === '16:9'
					? 16 / 9
					: undefined
	);

	function close() {
		cropping = false;
		cropBusy = false;
		cropError = '';
		selectedRatio = 'free';
		activeIndex = null;
	}

	function cancelCrop() {
		cropping = false;
		cropBusy = false;
		cropError = '';
		selectedRatio = 'free';
	}

	function startCrop() {
		if (!canCrop) return;
		cropError = '';
		cropping = true;
	}

	function select(index: number) {
		if (cropping) return;
		activeIndex = index;
	}

	function move(offset: number) {
		if (cropping || activeIndex === null || images.length < 2) return;
		activeIndex = (activeIndex + offset + images.length) % images.length;
	}

	async function deleteCurrent() {
		if (!current || !onDelete) return;
		const id = current.id;
		if (images.length <= 1) {
			close();
		} else if (activeIndex !== null && activeIndex >= images.length - 1) {
			activeIndex = images.length - 2;
		}
		await onDelete(id);
	}

	function handleKey(event: KeyboardEvent) {
		if (activeIndex === null) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopImmediatePropagation();
			if (cropping) cancelCrop();
			else close();
			return;
		}
		if (cropping) return;
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
			if (cropping || activeIndex === null || images.length < 2) return;
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

	async function applyCrop(cropper: UseImageCropperContext) {
		if (!current || !onCrop) return;
		cropBusy = true;
		cropError = '';
		try {
			const result = await cropper().getCroppedImage({
				output: 'dataUrl',
				type: 'image/webp',
				quality: 0.88,
				maxSize: { width: 2560, height: 2560 }
			});
			if (typeof result !== 'string') throw new Error('Could not crop this photo');
			await onCrop(await noteImageFromCroppedDataUrl(current, result));
			cancelCrop();
		} catch (err) {
			cropError = err instanceof Error ? err.message : 'Could not crop this photo';
			cropBusy = false;
		}
	}
</script>

{#if current}
	<div
		{@attach portal}
		{@attach trapKeys}
		class="absolute inset-0 z-[80] flex flex-col bg-black text-white"
		role="dialog"
		aria-modal="true"
		aria-label="Photo"
	>
		{#if cropping}
			<div class="crop-root relative z-[1] flex min-h-0 flex-1 flex-col">
				<ImageCropper.Root aspectRatio={currentAspectRatio} class="flex min-h-0 flex-1 flex-col">
					<ImageCropper.Context>
						{#snippet render(cropper)}
							<header
								class="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-black/85 px-3 py-2 backdrop-blur-md"
							>
								<div class="flex items-center gap-2">
									<Tooltip content="Cancel">
										<button
											type="button"
											class="grid h-10 w-10 place-items-center rounded-full text-white/90 hover:bg-white/10 hover:text-white touch-manipulation"
											onclick={cancelCrop}
											disabled={cropBusy}
											aria-label="Cancel crop"
											title="Cancel"
										>
											<X class="h-6 w-6" aria-hidden="true" />
										</button>
									</Tooltip>
									<span class="text-sm font-medium text-white/90">Crop & Rotate</span>
								</div>

								<div class="flex items-center gap-1.5 sm:gap-2">
									<Tooltip content="Rotate 90°">
										<button
											type="button"
											class="grid h-9 w-9 place-items-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white touch-manipulation"
											onclick={() => cropper().rotateBy(90)}
											disabled={cropBusy}
											aria-label="Rotate 90 degrees"
											title="Rotate 90°"
										>
											<RotateCw class="h-4 w-4" aria-hidden="true" />
										</button>
									</Tooltip>
									<Tooltip content="Reset">
										<button
											type="button"
											class="grid h-9 w-9 place-items-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white touch-manipulation"
											onclick={() => {
												cropper().reset();
												selectedRatio = 'free';
											}}
											disabled={cropBusy}
											aria-label="Reset crop"
											title="Reset"
										>
											<RotateCcw class="h-4 w-4" aria-hidden="true" />
										</button>
									</Tooltip>

									<SegmentGroup.Root
										value={selectedRatio}
										onValueChange={(details) => {
											if (details.value) selectedRatio = details.value as any;
										}}
										disabled={cropBusy}
										class="hidden items-center gap-0.5 rounded-lg bg-white/10 p-0.5 text-xs sm:flex"
										aria-label="Aspect ratio presets"
									>
										{#each [{ id: 'free', label: 'Free' }, { id: '1:1', label: '1:1' }, { id: '4:3', label: '4:3' }, { id: '16:9', label: '16:9' }] as opt (opt.id)}
											<SegmentGroup.Item
												value={opt.id}
												class="cursor-pointer rounded px-2 py-1 transition-colors data-[state=checked]:bg-white data-[state=checked]:font-semibold data-[state=checked]:text-black data-[state=checked]:shadow data-[state=unchecked]:text-white/80 data-[state=unchecked]:hover:bg-white/10 data-[state=unchecked]:hover:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
											>
												<SegmentGroup.ItemText>{opt.label}</SegmentGroup.ItemText>
												<SegmentGroup.ItemHiddenInput />
											</SegmentGroup.Item>
										{/each}
									</SegmentGroup.Root>
								</div>

								<div class="flex items-center gap-2">
									<button
										type="button"
										class="scrapscache-button scrapscache-button-primary min-w-[5.25rem] px-3.5 py-1.5 text-sm font-medium"
										onclick={() => void applyCrop(cropper)}
										disabled={cropBusy}
										aria-label="Apply crop"
									>
										{#if cropBusy}
											<span>Saving…</span>
										{:else}
											<div class="flex items-center gap-1.5">
												<Check class="h-4 w-4" aria-hidden="true" />
												<span>Apply</span>
											</div>
										{/if}
									</button>
								</div>
							</header>

							<div
								class="flex shrink-0 items-center justify-center gap-1 border-b border-white/5 bg-black/60 px-3 py-1.5 sm:hidden"
								aria-label="Aspect ratio presets mobile"
							>
								{#each [{ id: 'free', label: 'Free' }, { id: '1:1', label: '1:1' }, { id: '4:3', label: '4:3' }, { id: '16:9', label: '16:9' }] as opt (opt.id)}
									<button
										type="button"
										class="rounded px-2 py-0.5 text-xs transition-colors {selectedRatio === opt.id
											? 'bg-white font-semibold text-black shadow'
											: 'text-white/80 hover:bg-white/10 hover:text-white'}"
										onclick={() => (selectedRatio = opt.id as any)}
										disabled={cropBusy}
									>
										{opt.label}
									</button>
								{/each}
							</div>
						{/snippet}
					</ImageCropper.Context>

					<div
						bind:clientWidth={cropContainerW}
						bind:clientHeight={cropContainerH}
						class="relative flex min-h-0 flex-1 items-center justify-center p-2 sm:p-6 overflow-hidden"
					>
						<ImageCropper.Viewport
							style="width: {viewportDimensions.width}px; height: {viewportDimensions.height}px;"
							class="relative shrink-0 overflow-hidden shadow-2xl"
						>
							<ImageCropper.Image
								src={currentSrc}
								class="h-full w-full object-fill block select-none pointer-events-none"
							/>
							<ImageCropper.Selection>
								{#each ImageCropper.handles as position (position)}
									<ImageCropper.Handle {position}>
										<div
											class="crop-knob {position.length === 2
												? 'crop-knob-corner'
												: position === 'n' || position === 's'
													? 'crop-knob-edge-h'
													: 'crop-knob-edge-v'}"
										></div>
									</ImageCropper.Handle>
								{/each}
								<ImageCropper.Grid axis="horizontal" />
								<ImageCropper.Grid axis="vertical" />
							</ImageCropper.Selection>
						</ImageCropper.Viewport>
					</div>
				</ImageCropper.Root>
				{#if cropError}
					<p class="px-4 pb-3 text-center text-xs text-red-400">{cropError}</p>
				{/if}
			</div>
		{:else}
			<header
				class="absolute inset-x-0 top-0 z-20 flex h-14 items-center justify-between gap-3 bg-gradient-to-b from-black/75 to-transparent px-3 py-2 backdrop-blur-[2px]"
			>
				<div class="flex min-w-0 items-center gap-2">
					<button
						type="button"
						class="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/90 hover:bg-white/10 hover:text-white touch-manipulation"
						onclick={close}
						aria-label="Close photo"
					>
						<X class="h-6 w-6 drop-shadow" aria-hidden="true" />
					</button>
					<div class="min-w-0 flex-1 truncate text-sm font-medium text-white/90">
						{current.name || `Photo ${(activeIndex ?? 0) + 1}`}
						{#if images.length > 1}
							<span class="ml-1 text-xs font-normal text-white/60">
								({(activeIndex ?? 0) + 1} of {images.length})
							</span>
						{/if}
					</div>
				</div>

				<div class="flex items-center gap-1">
					<Tooltip content="Download photo">
						<DownloadTrigger
							fileName={current.name || 'photo.webp'}
							data={currentSrc}
							mimeType={current.mime || 'image/webp'}
							class="grid h-10 w-10 place-items-center rounded-full text-white/90 hover:bg-white/10 hover:text-white touch-manipulation"
							aria-label="Download photo"
							title="Download photo"
						>
							<Download class="h-5 w-5 drop-shadow" aria-hidden="true" />
						</DownloadTrigger>
					</Tooltip>

					{#if canCrop}
						<Tooltip content="Crop & rotate">
							<button
								type="button"
								class="grid h-10 w-10 place-items-center rounded-full text-white/90 hover:bg-white/10 hover:text-white touch-manipulation"
								onclick={startCrop}
								aria-label="Crop photo"
								title="Crop and rotate"
							>
								<Crop class="h-5 w-5 drop-shadow" aria-hidden="true" />
							</button>
						</Tooltip>
					{/if}

					{#if canDelete}
						<Tooltip content="Delete photo">
							<button
								type="button"
								class="grid h-10 w-10 place-items-center rounded-full text-white/90 hover:bg-red-500/20 hover:text-red-400 touch-manipulation"
								onclick={() => void deleteCurrent()}
								aria-label="Delete photo"
								title="Delete photo"
							>
								<Trash2 class="h-5 w-5 drop-shadow" aria-hidden="true" />
							</button>
						</Tooltip>
					{/if}
				</div>
			</header>

			<div class="relative min-h-0 flex-1">
				<button
					type="button"
					class="absolute inset-0 cursor-zoom-out"
					onclick={close}
					aria-label="Close photo"
				></button>

				{#if images.length > 1}
					<Tooltip content="Previous photo" placement="right">
						<button
							type="button"
							class="absolute left-3 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white/90 shadow-md backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white sm:grid touch-manipulation"
							onclick={() => move(-1)}
							aria-label="Previous photo"
							title="Previous photo"
						>
							<ChevronLeft class="h-6 w-6" aria-hidden="true" />
						</button>
					</Tooltip>
					<Tooltip content="Next photo" placement="left">
						<button
							type="button"
							class="absolute right-3 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white/90 shadow-md backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white sm:grid touch-manipulation"
							onclick={() => move(1)}
							aria-label="Next photo"
							title="Next photo"
						>
							<ChevronRight class="h-6 w-6" aria-hidden="true" />
						</button>
					</Tooltip>
				{/if}

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
					class="scrollable relative z-[1] flex shrink-0 gap-2 overflow-x-auto bg-gradient-to-t from-black/85 to-transparent px-4 pb-3 pt-2"
					aria-label="Photo thumbnails"
				>
					{#each images as image, index (image.id)}
						<button
							type="button"
							class="h-14 w-14 shrink-0 overflow-hidden rounded-md touch-manipulation transition-opacity {index ===
							activeIndex
								? 'ring-2 ring-white ring-offset-2 ring-offset-black'
								: 'opacity-60 hover:opacity-90'}"
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
		{/if}
	</div>
{/if}

<style>
	.crop-root :global([data-part='viewport']) {
		position: relative;
		overflow: hidden;
		touch-action: none;
		user-select: none;
	}
	.crop-root :global([data-part='image']) {
		position: absolute;
		max-width: none;
		user-select: none;
	}
	.crop-root :global([data-part='selection']) {
		box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.65);
		outline: 1.5px solid rgb(255 255 255 / 0.95);
	}
	.crop-root :global([data-part='handle']) {
		display: grid;
		place-items: center;
		z-index: 10;
	}
	.crop-knob {
		background: white;
		box-shadow:
			0 0 3px rgb(0 0 0 / 0.6),
			0 0 0 1px rgb(0 0 0 / 0.35);
	}
	.crop-knob-corner {
		height: 0.75rem;
		width: 0.75rem;
		border-radius: 2px;
	}
	.crop-knob-edge-h {
		height: 0.35rem;
		width: 1.25rem;
		border-radius: 9999px;
	}
	.crop-knob-edge-v {
		height: 1.25rem;
		width: 0.35rem;
		border-radius: 9999px;
	}
	.crop-root :global([data-part='grid'][data-axis='horizontal']) {
		border-bottom: 1px solid rgb(255 255 255 / 0.4);
		border-top: 1px solid rgb(255 255 255 / 0.4);
	}
	.crop-root :global([data-part='grid'][data-axis='vertical']) {
		border-left: 1px solid rgb(255 255 255 / 0.4);
		border-right: 1px solid rgb(255 255 255 / 0.4);
	}
</style>
