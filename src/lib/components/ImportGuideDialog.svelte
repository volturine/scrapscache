<script lang="ts">
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
	<div {@attach portalToAppOverlay} class="absolute inset-0 z-[70]" role="presentation">
		<Dialog.Backdrop class="absolute inset-0 bg-black/45" />
		<Dialog.Positioner
			class="absolute inset-0 flex items-start justify-center px-4 pb-4 pt-[calc(var(--app-topbar-height)+0.5rem)]"
		>
			<Dialog.Content
				class="scrapscache-dialog max-h-[calc(100dvh-var(--app-topbar-height)-1.5rem)] w-full max-w-md overflow-y-auto"
			>
				<div class="border-b border-[var(--scrapscache-border)] px-5 py-4">
					<Dialog.Title class="text-lg font-semibold text-[var(--scrapscache-text)]">
						Import notes
					</Dialog.Title>
					<Dialog.Description
						class="mt-1 text-sm leading-relaxed text-[var(--scrapscache-text-muted)]"
					>
						{keepReady
							? 'Your Keep export is ready. Choose how to add it to the workspace that is open now.'
							: 'The file is read in this browser and added to the workspace that is open now. Nothing is uploaded.'}
					</Dialog.Description>
				</div>

				<div class="space-y-4 px-5 py-5 text-sm text-[var(--scrapscache-text)]">
					{#if keepReady}
						<ImportModeChoices {busy} keepImport onSelect={onSelectMode} />
					{:else}
						<section class="source">
							<h3 class="source-title">
								<span class="source-icon" aria-hidden="true"><FileArchive size={16} /></span>
								Google Keep
							</h3>
							<ol class="steps">
								<li>
									<span
										>Open
										<a
											href="https://takeout.google.com"
											target="_blank"
											rel="noreferrer"
											class="underline underline-offset-2">takeout.google.com</a
										></span
									>
								</li>
								<li>Deselect all, then select only Keep</li>
								<li>Create the export and download the zip</li>
								<li>Choose that zip below</li>
							</ol>
							<p class="note">
								<strong>Imported:</strong> titles, text, checklists, colors, pins, archive, trash, labels,
								photos, and saved links, with original created and edited times.
							</p>
							<p class="note">
								<strong>Not imported:</strong> reminders (Takeout usually omits them), shared people,
								and editable drawings (those arrive as pictures).
							</p>
						</section>

						<section class="source">
							<h3 class="source-title">
								<span class="source-icon" aria-hidden="true"><ArchiveRestore size={16} /></span>
								Scraps Cache backup
							</h3>
							<p class="note">
								Choose an encrypted <span class="whitespace-nowrap">.scraps-cache-backup</span> from Export
								backup. You will be asked for its passphrase.
							</p>
						</section>
					{/if}

					{#if error}<p class="text-sm text-[var(--scrapscache-danger)]" role="alert">
							{error}
						</p>{/if}

					<div class="flex justify-end gap-2 pt-1">
						<button
							type="button"
							disabled={busy}
							onclick={onClose}
							class="scrapscache-button scrapscache-button-quiet px-3 py-2 text-sm">Cancel</button
						>
						{#if !keepReady}
							<input
								bind:this={fileInput}
								type="file"
								accept=".scraps-cache-backup,.zip,application/json,application/zip,application/x-zip-compressed"
								class="hidden"
								tabindex="-1"
								disabled={busy}
								onchange={handleFileChange}
								oncancel={handleFileCancel}
							/>
							<button
								type="button"
								disabled={busy}
								onclick={chooseFile}
								class="scrapscache-button scrapscache-button-primary px-4 py-2 text-sm font-medium"
							>
								{busy ? 'Reading file…' : 'Choose file'}
							</button>
						{/if}
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>

<style>
	.source {
		padding: 14px;
		border: 1px solid var(--scrapscache-border);
		border-radius: 12px;
		background: var(--scrapscache-bg);
	}
	.source-title {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 500;
	}
	.source-icon {
		display: grid;
		width: 28px;
		height: 28px;
		place-items: center;
		border-radius: 8px;
		background: color-mix(in srgb, var(--scrapscache-accent) 15%, transparent);
		color: var(--scrapscache-accent);
	}
	.steps {
		display: grid;
		gap: 6px;
		margin-top: 12px;
		padding: 0;
		list-style: none;
		counter-reset: step;
	}
	.steps li {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
		counter-increment: step;
	}
	.steps li::before {
		content: counter(step);
		display: grid;
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		place-items: center;
		border-radius: 999px;
		background: var(--scrapscache-interactive-hover);
		color: var(--scrapscache-text-muted);
		font-size: 11px;
		font-weight: 600;
	}
	.note {
		margin-top: 10px;
		color: var(--scrapscache-text-muted);
		font-size: 12px;
		line-height: 1.5;
	}
	.note strong {
		color: var(--scrapscache-text);
		font-weight: 500;
	}
</style>
