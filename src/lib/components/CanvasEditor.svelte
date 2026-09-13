<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { css, cx } from 'styled-system/css';
	import { button, iconButton } from 'styled-system/recipes';
	import { center, hstack } from 'styled-system/patterns';
	import { LoaderCircle, X } from '@lucide/svelte';
	import {
		createCanvasAttachment,
		decodeCanvasAttachment,
		type CanvasScene
	} from '$lib/canvasAttachment';
	import type { ExcalidrawHost } from '$lib/excalidrawHost';
	import { isMissingModuleError, reloadOnceForMissingModule } from '$lib/staleModuleReload';
	import type { NoteImage } from '$lib/types';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { portalToAppOverlay } from '$lib/appViewport';

	let {
		attachment = null,
		readOnly = false,
		onSave,
		onClose
	}: {
		attachment?: NoteImage | null;
		readOnly?: boolean;
		onSave?: (attachment: NoteImage, sourceHash?: string) => void | Promise<void>;
		onClose: () => void;
	} = $props();

	let hostNode = $state<HTMLDivElement | null>(null);
	let host: ExcalidrawHost | null = null;
	let loading = $state(true);
	let saving = $state(false);
	let dirty = $state(false);
	let error = $state('');
	let staleModule = $state(false);
	let sourceHash: string | undefined;

	onMount(() => {
		let cancelled = false;
		sourceHash = attachment?.contentHash;
		void (async () => {
			try {
				let initialScene: CanvasScene | undefined;
				if (attachment) initialScene = await decodeCanvasAttachment(attachment);
				if (cancelled || !hostNode) return;
				(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/';
				const { mountExcalidraw } = await import('$lib/excalidrawHost');
				if (cancelled || !hostNode) return;
				const mounted = await mountExcalidraw(hostNode, {
					initialScene,
					dark: uiStore.effectiveDark,
					readOnly
				});
				if (cancelled) {
					mounted.destroy();
					return;
				}
				host = mounted;
			} catch (cause) {
				if (reloadOnceForMissingModule(cause)) return;
				staleModule = isMissingModuleError(cause);
				error = staleModule
					? 'Could not load the canvas editor. Reload the page and try again.'
					: cause instanceof Error
						? cause.message
						: 'Could not open this canvas.';
			} finally {
				if (!cancelled) loading = false;
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	onDestroy(() => host?.destroy());

	function close() {
		if (saving) return;
		if (dirty && !confirm('Discard your unsaved canvas changes?')) return;
		onClose();
	}

	function markCanvasInteraction(event: Event) {
		if (readOnly) return;
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest('.scrapscache-canvas')) dirty = true;
	}

	async function save() {
		if (!host || saving || readOnly) return;
		error = '';
		saving = true;
		try {
			const preview = await host.thumbnail();
			const saved = await createCanvasAttachment(
				host.snapshot(),
				preview.dataUrl,
				attachment ?? undefined
			);
			await onSave?.({ ...saved, width: preview.width, height: preview.height }, sourceHash);
			dirty = false;
			onClose();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not save this canvas.';
		} finally {
			saving = false;
		}
	}

	const shell = css({
		position: 'absolute',
		inset: 0,
		zIndex: 90,
		display: 'flex',
		flexDirection: 'column',
		bg: 'scrapscache.canvasSurface',
		color: 'scrapscache.text'
	});
	const header = hstack({
		position: 'relative',
		zIndex: 10,
		h: '3rem',
		flexShrink: 0,
		justify: 'space-between',
		px: 'md'
	});
	const errorBar = hstack({
		position: 'relative',
		zIndex: 10,
		gap: 'md',
		justify: 'space-between',
		borderBottomWidth: 'hairline',
		borderColor: 'scrapscache.danger',
		bg: 'scrapscache.dangerSubtle',
		px: 'lg',
		py: 'sm',
		textStyle: 'body',
		color: 'scrapscache.danger'
	});
	const reload = css({
		flexShrink: 0,
		fontWeight: 'heading',
		textDecoration: 'underline',
		textDecorationColor: 'scrapscache.danger',
		textUnderlineOffset: '2px',
		cursor: 'pointer'
	});
	const area = css({ position: 'relative', minH: 0, flex: '1' });
	const hostClass = css({ position: 'absolute', inset: 0 });
	const loadingClass = center({
		position: 'absolute',
		inset: 0,
		zIndex: 20,
		bg: 'scrapscache.canvasSurface'
	});
	const loadingText = hstack({ gap: 'sm', textStyle: 'body', color: 'scrapscache.textMuted' });
	const spinnerSm = css({ h: '1rem', w: '1rem', animation: 'spin' });
	const spinnerMd = css({ h: '1.25rem', w: '1.25rem', animation: 'spin' });
	const headerCloseBtn = iconButton({ variant: 'ghost', size: 'sm' });
	const doneBtn = cx(
		button({ variant: 'primary', size: 'md' }),
		css({ rounded: 'pill', fontWeight: 'heading', flexShrink: 0 })
	);
	const closeIcon = css({ h: '1.375rem', w: '1.375rem' });
</script>

<div
	{@attach portalToAppOverlay}
	onpointerdown={markCanvasInteraction}
	onkeydown={markCanvasInteraction}
	onpaste={markCanvasInteraction}
	ondrop={markCanvasInteraction}
	onwheel={markCanvasInteraction}
	class={`canvas-editor-shell ${shell}`}
	role="dialog"
	tabindex="-1"
	aria-modal="true"
	aria-label={readOnly ? 'View canvas' : attachment ? 'Edit canvas' : 'New canvas'}
>
	<header class={header}>
		<button
			type="button"
			class={`canvas-header-action ${headerCloseBtn}`}
			onclick={close}
			aria-label={readOnly ? 'Close canvas' : 'Cancel canvas editing'}
		>
			<X class={closeIcon} aria-hidden="true" />
		</button>

		{#if !readOnly}
			<button
				type="button"
				class={`canvas-done ${doneBtn}`}
				disabled={loading || saving}
				onclick={() => void save()}
			>
				{#if saving}
					<LoaderCircle class={spinnerSm} aria-hidden="true" />
				{/if}
				<span>{saving ? 'Saving' : 'Done'}</span>
			</button>
		{/if}
	</header>

	{#if error}
		<div class={errorBar}>
			<span>{error}</span>
			{#if staleModule}
				<button type="button" class={reload} onclick={() => location.reload()}> Reload </button>
			{/if}
		</div>
	{/if}

	<div class={area}>
		<div bind:this={hostNode} class={`scrapscache-canvas ${hostClass}`}></div>
		{#if loading}
			<div class={loadingClass}>
				<div class={loadingText}>
					<LoaderCircle class={spinnerMd} aria-hidden="true" />
					Loading canvas…
				</div>
			</div>
		{/if}
	</div>
</div>
