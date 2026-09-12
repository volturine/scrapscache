<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { BackupOperation } from '$lib/backup';
	import { cx, sva } from 'styled-system/css';
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

	const backupDialog = sva({
		slots: ['eyebrow', 'description', 'form', 'label', 'fieldLabel', 'field', 'footer'],
		base: {
			eyebrow: {
				fontSize: '11px',
				fontWeight: '600',
				textTransform: 'uppercase',
				letterSpacing: '0.16em',
				color: 'scrapscache.textMuted'
			},
			description: { lineHeight: 'relaxed' },
			form: { gap: '1rem' },
			label: { display: 'block' },
			fieldLabel: {
				display: 'block',
				mb: '0.375rem',
				fontSize: 'xs',
				fontWeight: 'medium',
				color: 'scrapscache.textMuted'
			},
			field: { w: 'full', py: '0.625rem', fontSize: '16px' },
			footer: { gap: '0.5rem', pt: '0.25rem' }
		}
	});
	const styles = backupDialog();
	const passphraseField = cx(input({ variant: 'outline', size: 'md' }), styles.field);
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
					<p class={styles.eyebrow}>Encrypted on this device</p>
					<Dialog.Title class={d.title}>
						{exporting ? 'Protect this backup' : 'Unlock this backup'}
					</Dialog.Title>
					<Dialog.Description class={cx(d.description, styles.description)}>
						{exporting
							? 'Scraps Cache cannot recover this passphrase. Store it separately from the backup file.'
							: 'The passphrase and decrypted notes stay in this browser.'}
					</Dialog.Description>
				</div>

				<form class={cx(d.body, styles.form)} onsubmit={submit}>
					<label class={styles.label}>
						<span class={styles.fieldLabel}>Backup passphrase</span>
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
						<label class={styles.label}>
							<span class={styles.fieldLabel}>Confirm passphrase</span>
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

					<div class={cx(d.footer, styles.footer)}>
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
