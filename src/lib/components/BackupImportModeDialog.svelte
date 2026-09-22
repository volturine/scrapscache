<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import type { BackupImportMode } from '$lib/backup';
	import { button, dialog } from 'styled-system/recipes';
	import ImportModeChoices from './ImportModeChoices.svelte';

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

	const d = dialog({ size: 'sm', presentation: 'appOverlay' });
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
	{#if open}
		<div {@attach portalToAppOverlay} class={d.portal} role="presentation">
			<Dialog.Backdrop class={d.backdrop} />
			<Dialog.Positioner class={d.positioner}>
				<Dialog.Content class={d.panel}>
					<div class={d.header}>
						<Dialog.Title class={d.title}>
							{keepImport
								? 'How should these Keep notes be imported?'
								: 'How should this backup be imported?'}
						</Dialog.Title>
					</div>

					<div class={d.body}>
						<ImportModeChoices {busy} {keepImport} bind:keepButton {onSelect} />
						{#if error}
							<p class={d.error} role="alert">
								{error}
							</p>
						{/if}
						<div class={d.footer}>
							<button
								type="button"
								disabled={busy}
								onclick={onClose}
								class={button({ variant: 'quiet', size: 'md' })}>Cancel</button
							>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	{/if}
</Dialog.Root>
