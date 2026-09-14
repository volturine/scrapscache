<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { BackupImportMode } from '$lib/backup';

	let {
		open = true,
		busy = false,
		error = '',
		keepImport = false,
		onSelect,
		onClose
	}: {
		open?: boolean;
		busy?: boolean;
		error?: string;
		keepImport?: boolean;
		onSelect: (mode: BackupImportMode) => void | Promise<void>;
		onClose: () => void;
	} = $props();

	let keepButton: HTMLButtonElement | null = $state(null);

	function handleOpenChange(details: { open: boolean }) {
		if (!details.open && !busy) onClose();
	}
</script>

<Dialog.Root
	{open}
	onOpenChange={handleOpenChange}
	closeOnEscape={!busy}
	closeOnInteractOutside={!busy}
	preventScroll={false}
	initialFocusEl={() => keepButton}
	lazyMount
	unmountOnExit
>
	<div {@attach portalToAppOverlay} class="absolute inset-0 z-[70]" role="presentation">
		<Dialog.Backdrop class="absolute inset-0 bg-black/45" />
		<Dialog.Positioner
			class="absolute inset-0 flex items-start justify-center px-4 pb-4 pt-[calc(var(--app-topbar-height)+0.5rem)]"
		>
			<Dialog.Content class="scrapscache-dialog w-full max-w-sm">
				<div class="border-b border-[var(--scrapscache-border)] px-5 py-4">
					<Dialog.Title class="text-lg font-semibold text-[var(--scrapscache-text)]">
						{keepImport
							? 'How should these Keep notes be imported?'
							: 'How should this backup be imported?'}
					</Dialog.Title>
				</div>

				<div class="space-y-3 px-5 py-5">
					<button
						bind:this={keepButton}
						type="button"
						disabled={busy}
						onclick={() => onSelect(BackupImportMode.Keep)}
						class="scrapscache-button w-full px-4 py-3 text-left"
					>
						<span class="block font-medium">Keep local notes</span>
						<span class="mt-1 block text-xs text-[var(--scrapscache-text-muted)]">
							{keepImport
								? 'Add every Keep note as a new copy. Existing notes stay unchanged.'
								: 'Add every backup note as a new copy. Existing notes stay unchanged.'}
						</span>
					</button>
					<button
						type="button"
						disabled={busy}
						onclick={() => onSelect(BackupImportMode.Replace)}
						class="scrapscache-button w-full px-4 py-3 text-left"
					>
						<span class="block font-medium text-[var(--scrapscache-danger)]"
							>Replace local data</span
						>
						<span class="mt-1 block text-xs text-[var(--scrapscache-text-muted)]">
							{keepImport
								? 'Delete current notes in this workspace and import Keep instead.'
								: 'Delete current local notes and restore the backup instead.'}
						</span>
					</button>
					{#if error}<p class="text-sm text-[var(--scrapscache-danger)]" role="alert">
							{error}
						</p>{/if}
					<div class="flex justify-end pt-1">
						<button
							type="button"
							disabled={busy}
							onclick={onClose}
							class="scrapscache-button scrapscache-button-quiet px-3 py-2 text-sm">Cancel</button
						>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
