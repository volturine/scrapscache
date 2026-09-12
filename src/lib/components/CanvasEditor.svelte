<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { css, cx, sva } from 'styled-system/css';
	import { button, iconButton } from 'styled-system/recipes';
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
		slots: [
			'shell',
			'header',
			'error',
			'reload',
			'area',
			'host',
			'loading',
			'loadingText',
			'spinnerSm',
			'spinnerMd'
		],
		base: {
			shell: {
				position: 'fixed',
				top: 'var(--app-visual-offset-top)',
				right: 0,
				bottom: 0,
				left: 0,
				paddingTop: 'var(--app-inset-top)',
				paddingRight: 'var(--app-inset-right)',
				paddingLeft: 'var(--app-inset-left)',
				zIndex: 90,
				display: 'flex',
				flexDirection: 'column',
				bg: 'scrapscache.canvasSurface',
				color: 'scrapscache.text'
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
				borderColor: 'scrapscache.danger',
				bg: 'scrapscache.dangerSubtle',
				px: '1rem',
				py: '0.5rem',
				fontSize: 'sm',
				color: 'scrapscache.danger'
			},
			reload: {
				flexShrink: 0,
				fontWeight: '600',
				textDecoration: 'underline',
				textDecorationColor: 'scrapscache.danger',
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
				bg: 'scrapscache.canvasSurface'
			},
			loadingText: {
				display: 'flex',
				alignItems: 'center',
				gap: '0.5rem',
				fontSize: 'sm',
				color: 'scrapscache.textMuted'
			},
			spinnerSm: { h: '1rem', w: '1rem', animation: 'spin' },
			spinnerMd: { h: '1.25rem', w: '1.25rem', animation: 'spin' }
		}
	});
	const ce = canvasEditor();
	const headerCloseBtn = cx(
		iconButton({ variant: 'ghost' }),
		css({
			h: '2.25rem',
			w: '2.25rem',
			color: 'color-mix(in srgb, currentColor 82%, transparent)',
			transition: 'background-color 120ms ease, color 120ms ease',
			_hoverable: {
				bg: 'color-mix(in srgb, currentColor 10%, transparent)',
				color: 'currentColor'
			},
			_focusVisible: {
				bg: 'color-mix(in srgb, currentColor 10%, transparent)',
				color: 'currentColor',
				outline: '2px solid scrapscache.focus',
				outlineOffset: '2px'
			}
		})
	);
	const doneBtn = cx(
		button({ variant: 'primary', size: 'md' }),
		css({
			rounded: 'full',
			fontWeight: '600',
			flexShrink: 0,
			touchAction: 'manipulation',
			transition: 'background-color 120ms ease, transform 120ms ease',
			'&:hover:not(:disabled)': { bg: 'scrapscache.accentHover' },
			'&:active:not(:disabled)': { transform: 'scale(0.97)' },
			_focusVisible: { outline: '2px solid scrapscache.focus', outlineOffset: '2px' },
			_disabled: { opacity: 0.5 }
		})
	);
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
			<X class={css({ h: '1.375rem', w: '1.375rem' })} aria-hidden="true" />
		</button>

		{#if !readOnly}
			<button
				type="button"
				class={`canvas-done ${doneBtn}`}
				disabled={loading || saving}
				onclick={() => void save()}
			>
				{#if saving}
					<LoaderCircle class={ce.spinnerSm} aria-hidden="true" />
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
					<LoaderCircle class={ce.spinnerMd} aria-hidden="true" />
					Loading canvas…
				</div>
			</div>
		{/if}
	</div>
</div>
