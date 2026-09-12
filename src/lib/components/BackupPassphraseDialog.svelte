<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { BackupOperation } from '$lib/backup';
	import { css, cx } from 'styled-system/css';
	import { button, dialog, input } from 'styled-system/recipes';

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

	const d = dialog({ size: 'sm', presentation: 'appOverlay' });

	const fieldLabel = css({
		display: 'block',
		mb: '0.375rem',
		fontSize: 'xs',
		fontWeight: 'medium',
		color: 'scrapscache.textMuted'
	});

	const passphraseField = cx(
		input({ variant: 'outline', size: 'md' }),
		css({ w: 'full', py: '0.625rem', fontSize: '16px' })
	);
</script>

<Dialog.Root
	open
	onOpenChange={handleOpenChange}
	closeOnEscape={!busy}
	closeOnInteractOutside={!busy}
	preventScroll={false}
	initialFocusEl={() => passphraseInput}
>
	<div {@attach portalToAppOverlay} class={d.portal} role="presentation">
		<Dialog.Backdrop class={d.backdrop} />
		<Dialog.Positioner class={d.positioner}>
			<Dialog.Content class={d.panel}>
				<div class={d.header}>
					<p
						class={css({
							fontSize: '11px',
							fontWeight: '600',
							textTransform: 'uppercase',
							letterSpacing: '0.16em',
							color: 'scrapscache.textMuted'
						})}
					>
						Encrypted on this device
					</p>
					<Dialog.Title class={d.title}>
						{exporting ? 'Protect this backup' : 'Unlock this backup'}
					</Dialog.Title>
					<Dialog.Description class={cx(d.description, css({ lineHeight: 'relaxed' }))}>
						{exporting
							? 'Scraps Cache cannot recover this passphrase. Store it separately from the backup file.'
							: 'The passphrase and decrypted notes stay in this browser.'}
					</Dialog.Description>
				</div>

				<form class={cx(d.body, css({ gap: '1rem' }))} onsubmit={submit}>
					<label class={css({ display: 'block' })}>
						<span class={fieldLabel}>Backup passphrase</span>
						<input
							type="password"
							autocomplete={exporting ? 'new-password' : 'current-password'}
							bind:value={passphrase}
							bind:this={passphraseInput}
							disabled={busy}
							class={passphraseField}
						/>
					</label>

					{#if exporting}
						<label class={css({ display: 'block' })}>
							<span class={fieldLabel}>Confirm passphrase</span>
							<input
								type="password"
								autocomplete="new-password"
								bind:value={confirmation}
								disabled={busy}
								class={passphraseField}
							/>
						</label>
					{/if}

					{#if localError || error}
						<p class={d.error} role="alert">
							{localError || error}
						</p>
					{/if}

					<div class={cx(d.footer, css({ gap: '0.5rem', pt: '0.25rem' }))}>
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
