<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { FileUpload } from '@ark-ui/svelte/file-upload';
	import { portalToAppOverlay } from '$lib/appViewport';

	let {
		busy = false,
		error = '',
		onFile,
		onClose
	}: {
		busy?: boolean;
		error?: string;
		onFile: (file: File) => void | Promise<void>;
		onClose: () => void;
	} = $props();

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
						The file is read in this browser and added to the workspace that is open now. Nothing is
						uploaded.
					</Dialog.Description>
				</div>

				<div class="space-y-4 px-5 py-5 text-sm text-[var(--scrapscache-text)]">
					<section>
						<h3 class="font-medium">Google Keep</h3>
						<ol
							class="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-[var(--scrapscache-text-muted)]"
						>
							<li>
								Open
								<a
									href="https://takeout.google.com"
									target="_blank"
									rel="noreferrer"
									class="underline underline-offset-2">takeout.google.com</a
								>
							</li>
							<li>Deselect all, then select only Keep</li>
							<li>Create the export and download the zip</li>
							<li>Choose that zip below</li>
						</ol>
						<p class="mt-3 text-xs leading-relaxed text-[var(--scrapscache-text-muted)]">
							Imported: titles, text, checklists, colors, pins, archive, trash, labels, photos, and
							saved links, with original created and edited times.
						</p>
						<p class="mt-2 text-xs leading-relaxed text-[var(--scrapscache-text-muted)]">
							Not imported: reminders (Takeout usually omits them), shared people, and editable
							drawings (those arrive as pictures).
						</p>
					</section>

					<section>
						<h3 class="font-medium">Scraps Cache backup</h3>
						<p class="mt-2 text-xs leading-relaxed text-[var(--scrapscache-text-muted)]">
							Choose an encrypted <span class="whitespace-nowrap">.scraps-cache-backup</span> from Export
							backup. You will be asked for its passphrase.
						</p>
					</section>

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
						<FileUpload.Root
							accept=".scraps-cache-backup,.zip,application/json,application/zip,application/x-zip-compressed"
							maxFiles={1}
							disabled={busy}
							onFileAccept={(details) => {
								const file = details.files[0];
								if (file) void onFile(file);
							}}
						>
							<FileUpload.Trigger
								disabled={busy}
								class="scrapscache-button scrapscache-button-primary px-4 py-2 text-sm font-medium"
							>
								{busy ? 'Reading file…' : 'Choose file'}
							</FileUpload.Trigger>
							<FileUpload.HiddenInput />
						</FileUpload.Root>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
