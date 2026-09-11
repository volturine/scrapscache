<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { BackupImportMode } from '$lib/backup';
	import { css } from 'styled-system/css';
	import { button } from 'styled-system/recipes';

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

	const overlayWrap = css({
		position: 'absolute',
		inset: 0,
		zIndex: 70
	});

	const backdropClass = css({
		position: 'absolute',
		inset: 0,
		bg: 'black/45'
	});

	const positionerClass = css({
		position: 'absolute',
		inset: 0,
		display: 'flex',
		alignItems: 'flex-start',
		justifyContent: 'center',
		px: '1rem',
		pb: '1rem',
		pt: 'calc(var(--app-topbar-height) + 0.5rem)'
	});

	const contentClass = css({
		w: 'full',
		maxW: '24rem'
	});

	const headerClass = css({
		borderBottomWidth: '1px',
		borderColor: 'scrapscache.border',
		px: '1.25rem',
		py: '1rem'
	});

	const titleClass = css({
		fontSize: 'lg',
		fontWeight: '600',
		color: 'scrapscache.text'
	});

	const bodyClass = css({
		display: 'flex',
		flexDirection: 'column',
		gap: '0.75rem',
		px: '1.25rem',
		py: '1.25rem'
	});

	const optionBtn = css({
		w: 'full',
		px: '1rem',
		py: '0.75rem',
		textAlign: 'left',
		rounded: 'md',
		borderWidth: '1px',
		borderColor: 'scrapscache.border',
		cursor: 'pointer',
		transition: 'all 120ms ease',
		_hover: {
			bg: 'scrapscache.interactiveHover'
		}
	});

	const optionTitle = css({
		display: 'block',
		fontWeight: 'medium',
		color: 'scrapscache.text'
	});

	const optionTitleDanger = css({
		display: 'block',
		fontWeight: 'medium',
		color: 'scrapscache.danger'
	});

	const optionDesc = css({
		mt: '0.25rem',
		display: 'block',
		fontSize: 'xs',
		color: 'scrapscache.textMuted'
	});

	const errorClass = css({
		fontSize: 'sm',
		color: 'scrapscache.danger'
	});

	const footerClass = css({
		display: 'flex',
		justifyContent: 'flex-end',
		pt: '0.25rem'
	});
</script>

<Dialog.Root
	open
	onOpenChange={handleOpenChange}
	closeOnEscape={!busy}
	closeOnInteractOutside={!busy}
	preventScroll={false}
	initialFocusEl={() => keepButton}
>
	<div {@attach portalToAppOverlay} class={overlayWrap} role="presentation">
		<Dialog.Backdrop class={backdropClass} />
		<Dialog.Positioner class={positionerClass}>
			<Dialog.Content class={`scrapscache-dialog ${contentClass}`}>
				<div class={headerClass}>
					<Dialog.Title class={titleClass}>How should this backup be imported?</Dialog.Title>
				</div>

				<div class={bodyClass}>
					<button
						bind:this={keepButton}
						type="button"
						disabled={busy}
						onclick={() => onSelect(BackupImportMode.Keep)}
						class={optionBtn}
					>
						<span class={optionTitle}>Keep local notes</span>
						<span class={optionDesc}>
							Add every backup note as a new copy. Existing notes stay unchanged.
						</span>
					</button>
					<button
						type="button"
						disabled={busy}
						onclick={() => onSelect(BackupImportMode.Replace)}
						class={optionBtn}
					>
						<span class={optionTitleDanger}>Replace local data</span>
						<span class={optionDesc}>
							Delete current local notes and restore the backup instead.
						</span>
					</button>
					{#if error}
						<p class={errorClass} role="alert">
							{error}
						</p>
					{/if}
					<div class={footerClass}>
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
