<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { BackupImportMode } from '$lib/backup';

	let {
		open = true,
		busy = false,
		error = '',
		keepReady = false,
		onFile,
		onSelectMode,
		onClose
	}: {
		open?: boolean;
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
	{open}
	onOpenChange={handleOpenChange}
	closeOnEscape={!busy && !pickingFile}
	closeOnInteractOutside={false}
	preventScroll={false}
	lazyMount
>
	{#if open}
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
							The file is read in this browser and added to the workspace that is open now. Nothing
							is uploaded.
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
								Imported: titles, text, checklists, colors, pins, archive, trash, labels, photos,
								and saved links, with original created and edited times.
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

						{#if keepReady}
							<div class="space-y-3">
								<p class="font-medium">How should these Keep notes be imported?</p>
								<button
									type="button"
									disabled={busy}
									onclick={() => onSelectMode(BackupImportMode.Keep)}
									class="scrapscache-button w-full px-4 py-3 text-left"
								>
									<span class="block font-medium">Keep local notes</span>
									<span class="mt-1 block text-xs text-[var(--scrapscache-text-muted)]">
										Add every Keep note as a new copy. Existing notes stay unchanged.
									</span>
								</button>
								<button
									type="button"
									disabled={busy}
									onclick={() => onSelectMode(BackupImportMode.Replace)}
									class="scrapscache-button w-full px-4 py-3 text-left"
								>
									<span class="block font-medium text-[var(--scrapscache-danger)]"
										>Replace local data</span
									>
									<span class="mt-1 block text-xs text-[var(--scrapscache-text-muted)]">
										Delete current notes in this workspace and import Keep instead.
									</span>
								</button>
								<div class="flex justify-end pt-1">
									<button
										type="button"
										disabled={busy}
										onclick={onClose}
										class="scrapscache-button scrapscache-button-quiet px-3 py-2 text-sm"
										>Cancel</button
									>
								</div>
							</div>
						{:else}
							<div class="flex justify-end gap-2 pt-1">
								<button
									type="button"
									disabled={busy}
									onclick={onClose}
									class="scrapscache-button scrapscache-button-quiet px-3 py-2 text-sm"
									>Cancel</button
								>
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
							</div>
						{/if}
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	{/if}
</Dialog.Root>
