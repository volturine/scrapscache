<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { css, sva } from 'styled-system/css';
	import { button, iconButton } from 'styled-system/recipes';
	import { cx } from 'styled-system/css';
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

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	const canvasEditor = sva({
		slots: ['shell', 'header', 'error', 'reload', 'area', 'host', 'loading', 'loadingText'],
		base: {
			shell: {
				position: 'fixed',
				zIndex: 90,
				display: 'flex',
				flexDirection: 'column',
				bg: { base: 'white', _dark: '#121212' },
				color: { base: 'slate.900', _dark: 'slate.100' }
			},
			header: {
				position: 'relative',
				zIndex: 10,
				display: 'flex',
				h: '3rem',
				flexShrink: 0,
				alignItems: 'center',
				justifyContent: 'space-between',
				px: '0.75rem'
			},
			error: {
				position: 'relative',
				zIndex: 10,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				gap: '0.75rem',
				borderBottomWidth: '1px',
				borderColor: { base: 'red.200', _dark: 'red.900' },
				bg: { base: 'red.50', _dark: 'red.950' },
				px: '1rem',
				py: '0.5rem',
				fontSize: 'sm',
				color: { base: 'red.700', _dark: 'red.200' }
			},
			reload: {
				flexShrink: 0,
				fontWeight: '600',
				textDecoration: 'underline',
				textDecorationColor: { base: 'red.700/50', _dark: 'red.200/50' },
				textUnderlineOffset: '2px',
				cursor: 'pointer'
			},
			area: { position: 'relative', minH: 0, flex: '1' },
			host: { position: 'absolute', inset: 0 },
			loading: {
				position: 'absolute',
				inset: 0,
				zIndex: 20,
				display: 'grid',
				placeItems: 'center',
				bg: { base: 'white', _dark: '#121212' }
			},
			loadingText: {
				display: 'flex',
				alignItems: 'center',
				gap: '0.5rem',
				fontSize: 'sm',
				color: { base: 'slate.500', _dark: 'slate.400' }
			}
		}
	});
	const ce = canvasEditor();
	const headerCloseBtn = cx(iconButton({ variant: 'ghost' }), css({ h: '2.25rem', w: '2.25rem' }));
	const doneBtn = cx(
		button({ variant: 'primary', size: 'md' }),
		css({
			rounded: 'full',
			fontWeight: '600',
			flexShrink: 0,
			touchAction: 'manipulation'
		})
	);
	const spinnerSm = css({ h: '1rem', w: '1rem' });
	const spinnerMd = css({ h: '1.25rem', w: '1.25rem' });
	const iconClose = css({ h: '1.375rem', w: '1.375rem' });
</script>

<div
	use:portal
	onpointerdown={markCanvasInteraction}
	onkeydown={markCanvasInteraction}
	onpaste={markCanvasInteraction}
	ondrop={markCanvasInteraction}
	onwheel={markCanvasInteraction}
	class={`canvas-editor-shell ${ce.shell}`}
	role="dialog"
	tabindex="-1"
	aria-modal="true"
	aria-label={readOnly ? 'View canvas' : attachment ? 'Edit canvas' : 'New canvas'}
>
	<header class={ce.header}>
		<button
			type="button"
			class={`canvas-header-action ${headerCloseBtn}`}
			onclick={close}
			aria-label={readOnly ? 'Close canvas' : 'Cancel canvas editing'}
		>
			<X class={iconClose} aria-hidden="true" />
		</button>

		{#if !readOnly}
			<button
				type="button"
				class={`canvas-done ${doneBtn}`}
				disabled={loading || saving}
				onclick={() => void save()}
			>
				{#if saving}
					<LoaderCircle class={`animate-spin ${spinnerSm}`} aria-hidden="true" />
				{/if}
				<span>{saving ? 'Saving' : 'Done'}</span>
			</button>
		{/if}
	</header>

	{#if error}
		<div class={ce.error}>
			<span>{error}</span>
			{#if staleModule}
				<button type="button" class={ce.reload} onclick={() => location.reload()}> Reload </button>
			{/if}
		</div>
	{/if}

	<div class={ce.area}>
		<div bind:this={hostNode} class={`scrapscache-canvas ${ce.host}`}></div>
		{#if loading}
			<div class={ce.loading}>
				<div class={ce.loadingText}>
					<LoaderCircle class={`animate-spin ${spinnerMd}`} aria-hidden="true" />
					Loading canvas…
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.canvas-editor-shell {
		top: var(--app-visual-offset-top);
		right: 0;
		bottom: 0;
		left: 0;
		padding-top: var(--app-inset-top);
		padding-right: var(--app-inset-right);
		padding-left: var(--app-inset-left);
	}

	.canvas-header-action {
		color: color-mix(in srgb, currentColor 82%, transparent);
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.canvas-header-action:hover,
	.canvas-header-action:focus-visible {
		background: color-mix(in srgb, currentColor 10%, transparent);
		color: currentColor;
		outline: 2px solid var(--scrapscache-focus);
		outline-offset: 2px;
	}

	.canvas-done {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		background: var(--scrapscache-accent);
		color: var(--scrapscache-accent-foreground);
		transition:
			background-color 120ms ease,
			transform 120ms ease;
	}

	.canvas-done:hover:not(:disabled) {
		background: var(--scrapscache-accent-hover);
	}

	.canvas-done:active:not(:disabled) {
		transform: scale(0.97);
	}

	.canvas-done:focus-visible {
		outline: 2px solid var(--scrapscache-focus);
		outline-offset: 2px;
	}

	.canvas-done:disabled {
		opacity: 0.5;
	}

	:global(.scrapscache-canvas .excalidraw) {
		--sat: 0px;
		--sar: 0px;
		--sab: var(--app-inset-bottom);
		--sal: 0px;
	}

	:global(.scrapscache-canvas .App-bottom-bar .App-toolbar-content) {
		padding: 4px 8px !important;
	}

	:global(.scrapscache-canvas .App-bottom-bar .dropdown-menu--mobile) {
		bottom: 47px !important;
	}

	:global(.excalidraw-modal-container) {
		top: calc(var(--app-visual-offset-top) + var(--app-inset-top)) !important;
		right: var(--app-inset-right) !important;
		bottom: var(--app-inset-bottom) !important;
		left: var(--app-inset-left) !important;
		height: auto !important;
	}

	:global(.excalidraw-modal-container .Modal__background) {
		top: calc(var(--app-visual-offset-top) + var(--app-inset-top)) !important;
		right: var(--app-inset-right) !important;
		bottom: var(--app-inset-bottom) !important;
		left: var(--app-inset-left) !important;
	}

	:global(.excalidraw-modal-container .confirm-dialog.Modal) {
		align-items: center;
		padding: 1rem;
	}

	:global(.excalidraw-modal-container .confirm-dialog.Dialog--fullscreen .Modal__content) {
		position: relative;
		inset: auto;
		max-width: 34rem;
		max-height: 100%;
	}
</style>
