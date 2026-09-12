<script lang="ts">
	import { cx, sva } from 'styled-system/css';
	import { iconButton } from 'styled-system/recipes';
	import type { NoteImage } from '$lib/types';
	import { dataUrlToBlob } from '$lib/imageBlob';
	import { ChevronLeft, Download } from '@lucide/svelte';
	import { DownloadTrigger } from '@ark-ui/svelte/download-trigger';
	import { portalToAppFloat } from '$lib/appViewport';
	import { onDestroy, onMount } from 'svelte';
	import { fullscreen } from './fullscreenStyles';

	let {
		attachment = null,
		onClose
	}: {
		attachment?: NoteImage | null;
		onClose: () => void;
	} = $props();

	let sourceUrl = $state<string | null>(null);
	let textContent = $state<string | null>(null);
	let loading = $state(false);
	let failed = $state(false);

	const mime = $derived(attachment?.mime || 'application/octet-stream');
	const isAudio = $derived(mime.startsWith('audio/'));
	const isVideo = $derived(mime.startsWith('video/'));
	const isText = $derived(
		mime.startsWith('text/') ||
			mime === 'application/json' ||
			mime === 'application/yaml' ||
			mime === 'application/x-yaml'
	);
	const isPdf = $derived(mime === 'application/pdf');

	const portal = portalToAppFloat;
	let previewUrl: string | null = null;

	function revokePreview() {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
	}

	onMount(() => {
		const dataUrl = attachment?.dataUrl;
		const textFile = isText;
		const previewMime = mime;
		if (!dataUrl) {
			failed = true;
			return;
		}
		let current = true;
		loading = true;
		failed = false;
		sourceUrl = null;
		textContent = null;
		void dataUrlToBlob(dataUrl)
			.then(async (blob) => {
				if (textFile) {
					const text = await blob.text();
					if (current) textContent = text;
				} else if (current) {
					revokePreview();
					const typed = blob.type === previewMime ? blob : new Blob([blob], { type: previewMime });
					previewUrl = URL.createObjectURL(typed);
					sourceUrl = previewUrl;
				}
			})
			.catch(() => {
				if (current) failed = true;
			})
			.finally(() => {
				if (current) loading = false;
			});
		return () => {
			current = false;
		};
	});

	onDestroy(revokePreview);

	function close() {
		onClose();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') close();
	}

	const fs = fullscreen();

	const headerBtn = iconButton({ variant: 'ghost', size: 'standard' });

	const media = sva({
		slots: ['text', 'audioBox', 'audio', 'videoBox', 'video', 'pdf', 'backIcon', 'downloadIcon'],
		base: {
			text: {
				m: 0,
				minH: 0,
				flex: '1',
				overflow: 'auto',
				whiteSpace: 'pre-wrap',
				wordBreak: 'break-word',
				p: '1rem',
				fontFamily: 'mono',
				fontSize: 'sm',
				lineHeight: 'relaxed',
				color: 'scrapscache.text'
			},
			audioBox: { display: 'grid', flex: '1', placeItems: 'center', p: '1.5rem' },
			audio: { w: 'full', maxW: '32rem' },
			videoBox: {
				display: 'flex',
				flex: '1',
				alignItems: 'center',
				justifyContent: 'center',
				bg: 'black'
			},
			video: { maxH: 'full', maxW: 'full' },
			pdf: { h: 'full', w: 'full', flex: '1', borderWidth: 0, bg: 'white' },
			backIcon: { h: '1.5rem', w: '1.5rem' },
			downloadIcon: { h: '1.25rem', w: '1.25rem' }
		}
	});
	const ms = media();
</script>

<svelte:window onkeydown={attachment ? onKeydown : undefined} />

{#if attachment}
	<div {@attach portal}>
		<div class={fs.shell}>
			<header class={fs.header}>
				<button type="button" class={headerBtn} onclick={close} aria-label="Close file">
					<ChevronLeft class={ms.backIcon} aria-hidden="true" />
				</button>
				<div class={fs.title}>
					{attachment.name || 'Attachment'}
				</div>
				{#if attachment.dataUrl}
					<DownloadTrigger
						fileName={attachment.name || 'attachment'}
						data={attachment.dataUrl}
						mimeType={attachment.mime || 'application/octet-stream'}
						class={headerBtn}
						aria-label="Download file"
						title="Download file"
					>
						<Download class={ms.downloadIcon} aria-hidden="true" />
					</DownloadTrigger>
				{/if}
			</header>

			{#if loading}
				<div class={fs.notice}>Opening file…</div>
			{:else if failed}
				<div class={fs.notice}>Could not open this attachment.</div>
			{:else if isText}
				<pre class={`scrollable ${ms.text}`}>{textContent ?? ''}</pre>
			{:else if isAudio && sourceUrl}
				<div class={ms.audioBox}>
					<audio class={ms.audio} controls src={sourceUrl}></audio>
				</div>
			{:else if isVideo && sourceUrl}
				<!-- svelte-ignore a11y_media_has_caption -->
				<div class={ms.videoBox}>
					<video class={ms.video} controls playsinline src={sourceUrl}></video>
				</div>
			{:else if isPdf && sourceUrl}
				<iframe class={ms.pdf} title={attachment.name || 'Attachment'} src={sourceUrl}></iframe>
			{/if}
		</div>
	</div>
{/if}
