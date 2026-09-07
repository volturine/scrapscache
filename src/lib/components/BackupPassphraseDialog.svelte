<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { BackupOperation } from '$lib/backup';

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
</script>

<Dialog.Root
	open
	onOpenChange={handleOpenChange}
	closeOnEscape={!busy}
	closeOnInteractOutside={!busy}
	preventScroll={false}
	initialFocusEl={() => passphraseInput}
>
	<div {@attach portalToAppOverlay} class="absolute inset-0 z-[70]" role="presentation">
		<Dialog.Backdrop class="absolute inset-0 bg-black/45" />
		<Dialog.Positioner
			class="absolute inset-0 flex items-start justify-center px-4 pb-4 pt-[calc(var(--app-topbar-height)+0.5rem)]"
		>
			<Dialog.Content class="scrapscache-dialog w-full max-w-sm">
				<div class="border-b border-[var(--scrapscache-border)] px-5 py-4">
					<p
						class="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--scrapscache-text-muted)]"
					>
						Encrypted on this device
					</p>
					<Dialog.Title class="text-lg font-semibold text-[var(--scrapscache-text)]">
						{exporting ? 'Protect this backup' : 'Unlock this backup'}
					</Dialog.Title>
					<Dialog.Description
						class="mt-1 text-sm leading-relaxed text-[var(--scrapscache-text-muted)]"
					>
						{exporting
							? 'Scraps Cache cannot recover this passphrase. Store it separately from the backup file.'
							: 'The passphrase and decrypted notes stay in this browser.'}
					</Dialog.Description>
				</div>

				<form class="space-y-4 px-5 py-5" onsubmit={submit}>
					<label class="block">
						<span class="mb-1.5 block text-xs font-medium text-[var(--scrapscache-text-muted)]"
							>Backup passphrase</span
						>
						<input
							type="password"
							autocomplete={exporting ? 'new-password' : 'current-password'}
							bind:value={passphrase}
							bind:this={passphraseInput}
							disabled={busy}
							class="scrapscache-input w-full px-3 py-2.5 text-[16px]"
						/>
					</label>

					{#if exporting}
						<label class="block">
							<span class="mb-1.5 block text-xs font-medium text-[var(--scrapscache-text-muted)]"
								>Confirm passphrase</span
							>
							<input
								type="password"
								autocomplete="new-password"
								bind:value={confirmation}
								disabled={busy}
								class="scrapscache-input w-full px-3 py-2.5 text-[16px]"
							/>
						</label>
					{/if}

					{#if localError || error}
						<p class="text-sm text-[var(--scrapscache-danger)]" role="alert">
							{localError || error}
						</p>
					{/if}

					<div class="flex justify-end gap-2 pt-1">
						<button
							type="button"
							onclick={onClose}
							disabled={busy}
							class="scrapscache-button scrapscache-button-quiet px-3 py-2 text-sm">Cancel</button
						>
						<button
							type="submit"
							disabled={busy}
							class="scrapscache-button scrapscache-button-primary px-4 py-2 text-sm font-medium"
							>{busy
								? exporting
									? 'Encrypting…'
									: 'Decrypting…'
								: exporting
									? 'Download backup'
									: 'Unlock backup'}</button
						>
					</div>
				</form>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
