<script lang="ts">
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
	import { css, cva } from 'styled-system/css';
	import { button } from 'styled-system/recipes';
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

	const fsRoot = css({
		position: 'absolute',
		inset: 0,
		zIndex: 80,
		display: 'flex',
		flexDirection: 'column',
		bg: 'black',
		color: 'white'
	});
	const cropRootClass = css({
		position: 'relative',
		zIndex: 1,
		display: 'flex',
		minH: 0,
		flex: '1',
		flexDirection: 'column'
	});
	const cropCol = css({
		display: 'flex',
		minH: 0,
		flex: '1',
		flexDirection: 'column'
	});
	const cropHeader = css({
		position: 'relative',
		display: 'flex',
		flexShrink: 0,
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: '0.5rem',
		borderBottomWidth: '1px',
		borderColor: 'white/10',
		bg: 'black/85',
		px: '0.75rem',
		py: '0.5rem',
		backdropFilter: 'blur(12px)'
	});
	const cropBtnRound = css({
		display: 'grid',
		h: '2.25rem',
		w: '2.25rem',
		placeItems: 'center',
		rounded: 'full',
		color: 'white/90',
		touchAction: 'manipulation',
		cursor: 'pointer',
		_hover: { bg: 'white/10', color: 'white' }
	});
	const cropSep = css({
		mx: { base: '0.125rem', sm: '0.25rem' },
		h: '1rem',
		w: '1px',
		bg: 'white/20'
	});
	const cropToolBtn = css({
		display: 'grid',
		h: '2.25rem',
		w: '2.25rem',
		placeItems: 'center',
		rounded: 'md',
		color: 'white/80',
		transition: 'colors 120ms ease',
		touchAction: 'manipulation',
		cursor: 'pointer',
		_hover: { bg: 'white/10', color: 'white' },
		_disabled: {
			opacity: 0.35,
			cursor: 'not-allowed',
			_hover: { bg: 'transparent', color: 'white/80' }
		}
	});
	const ratioDesktopWrap = css({
		position: 'absolute',
		left: '50%',
		transform: 'translateX(-50%)',
		display: { base: 'none', sm: 'flex' },
		alignItems: 'center',
		justifyContent: 'center'
	});
	const radioGroupRoot = css({
		display: 'flex',
		alignItems: 'center',
		gap: '0.125rem',
		rounded: 'lg',
		bg: 'white/10',
		p: '0.125rem',
		fontSize: 'xs'
	});
	const radioGroupItem = css({
		cursor: 'pointer',
		rounded: 'sm',
		px: '0.625rem',
		py: '0.25rem',
		transition: 'colors 120ms ease',
		'&[data-state=checked]': {
			bg: 'white',
			fontWeight: 'semibold',
			color: 'black',
			boxShadow: 'sm'
		},
		'&[data-state=unchecked]': {
			color: 'white/80',
			_hover: { bg: 'white/10', color: 'white' }
		},
		'&[data-disabled]': {
			pointerEvents: 'none',
			opacity: 0.5
		}
	});
	const resetBtn = css({
		rounded: 'md',
		px: '0.625rem',
		py: '0.375rem',
		fontSize: 'xs',
		fontWeight: 'medium',
		color: 'white/70',
		transition: 'colors 120ms ease',
		touchAction: 'manipulation',
		cursor: 'pointer',
		_hover: { bg: 'white/10', color: 'white' },
		_disabled: { opacity: 0.3, pointerEvents: 'none' }
	});
	const saveCropBtnClass = css({
		minW: '5.25rem',
		px: '0.875rem',
		py: '0.375rem',
		fontSize: 'sm',
		fontWeight: 'medium'
	});
	const ratioMobileWrap = css({
		display: { base: 'flex', sm: 'none' },
		flexShrink: 0,
		alignItems: 'center',
		justifyContent: 'center',
		gap: '0.25rem',
		borderBottomWidth: '1px',
		borderColor: 'white/5',
		bg: 'black/60',
		px: '0.75rem',
		py: '0.375rem'
	});
	const mobileRatioBtn = cva({
		base: {
			rounded: 'sm',
			px: '0.5rem',
			py: '0.125rem',
			fontSize: 'xs',
			transition: 'colors 120ms ease',
			cursor: 'pointer'
		},
		variants: {
			active: {
				true: { bg: 'white', fontWeight: 'semibold', color: 'black' },
				false: { color: 'white/70', _hover: { bg: 'white/10', color: 'white' } }
			}
		}
	});
	const cropViewport = css({
		position: 'relative',
		display: 'flex',
		minH: 0,
		flex: '1',
		alignItems: 'center',
		justifyContent: 'center',
		p: { base: '0.5rem', sm: '1.5rem' },
		overflow: 'hidden'
	});
	const cropImgWrap = css({
		position: 'relative',
		flexShrink: 0,
		overflow: 'visible',
		boxShadow: '2xl'
	});
	const cropImg = css({
		h: 'full',
		w: 'full',
		objectFit: 'fill',
		display: 'block',
		userSelect: 'none',
		pointerEvents: 'none'
	});
	const cropErr = css({
		px: '1rem',
		pb: '0.75rem',
		textAlign: 'center',
		fontSize: 'xs',
		color: 'red.400'
	});
	const fsTopBar = css({
		position: 'absolute',
		insetX: 0,
		top: 0,
		zIndex: 20,
		display: 'flex',
		h: '3.5rem',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: '0.75rem',
		bgGradient: 'to-b',
		gradientFrom: 'black/75',
		gradientTo: 'transparent',
		px: '0.75rem',
		py: '0.5rem',
		backdropFilter: 'blur(2px)'
	});
	const topBarBtn = css({
		display: 'grid',
		h: '2.5rem',
		w: '2.5rem',
		flexShrink: 0,
		placeItems: 'center',
		rounded: 'full',
		color: 'white/90',
		touchAction: 'manipulation',
		cursor: 'pointer',
		_hover: { bg: 'white/10', color: 'white' }
	});
	const topBarTrashBtn = css({
		display: 'grid',
		h: '2.5rem',
		w: '2.5rem',
		placeItems: 'center',
		rounded: 'full',
		color: 'white/90',
		touchAction: 'manipulation',
		cursor: 'pointer',
		_hover: { bg: 'red.500/20', color: 'red.400' }
	});
	const navArrow = (side: 'left' | 'right') =>
		css({
			position: 'absolute',
			top: '50%',
			transform: 'translateY(-50%)',
			zIndex: 20,
			display: { base: 'none', sm: 'grid' },
			h: '2.75rem',
			w: '2.75rem',
			placeItems: 'center',
			rounded: 'full',
			bg: 'black/40',
			color: 'white/90',
			boxShadow: 'md',
			backdropFilter: 'blur(4px)',
			transition: 'colors 120ms ease',
			cursor: 'pointer',
			touchAction: 'manipulation',
			left: side === 'left' ? '0.75rem' : 'auto',
			right: side === 'right' ? '0.75rem' : 'auto',
			_hover: { bg: 'black/70', color: 'white' }
		});
	const viewerCenter = css({
		pointerEvents: 'none',
		position: 'relative',
		zIndex: 1,
		display: 'flex',
		h: 'full',
		alignItems: 'center',
		justifyContent: 'center',
		px: '1rem'
	});
	const viewerImg = css({
		pointerEvents: 'auto',
		maxH: 'full',
		maxW: 'full',
		userSelect: 'none',
		objectFit: 'contain'
	});
	const thumbStrip = css({
		position: 'relative',
		zIndex: 1,
		display: 'flex',
		flexShrink: 0,
		gap: '0.5rem',
		overflowX: 'auto',
		bgGradient: 'to-t',
		gradientFrom: 'black/85',
		gradientTo: 'transparent',
		px: '1rem',
		pb: '0.75rem',
		pt: '0.5rem'
	});
	const thumbBtn = cva({
		base: {
			h: '3.5rem',
			w: '3.5rem',
			flexShrink: 0,
			overflow: 'hidden',
			rounded: 'md',
			touchAction: 'manipulation',
			transition: 'opacity 120ms ease, box-shadow 120ms ease',
			cursor: 'pointer'
		},
		variants: {
			active: {
				true: { opacity: 1, ringWidth: '2px', ringColor: 'white' },
				false: { opacity: 0.5, _hover: { opacity: 0.85 } }
			}
		}
	});
	const thumbImg = css({ h: 'full', w: 'full', objectFit: 'cover' });

	const flexRowSm = css({
		display: 'flex',
		alignItems: 'center',
		gap: { base: '0.25rem', sm: '0.375rem' }
	});
	const flexRowMd = css({ display: 'flex', alignItems: 'center', gap: '0.5rem' });
	const flexRowGap1 = css({ display: 'flex', alignItems: 'center', gap: '0.25rem' });
	const flexRowGap15 = css({ display: 'flex', alignItems: 'center', gap: '0.375rem' });
	const ratioMobileBtn = (active: boolean) =>
		css({
			rounded: 'sm',
			px: '0.5rem',
			py: '0.125rem',
			fontSize: 'xs',
			transition: 'colors 120ms ease',
			bg: active ? 'white' : 'transparent',
			color: active ? 'black' : 'white/70',
			fontWeight: active ? 'semibold' : 'normal',
			_hover: { color: 'white' }
		});
	const titleWrap = css({
		minW: 0,
		flex: '1',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		fontSize: 'sm',
		fontWeight: 'medium',
		color: 'white/90'
	});
	const titleSize = css({ ml: '0.25rem', fontSize: 'xs', fontWeight: 'normal', color: 'white/60' });
	const viewerStage = css({ position: 'relative', minH: 0, flex: '1' });
	const zoomBackdrop = css({ position: 'absolute', inset: 0, cursor: 'zoom-out' });
</script>

{#if current}
	<div
		{@attach portal}
		{@attach trapKeys}
		class={fsRoot}
		role="dialog"
		aria-modal="true"
		aria-label="Photo"
	>
		{#if cropping}
			<div class={`crop-root ${cropRootClass}`}>
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
								<div class={flexRowSm}>
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
								<div class={ratioDesktopWrap}>
									<SegmentGroup.Root
										value={selectedRatio}
										onValueChange={(details) => {
											if (details.value) selectedRatio = details.value as any;
										}}
										disabled={cropBusy}
										class={radioGroupRoot}
										aria-label="Aspect ratio presets"
									>
										{#each [{ id: 'free', label: 'Free' }, { id: '1:1', label: '1:1' }, { id: '4:3', label: '4:3' }, { id: '16:9', label: '16:9' }] as opt (opt.id)}
											<SegmentGroup.Item value={opt.id} class={radioGroupItem}>
												<SegmentGroup.ItemText>{opt.label}</SegmentGroup.ItemText>
												<SegmentGroup.ItemHiddenInput />
											</SegmentGroup.Item>
										{/each}
									</SegmentGroup.Root>
								</div>

								<!-- Right: Reset & Apply -->
								<div class={flexRowMd}>
									<button
										type="button"
										class={resetBtn}
										onclick={() => resetCrop(cropper)}
										disabled={cropBusy}
										aria-label="Reset crop"
										title="Reset crop"
									>
										Reset
									</button>

									<button
										type="button"
										class={`${button({ variant: 'primary', size: 'sm' })} ${saveCropBtnClass}`}
										onclick={() => void applyCrop(cropper)}
										disabled={cropBusy}
										aria-label="Apply crop"
									>
										{#if cropBusy}
											<span>Saving…</span>
										{:else}
											<div class={flexRowGap15}>
												<Check size={16} aria-hidden="true" />
												<span>Apply</span>
											</div>
										{/if}
									</button>
								</div>
							</header>

							<div class={ratioMobileWrap} aria-label="Aspect ratio presets mobile">
								{#each [{ id: 'free', label: 'Free' }, { id: '1:1', label: '1:1' }, { id: '4:3', label: '4:3' }, { id: '16:9', label: '16:9' }] as opt (opt.id)}
									<button
										type="button"
										class={ratioMobileBtn(selectedRatio === opt.id)}
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
					<p class={cropErr}>{cropError}</p>
				{/if}
			</div>
		{:else}
			<header class={fsTopBar}>
				<div class={`${flexRowMd} ${css({ minW: 0 })}`}>
					<button type="button" class={topBarBtn} onclick={close} aria-label="Close photo">
						<X size={24} aria-hidden="true" />
					</button>
					<div class={titleWrap}>
						{current.name || `Photo ${(activeIndex ?? 0) + 1}`}
						{#if images.length > 1}
							<span class={titleSize}>
								({(activeIndex ?? 0) + 1} of {images.length})
							</span>
						{/if}
					</div>
				</div>

				<div class={flexRowGap1}>
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
				<button type="button" class={zoomBackdrop} onclick={close} aria-label="Close photo"
				></button>

				{#if images.length > 1}
					<Tooltip content="Previous photo" placement="right">
						<button
							type="button"
							class={navArrow('left')}
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
							class={navArrow('right')}
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
						class={viewerImg}
						decoding="async"
						draggable="false"
					/>
				</div>
			</div>

			{#if images.length > 1}
				<div class={`scrollable ${thumbStrip}`} aria-label="Photo thumbnails">
					{#each images as image, index (image.id)}
						<button
							type="button"
							class={thumbBtn({ active: index === activeIndex })}
							onclick={() => select(index)}
							aria-label={image.name ?? `Photo ${index + 1}`}
							aria-current={index === activeIndex ? 'true' : undefined}
						>
							<img src={displayImageSrc(image)} alt="" class={thumbImg} draggable="false" />
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
		overflow: visible;
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
		background: transparent;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-tap-highlight-color: transparent;
	}
	/* Generous invisible touch target (56px × 56px) centered on each corner */
	.crop-root :global([data-part='handle'][data-position='nw']),
	.crop-root :global([data-part='handle'][data-position='ne']),
	.crop-root :global([data-part='handle'][data-position='se']),
	.crop-root :global([data-part='handle'][data-position='sw']) {
		width: 3.5rem;
		height: 3.5rem;
		z-index: 20;
	}
	/* Generous invisible touch strip (56px tall) across horizontal edges */
	.crop-root :global([data-part='handle'][data-position='n']),
	.crop-root :global([data-part='handle'][data-position='s']) {
		height: 3.5rem;
		z-index: 10;
	}
	/* Generous invisible touch strip (56px wide) across vertical edges */
	.crop-root :global([data-part='handle'][data-position='w']),
	.crop-root :global([data-part='handle'][data-position='e']) {
		width: 3.5rem;
		z-index: 10;
	}
	/* Sleek, subtle visual knobs */
	.crop-knob {
		background: #ffffff;
		box-shadow:
			0 1px 3px rgb(0 0 0 / 0.5),
			0 0 0 1px rgb(0 0 0 / 0.25);
		pointer-events: none;
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease;
	}
	.crop-root :global([data-part='handle']:hover .crop-knob),
	.crop-root :global([data-part='handle']:active .crop-knob) {
		transform: scale(1.35);
		box-shadow:
			0 2px 6px rgb(0 0 0 / 0.7),
			0 0 0 1.5px rgb(0 0 0 / 0.35);
	}
	.crop-knob-corner {
		height: 0.75rem;
		width: 0.75rem;
		border-radius: 2px;
	}
	.crop-knob-edge-h {
		height: 0.25rem;
		width: 1.5rem;
		border-radius: 9999px;
	}
	.crop-knob-edge-v {
		height: 1.5rem;
		width: 0.25rem;
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
