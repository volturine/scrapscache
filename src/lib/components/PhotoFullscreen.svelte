<script lang="ts">
	import {
		photoCropRoot as cropRoot,
		photoCropCol as cropCol,
		photoCropHeader as cropHeader,
		photoCropSep as cropSep,
		photoCropRatioDesktop as cropRatioDesktop,
		photoCropRadioRoot as cropRadioRoot,
		photoCropRadioItem as cropRadioItem,
		photoCropReset as cropReset,
		photoCropSave as cropSave,
		photoCropRatioMobile as cropRatioMobile,
		photoCropViewport as cropViewport,
		photoCropImgWrap as cropImgWrap,
		photoCropImg as cropImg,
		photoCropTool as cropTool,
		photoCropKnob as cropKnob,
		photoViewerStage as viewerStage,
		photoViewerCenter as viewerCenter,
		photoViewerImage as viewerImage,
		photoViewerBackdrop as viewerBackdrop,
		photoViewerThumbStrip as viewerThumbStrip,
		photoViewerThumbImg as viewerThumbImg,
		photoViewerTitleSize as viewerTitleSize,
		photoRatioMobileBtn as ratioMobileBtn,
		photoNavArrow as navArrow,
		photoThumbBtn as thumbBtn,
		fullscreen
	} from '$panda/styles';
	import type { NoteImage } from '$lib/types';
	import {
		Check,
		ChevronLeft,
		ChevronRight,
		Crop,
		Download,
		RotateCw,
		Trash2,
		Undo2,
		X
	} from '@lucide/svelte';
	import { ImageCropper, type UseImageCropperContext } from '@ark-ui/svelte/image-cropper';
	import { DownloadTrigger } from '@ark-ui/svelte/download-trigger';
	import { SegmentGroup } from '@ark-ui/svelte/segment-group';
	import Tooltip from './Tooltip.svelte';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { cx } from 'styled-system/css';
	import { button, iconButton } from 'styled-system/recipes';
	import { center, hstack } from 'styled-system/patterns';
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
	let currentRotation = $state(0);

	interface CropHistoryState {
		rotation: number;
		ratio: 'free' | '1:1' | '4:3' | '16:9';
	}
	let historyStack = $state<CropHistoryState[]>([]);

	// Read the intrinsic size off the image the cropper already renders, rather
	// than probing a second detached one. Until it loads, viewportDimensions
	// falls back to the stored dimensions.
	function measureNatural(event: Event) {
		// Ark UI widens the img handler to EventHandler<Event, Element>.
		const img = event.currentTarget as HTMLImageElement;
		imgNaturalWidth = img.naturalWidth;
		imgNaturalHeight = img.naturalHeight;
	}

	const viewportDimensions = $derived.by(() => {
		const nw = imgNaturalWidth || current?.width || 800;
		const nh = imgNaturalHeight || current?.height || 600;
		const pad = cropContainerW < 640 ? 16 : 48;
		const maxW = Math.max(40, (cropContainerW || 800) - pad);
		const maxH = Math.max(40, (cropContainerH || 600) - pad);
		const scale = Math.min(1, maxW / nw, maxH / nh);
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
		historyStack = [];
		currentRotation = 0;
		selectedRatio = 'free';
	}

	function startCrop() {
		if (!canCrop) return;
		historyStack = [];
		currentRotation = 0;
		cropError = '';
		cropping = true;
	}

	function rotate(cropper: () => any) {
		historyStack.push({
			rotation: currentRotation,
			ratio: selectedRatio
		});
		currentRotation = (currentRotation + 90) % 360;
		cropper().rotateBy(90);
	}

	function resetCrop(cropper: () => any) {
		if (historyStack.length > 0 || currentRotation !== 0 || selectedRatio !== 'free') {
			historyStack.push({
				rotation: currentRotation,
				ratio: selectedRatio
			});
		}
		currentRotation = 0;
		selectedRatio = 'free';
		cropper().reset();
	}

	function undo(cropper: () => any) {
		const prev = historyStack.pop();
		if (!prev) return;
		if (prev.rotation !== currentRotation) {
			currentRotation = prev.rotation;
			cropper().setRotation(prev.rotation);
		}
		selectedRatio = prev.ratio;
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

	const fs = fullscreen({ theme: 'photo' });
	const cropBtnRound = iconButton({ variant: 'haze', size: 'sm' });
	const cropToolBtn = cx(iconButton({ variant: 'haze' }), cropTool);
	const topBarBtn = iconButton({ variant: 'haze' });
	const topBarTrashBtn = iconButton({ variant: 'hazeRose' });
</script>

{#if current}
	<div
		{@attach portal}
		{@attach trapKeys}
		class={fs.shell}
		role="dialog"
		aria-modal="true"
		aria-label="Photo"
	>
		{#if cropping}
			<div class={`crop-root ${cropRoot}`}>
				<ImageCropper.Root
					aspectRatio={currentAspectRatio}
					initialCrop={{
						x: 0,
						y: 0,
						width: viewportDimensions.width,
						height: viewportDimensions.height
					}}
					class={cropCol}
				>
					<ImageCropper.Context>
						{#snippet render(cropper)}
							<header class={cropHeader}>
								<!-- Left: Cancel, Rotate, Undo -->
								<div class={hstack({ gap: { base: '2xs', sm: 'xs' } })}>
									<Tooltip content="Cancel">
										<button
											type="button"
											class={cropBtnRound}
											onclick={cancelCrop}
											disabled={cropBusy}
											aria-label="Cancel crop"
											title="Cancel"
										>
											<X size={20} aria-hidden="true" />
										</button>
									</Tooltip>

									<div class={cropSep} aria-hidden="true"></div>

									<Tooltip content="Rotate 90°">
										<button
											type="button"
											class={cropToolBtn}
											onclick={() => rotate(cropper)}
											disabled={cropBusy}
											aria-label="Rotate 90 degrees"
											title="Rotate 90°"
										>
											<RotateCw size={16} aria-hidden="true" />
										</button>
									</Tooltip>
									<Tooltip content="Undo">
										<button
											type="button"
											class={cropToolBtn}
											onclick={() => undo(cropper)}
											disabled={cropBusy || historyStack.length === 0}
											aria-label="Undo crop adjustment"
											title="Undo"
										>
											<Undo2 size={16} aria-hidden="true" />
										</button>
									</Tooltip>
								</div>

								<!-- Center: Crop ratio presets -->
								<div class={cropRatioDesktop}>
									<SegmentGroup.Root
										value={selectedRatio}
										onValueChange={(details) => {
											if (details.value) selectedRatio = details.value as any;
										}}
										disabled={cropBusy}
										class={cropRadioRoot}
										aria-label="Aspect ratio presets"
									>
										{#each [{ id: 'free', label: 'Free' }, { id: '1:1', label: '1:1' }, { id: '4:3', label: '4:3' }, { id: '16:9', label: '16:9' }] as opt (opt.id)}
											<SegmentGroup.Item value={opt.id} class={cropRadioItem}>
												<SegmentGroup.ItemText>{opt.label}</SegmentGroup.ItemText>
												<SegmentGroup.ItemHiddenInput />
											</SegmentGroup.Item>
										{/each}
									</SegmentGroup.Root>
								</div>

								<!-- Right: Reset & Apply -->
								<div class={hstack({ gap: 'sm' })}>
									<button
										type="button"
										class={cropReset}
										onclick={() => resetCrop(cropper)}
										disabled={cropBusy}
										aria-label="Reset crop"
										title="Reset crop"
									>
										Reset
									</button>

									<button
										type="button"
										class={`${button({ variant: 'primary', size: 'sm' })} ${cropSave}`}
										onclick={() => void applyCrop(cropper)}
										disabled={cropBusy}
										aria-label="Apply crop"
									>
										{#if cropBusy}
											<span>Saving…</span>
										{:else}
											<div class={hstack({ gap: 'xs' })}>
												<Check size={16} aria-hidden="true" />
												<span>Apply</span>
											</div>
										{/if}
									</button>
								</div>
							</header>

							<div class={cropRatioMobile} aria-label="Aspect ratio presets mobile">
								{#each [{ id: 'free', label: 'Free' }, { id: '1:1', label: '1:1' }, { id: '4:3', label: '4:3' }, { id: '16:9', label: '16:9' }] as opt (opt.id)}
									<button
										type="button"
										class={ratioMobileBtn({ active: selectedRatio === opt.id })}
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
						class={cropViewport}
					>
						<ImageCropper.Viewport
							style="width: {viewportDimensions.width}px; height: {viewportDimensions.height}px;"
							class={cropImgWrap}
						>
							<ImageCropper.Image src={currentSrc} onload={measureNatural} class={cropImg} />
							<ImageCropper.Selection>
								{#each ImageCropper.handles as position (position)}
									<ImageCropper.Handle {position}>
										{@const knobShape =
											position.length === 2
												? 'corner'
												: position === 'n' || position === 's'
													? 'edgeH'
													: 'edgeV'}
										<div class={`crop-knob ${cropKnob({ shape: knobShape })}`}></div>
									</ImageCropper.Handle>
								{/each}
								<ImageCropper.Grid axis="horizontal" />
								<ImageCropper.Grid axis="vertical" />
							</ImageCropper.Selection>
						</ImageCropper.Viewport>
					</div>
				</ImageCropper.Root>
				{#if cropError}
					<p class={fs.notice}>{cropError}</p>
				{/if}
			</div>
		{:else}
			<header class={fs.header}>
				<div class={hstack({ gap: 'sm', minW: 0 })}>
					<button type="button" class={topBarBtn} onclick={close} aria-label="Close photo">
						<X size={24} aria-hidden="true" />
					</button>
					<div class={fs.title}>
						{current.name || `Photo ${(activeIndex ?? 0) + 1}`}
						{#if images.length > 1}
							<span class={viewerTitleSize}>
								({(activeIndex ?? 0) + 1} of {images.length})
							</span>
						{/if}
					</div>
				</div>

				<div class={hstack({ gap: '2xs' })}>
					<Tooltip content="Download photo">
						<DownloadTrigger
							fileName={current.name || 'photo.webp'}
							data={currentSrc}
							mimeType={current.mime || 'image/webp'}
							class={topBarBtn}
							aria-label="Download photo"
							title="Download photo"
						>
							<Download size={20} aria-hidden="true" />
						</DownloadTrigger>
					</Tooltip>

					{#if canCrop}
						<Tooltip content="Crop & rotate">
							<button
								type="button"
								class={topBarBtn}
								onclick={startCrop}
								aria-label="Crop photo"
								title="Crop and rotate"
							>
								<Crop size={20} aria-hidden="true" />
							</button>
						</Tooltip>
					{/if}

					{#if canDelete}
						<Tooltip content="Delete photo">
							<button
								type="button"
								class={topBarTrashBtn}
								onclick={() => void deleteCurrent()}
								aria-label="Delete photo"
								title="Delete photo"
							>
								<Trash2 size={20} aria-hidden="true" />
							</button>
						</Tooltip>
					{/if}
				</div>
			</header>

			<div class={viewerStage}>
				<button type="button" class={viewerBackdrop} onclick={close} aria-label="Close photo"
				></button>

				{#if images.length > 1}
					<Tooltip content="Previous photo" placement="right">
						<button
							type="button"
							class={navArrow({ side: 'left' })}
							onclick={() => move(-1)}
							aria-label="Previous photo"
							title="Previous photo"
						>
							<ChevronLeft size={24} aria-hidden="true" />
						</button>
					</Tooltip>
					<Tooltip content="Next photo" placement="left">
						<button
							type="button"
							class={navArrow({ side: 'right' })}
							onclick={() => move(1)}
							aria-label="Next photo"
							title="Next photo"
						>
							<ChevronRight size={24} aria-hidden="true" />
						</button>
					</Tooltip>
				{/if}

				<div {@attach swipeArea} class={viewerCenter}>
					<img
						src={currentSrc}
						alt={current.name ?? 'Photo'}
						class={viewerImage}
						decoding="async"
						draggable="false"
					/>
				</div>
			</div>

			{#if images.length > 1}
				<div class={`scrollable ${viewerThumbStrip}`} aria-label="Photo thumbnails">
					{#each images as image, index (image.id)}
						<button
							type="button"
							class={thumbBtn({ active: index === activeIndex })}
							onclick={() => select(index)}
							aria-label={image.name ?? `Photo ${index + 1}`}
							aria-current={index === activeIndex ? 'true' : undefined}
						>
							<img src={displayImageSrc(image)} alt="" class={viewerThumbImg} draggable="false" />
						</button>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
{/if}
