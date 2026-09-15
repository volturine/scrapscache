<script lang="ts">
	import { importGuideStyles as styles } from '$panda/styles';
	import { css } from 'styled-system/css';
	import { button, dialog } from 'styled-system/recipes';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { ArchiveRestore, FileArchive } from '@lucide/svelte';
	import type { BackupImportMode } from '$lib/backup';
	import ImportModeChoices from './ImportModeChoices.svelte';

	let {
		busy = false,
		error = '',
		keepReady = false,
		onFile,
		onSelectMode,
		onClose
	}: {
		busy?: boolean;
		error?: string;
		keepReady?: boolean;
		onFile: (file: File) => void | Promise<void>;
		onSelectMode: (mode: BackupImportMode) => void | Promise<void>;
		onClose: () => void;
	} = $props();

	let fileInput: HTMLInputElement | null = $state(null);
	let pickingFile = $state(false);
	const d = dialog({ presentation: 'appOverlay' });
	const cancelButton = button({ variant: 'quiet', size: 'sm' });
	const chooseButton = button({ variant: 'primary', size: 'sm' });

	function handleOpenChange(details: { open: boolean }) {
		if (!details.open && !busy && !pickingFile) onClose();
	}

	function chooseFile() {
		if (busy) return;
		pickingFile = true;
		fileInput?.click();
	}

	function handleFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) {
			pickingFile = false;
			return;
		}
		void Promise.resolve(onFile(file)).finally(() => {
			pickingFile = false;
		});
	}

	function handleFileCancel() {
		pickingFile = false;
	}
</script>

<Dialog.Root
	open
	onOpenChange={handleOpenChange}
	closeOnEscape={!busy && !pickingFile}
	closeOnInteractOutside={false}
	preventScroll={false}
>
	<div {@attach portalToAppOverlay} class={d.portal} role="presentation">
		<Dialog.Backdrop class={d.backdrop} />
		<Dialog.Positioner class={d.positioner}>
			<Dialog.Content class={d.panel}>
				<div class={d.header}>
					<Dialog.Title class={d.title}>Import notes</Dialog.Title>
					<Dialog.Description class={d.description}>
						{keepReady
							? 'Your Keep export is ready. Choose how to add it to the workspace that is open now.'
							: 'The file is read in this browser and added to the workspace that is open now. Nothing is uploaded.'}
					</Dialog.Description>
				</div>

				<div class={d.body}>
					{#if keepReady}
						<ImportModeChoices {busy} keepImport onSelect={onSelectMode} />
					{:else}
						<section class={styles.source}>
							<h3 class={styles.sourceTitle}>
								<span class={styles.sourceIcon} aria-hidden="true"><FileArchive size={16} /></span>
								Google Keep
							</h3>
							<ol class={styles.steps}>
								<li class={styles.step}>
									<span
										>Open
										<a
											href="https://takeout.google.com"
											target="_blank"
											rel="noreferrer"
											class={css({ textDecoration: 'underline', textUnderlineOffset: '2px' })}
											>takeout.google.com</a
										></span
									>
								</li>
								<li class={styles.step}>Deselect all, then select only Keep</li>
								<li class={styles.step}>Create the export and download the zip</li>
								<li class={styles.step}>Choose that zip below</li>
							</ol>
							<p class={styles.note}>
								<strong class={styles.noteStrong}>Imported:</strong> titles, text, checklists, colors,
								pins, archive, trash, labels, photos, and saved links, with original created and edited
								times.
							</p>
							<p class={styles.note}>
								<strong class={styles.noteStrong}>Not imported:</strong> reminders (Takeout usually omits
								them), shared people, and editable drawings (those arrive as pictures).
							</p>
						</section>

						<section class={styles.source}>
							<h3 class={styles.sourceTitle}>
								<span class={styles.sourceIcon} aria-hidden="true"
									><ArchiveRestore size={16} /></span
								>
								Scraps Cache backup
							</h3>
							<p class={styles.note}>
								Choose an encrypted <span class={css({ whiteSpace: 'nowrap' })}
									>.scraps-cache-backup</span
								> from Export backup. You will be asked for its passphrase.
							</p>
						</section>
					{/if}

					{#if error}<p class={d.error} role="alert">
							{error}
						</p>{/if}

					<div class={d.footer}>
						<button type="button" disabled={busy} onclick={onClose} class={cancelButton}
							>Cancel</button
						>
						{#if !keepReady}
							<input
								bind:this={fileInput}
								type="file"
								accept=".scraps-cache-backup,.zip,application/json,application/zip,application/x-zip-compressed"
								class={css({ display: 'none' })}
								tabindex="-1"
								disabled={busy}
								onchange={handleFileChange}
								oncancel={handleFileCancel}
							/>
							<button type="button" disabled={busy} onclick={chooseFile} class={chooseButton}>
								{busy ? 'Reading file…' : 'Choose file'}
							</button>
						{/if}
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
