<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { BackupImportMode } from '$lib/backup';
	import { cx, sva } from 'styled-system/css';
	import { button, dialog } from 'styled-system/recipes';

	let {
		busy = false,
		error = '',
		onSelect,
		onClose
	}: {
		busy?: boolean;
		error?: string;
		onSelect: (mode: BackupImportMode) => void | Promise<void>;
		onClose: () => void;
	} = $props();

	let keepButton: HTMLButtonElement | null = $state(null);

	function handleOpenChange(details: { open: boolean }) {
		if (!details.open && !busy) onClose();
	}

	const d = dialog({ size: 'sm', presentation: 'appOverlay' });

	const option = sva({
		slots: ['root', 'title', 'description', 'footer'],
		base: {
			root: {
				w: 'full',
				px: '1rem',
				py: '0.75rem',
				textAlign: 'left',
				rounded: 'md',
				borderWidth: '1px',
				borderColor: 'scrapscache.border',
				bg: 'transparent',
				cursor: 'pointer',
				transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
				_hoverable: {
					bg: 'scrapscache.interactiveHover'
				}
			},
			title: {
				display: 'block',
				fontWeight: 'medium',
				color: 'scrapscache.text'
			},
			description: {
				display: 'block',
				mt: '0.25rem',
				fontSize: 'xs',
				color: 'scrapscache.textMuted'
			},
			footer: { pt: '0.25rem' }
		},
		variants: {
			danger: {
				true: {
					title: {
						color: 'scrapscache.danger'
					}
				}
			}
		}
	});
	const keepOption = option();
	const replaceOption = option({ danger: true });
</script>

<Dialog.Root
	open
	onOpenChange={handleOpenChange}
	closeOnEscape={!busy}
	closeOnInteractOutside={!busy}
	preventScroll={false}
	initialFocusEl={() => keepButton}
>
	<div {@attach portalToAppOverlay} class={d.portal} role="presentation">
		<Dialog.Backdrop class={d.backdrop} />
		<Dialog.Positioner class={d.positioner}>
			<Dialog.Content class={d.panel}>
				<div class={d.header}>
					<Dialog.Title class={d.title}>How should this backup be imported?</Dialog.Title>
				</div>

				<div class={d.body}>
					<button
						bind:this={keepButton}
						type="button"
						disabled={busy}
						onclick={() => onSelect(BackupImportMode.Keep)}
						class={keepOption.root}
					>
						<span class={keepOption.title}>Keep local notes</span>
						<span class={keepOption.description}>
							Add every backup note as a new copy. Existing notes stay unchanged.
						</span>
					</button>
					<button
						type="button"
						disabled={busy}
						onclick={() => onSelect(BackupImportMode.Replace)}
						class={replaceOption.root}
					>
						<span class={replaceOption.title}>Replace local data</span>
						<span class={replaceOption.description}>
							Delete current local notes and restore the backup instead.
						</span>
					</button>
					{#if error}
						<p class={d.error} role="alert">
							{error}
						</p>
					{/if}
					<div class={cx(d.footer, keepOption.footer)}>
						<button
							type="button"
							disabled={busy}
							onclick={onClose}
							class={button({ variant: 'quiet', size: 'md' })}>Cancel</button
						>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
