<script lang="ts">
	import { backupStyles } from '$panda/styles';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { BackupOperation } from '$lib/backup';
	import { css, cx } from 'styled-system/css';
	import { button, dialog, input } from 'styled-system/recipes';

	let {
		open = true,
		mode,
		busy = false,
		error = '',
		onSubmit,
		onClose
	}: {
		open?: boolean;
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
	const passphraseField = cx(
		input({ variant: 'outline', size: 'md' }),
		css({ w: 'full', py: 'list', fontSize: 'subtitle' })
	);
</script>

<Dialog.Root
	{open}
	onOpenChange={handleOpenChange}
	closeOnEscape={!busy}
	closeOnInteractOutside={!busy}
	preventScroll={false}
	initialFocusEl={() => passphraseInput}
	lazyMount
	unmountOnExit
>
	{#if open}
		<div {@attach portalToAppOverlay} class={d.portal} role="presentation">
			<Dialog.Backdrop class={d.backdrop} />
			<Dialog.Positioner class={d.positioner}>
				<Dialog.Content class={d.panel}>
					<div class={d.header}>
						<p class={backupStyles.eyebrow}>Encrypted on this device</p>
						<Dialog.Title class={d.title}>
							{exporting ? 'Protect this backup' : 'Unlock this backup'}
						</Dialog.Title>
						<Dialog.Description class={cx(d.description, backupStyles.description)}>
							{exporting
								? 'Scraps Cache cannot recover this passphrase. Store it separately from the backup file.'
								: 'The passphrase and decrypted notes stay in this browser.'}
						</Dialog.Description>
					</div>

					<form class={cx(d.body, backupStyles.form)} onsubmit={submit}>
						<label class={backupStyles.label}>
							<span class={backupStyles.fieldLabel}> Backup passphrase </span>
							<input
								type="password"
								autocomplete={exporting ? 'new-password' : 'current-password'}
								bind:value={passphrase}
								bind:this={passphraseInput}
								disabled={busy}
								aria-invalid={Boolean(localError || error)}
								class={passphraseField}
							/>
						</label>

						{#if exporting}
							<label class={backupStyles.label}>
								<span class={backupStyles.fieldLabel}> Confirm passphrase </span>
								<input
									type="password"
									autocomplete="new-password"
									bind:value={confirmation}
									disabled={busy}
									aria-invalid={Boolean(localError || error)}
									class={passphraseField}
								/>
							</label>
						{/if}

						{#if localError || error}
							<p class={d.error} role="alert">
								{localError || error}
							</p>
						{/if}

						<div class={cx(d.footer, backupStyles.footer)}>
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
	{/if}
</Dialog.Root>
