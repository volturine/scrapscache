<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { BackupImportMode } from '$lib/backup';
	import { css, cx } from 'styled-system/css';
	import { button, dialog } from 'styled-system/recipes';
	import { flex } from 'styled-system/patterns';

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

	const d = dialog({ size: 'sm' });

	const shell = {
		backdrop: cx(d.backdrop, css({ position: 'absolute', bg: 'black/45', backdropFilter: 'none' })),
		positioner: flex({
			position: 'absolute',
			inset: 0,
			align: 'flex-start',
			justify: 'center',
			px: '1rem',
			pb: '1rem',
			pt: 'calc(var(--app-topbar-height) + 0.5rem)'
		}),
		panel: cx('scrapscache-dialog', d.panel, css({ maxW: '24rem', p: 0, gap: 0 })),
		header: cx(
			d.header,
			css({
				borderBottomWidth: '1px',
				borderColor: 'scrapscache.border',
				px: '1.25rem',
				py: '1rem'
			})
		),
		body: cx(d.body, css({ px: '1.25rem', py: '1.25rem' }))
	};

	const optionBtn = css({
		w: 'full',
		px: '1rem',
		py: '0.75rem',
		textAlign: 'left',
		rounded: 'md',
		borderWidth: '1px',
		borderColor: 'scrapscache.border',
		bg: 'transparent',
		cursor: 'pointer',
		transition: 'all 120ms ease',
		_hover: {
			bg: 'scrapscache.interactiveHover'
		}
	});

	const optionTitle = (danger: boolean) =>
		css({
			display: 'block',
			fontWeight: 'medium',
			color: danger ? 'scrapscache.danger' : 'scrapscache.text'
		});

	const optionDesc = css({
		display: 'block',
		mt: '0.25rem',
		fontSize: 'xs',
		color: 'scrapscache.textMuted'
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
	<div
		{@attach portalToAppOverlay}
		class={css({ position: 'absolute', inset: 0, zIndex: 70 })}
		role="presentation"
	>
		<Dialog.Backdrop class={shell.backdrop} />
		<Dialog.Positioner class={shell.positioner}>
			<Dialog.Content class={shell.panel}>
				<div class={shell.header}>
					<Dialog.Title class={d.title}>How should this backup be imported?</Dialog.Title>
				</div>

				<div class={shell.body}>
					<button
						bind:this={keepButton}
						type="button"
						disabled={busy}
						onclick={() => onSelect(BackupImportMode.Keep)}
						class={optionBtn}
					>
						<span class={optionTitle(false)}>Keep local notes</span>
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
						<span class={optionTitle(true)}>Replace local data</span>
						<span class={optionDesc}>
							Delete current local notes and restore the backup instead.
						</span>
					</button>
					{#if error}
						<p class={css({ fontSize: 'sm', color: 'scrapscache.danger' })} role="alert">
							{error}
						</p>
					{/if}
					<div class={cx(d.footer, css({ pt: '0.25rem' }))}>
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
