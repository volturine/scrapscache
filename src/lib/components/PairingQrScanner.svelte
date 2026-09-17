<script lang="ts">
	import { onMount } from 'svelte';
	import { cx } from 'styled-system/css';
	import { button, text } from 'styled-system/recipes';
	import { vstack } from 'styled-system/patterns';
	import { ImageUp } from '@lucide/svelte';
	import { syncStyles as styles } from '$panda/styles';
	import { pairingCodeFromImageData } from '$lib/pairingQr';

	let { onCode }: { onCode: (code: string) => void } = $props();

	const SCAN_INTERVAL_MS = 200;
	const CAMERA_MAX_EDGE = 800;
	const IMAGE_MAX_EDGE = 1600;

	let video = $state<HTMLVideoElement>();
	let fileInput = $state<HTMLInputElement>();
	let cameraReady = $state(false);
	let cameraError = $state('');
	let imageError = $state('');
	let stream: MediaStream | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;
	let canvas: HTMLCanvasElement | null = null;

	onMount(() => {
		void startCamera();
		return stop;
	});

	async function startCamera() {
		if (!navigator.mediaDevices?.getUserMedia) {
			cameraError = 'Camera is not available here. Choose an image of the QR code instead.';
			return;
		}
		try {
			const media = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'environment' },
				audio: false
			});
			if (stopped || !video) {
				media.getTracks().forEach((track) => track.stop());
				return;
			}
			stream = media;
			video.srcObject = media;
			await video.play();
			cameraReady = true;
			scheduleScan();
		} catch {
			if (stopped) return;
			cameraError =
				'Camera access is blocked. Allow it in your browser settings or choose an image of the QR code.';
		}
	}

	function scheduleScan() {
		timer = setTimeout(scanFrame, SCAN_INTERVAL_MS);
	}

	function scanFrame() {
		timer = null;
		if (stopped || !video) return;
		if (video.videoWidth > 0) {
			const code = decode(video, video.videoWidth, video.videoHeight, CAMERA_MAX_EDGE);
			if (code) return finish(code);
		}
		scheduleScan();
	}

	function decode(
		source: CanvasImageSource,
		width: number,
		height: number,
		maxEdge: number
	): string | null {
		const scale = Math.min(1, maxEdge / Math.max(width, height));
		canvas ??= document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(width * scale));
		canvas.height = Math.max(1, Math.round(height * scale));
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) return null;
		ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
		return pairingCodeFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
	}

	async function handleImage(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		imageError = '';
		let code: string | null = null;
		try {
			const bitmap = await createImageBitmap(file);
			code = decode(bitmap, bitmap.width, bitmap.height, IMAGE_MAX_EDGE);
			bitmap.close();
		} catch {
			code = null;
		}
		if (code) finish(code);
		else imageError = 'No sync QR code found in that image.';
	}

	function finish(code: string) {
		stop();
		onCode(code);
	}

	function stop() {
		stopped = true;
		if (timer !== null) clearTimeout(timer);
		timer = null;
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
	}
</script>

<div class={vstack({ gap: 'sm', alignItems: 'stretch' })}>
	{#if cameraError}
		<p class={text({ style: 'bodyMuted' })} role="status">{cameraError}</p>
	{:else}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={video}
			class={styles.qrScanner}
			autoplay
			muted
			playsinline
			aria-label="Camera preview for scanning the sync QR code"
		></video>
		<p class={text({ style: 'bodyMuted' })} role="status">
			{cameraReady ? 'Point the camera at the QR code on your other device.' : 'Starting camera…'}
		</p>
	{/if}
	<input
		bind:this={fileInput}
		type="file"
		accept="image/*"
		hidden
		onchange={(event) => void handleImage(event)}
	/>
	<button
		type="button"
		class={cx(button({ variant: 'secondary', size: 'md' }), styles.fullButton)}
		onclick={() => fileInput?.click()}
	>
		<ImageUp size={16} aria-hidden="true" />
		Choose QR image
	</button>
	{#if imageError}<p class={text({ tone: 'danger' })} role="alert">{imageError}</p>{/if}
</div>
