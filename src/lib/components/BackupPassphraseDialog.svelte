<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { BackupOperation } from '$lib/backup';
	import { css } from 'styled-system/css';
	import { button } from 'styled-system/recipes';

	let {
		mode,
		busy = false,
		error = '',
		onSubmit,
		onClose
	}: {
		mode: BackupOperation;
		busy?: boolean;
		error?: string;
		onSubmit: (passphrase: string) => void | Promise<void>;
		onClose: () => void;
	} = $props();

	let passphrase = $state('');
	let confirmation = $state('');
	let localError = $state('');
	let passphraseInput: HTMLInputElement | null = $state(null);
	const exporting = $derived(mode === BackupOperation.Export);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		localError = '';
		if (passphrase.length < 12) {
			localError = 'Use at least 12 characters.';
			return;
		}
		if (exporting && passphrase !== confirmation) {
			localError = 'The passphrases do not match.';
			return;
		}
		void onSubmit(passphrase);
	}

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

	const subheaderClass = css({
		mb: '0.25rem',
		fontSize: '11px',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.16em',
		color: 'scrapscache.textMuted'
	});

	const titleClass = css({
		fontSize: 'lg',
		fontWeight: '600',
		color: 'scrapscache.text'
	});

	const descClass = css({
		mt: '0.25rem',
		fontSize: 'sm',
		lineHeight: 'relaxed',
		color: 'scrapscache.textMuted'
	});

	const formClass = css({
		display: 'flex',
		flexDirection: 'column',
		gap: '1rem',
		px: '1.25rem',
		py: '1.25rem'
	});

	const labelSpanClass = css({
		mb: '0.375rem',
		display: 'block',
		fontSize: 'xs',
		fontWeight: 'medium',
		color: 'scrapscache.textMuted'
	});

	const inputClass = css({
		w: 'full',
		px: '0.75rem',
		py: '0.625rem',
		fontSize: '16px'
	});

	const errorClass = css({
		fontSize: 'sm',
		color: 'scrapscache.danger'
	});

	const actionsRow = css({
		display: 'flex',
		justifyContent: 'flex-end',
		gap: '0.5rem',
		pt: '0.25rem'
	});
</script>

<Dialog.Root
	open
	onOpenChange={handleOpenChange}
	closeOnEscape={!busy}
	closeOnInteractOutside={!busy}
	preventScroll={false}
	initialFocusEl={() => passphraseInput}
>
	<div {@attach portalToAppOverlay} class={`absolute ${overlayWrap}`} role="presentation">
		<Dialog.Backdrop class={backdropClass} />
		<Dialog.Positioner class={positionerClass}>
			<Dialog.Content class={`scrapscache-dialog ${contentClass}`}>
				<div class={headerClass}>
					<p class={subheaderClass}>Encrypted on this device</p>
					<Dialog.Title class={titleClass}>
						{exporting ? 'Protect this backup' : 'Unlock this backup'}
					</Dialog.Title>
					<Dialog.Description class={descClass}>
						{exporting
							? 'Scraps Cache cannot recover this passphrase. Store it separately from the backup file.'
							: 'The passphrase and decrypted notes stay in this browser.'}
					</Dialog.Description>
				</div>

				<form class={formClass} onsubmit={submit}>
					<label class={css({ display: 'block' })}>
						<span class={labelSpanClass}>Backup passphrase</span>
						<input
							type="password"
							autocomplete={exporting ? 'new-password' : 'current-password'}
							bind:value={passphrase}
							bind:this={passphraseInput}
							disabled={busy}
							class={`scrapscache-input ${inputClass}`}
						/>
					</label>

					{#if exporting}
						<label class={css({ display: 'block' })}>
							<span class={labelSpanClass}>Confirm passphrase</span>
							<input
								type="password"
								autocomplete="new-password"
								bind:value={confirmation}
								disabled={busy}
								class={`scrapscache-input ${inputClass}`}
							/>
						</label>
					{/if}

					{#if localError || error}
						<p class={errorClass} role="alert">
							{localError || error}
						</p>
					{/if}

					<div class={actionsRow}>
						<button
							type="button"
							onclick={onClose}
							disabled={busy}
							class={button({ variant: 'quiet', size: 'md' })}>Cancel</button
						>
						<button
							type="submit"
							disabled={busy}
							class={button({ variant: 'primary', size: 'md' })}
						>
							{exporting ? 'Export backup' : 'Unlock and import'}
						</button>
					</div>
				</form>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
