<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '#lib/appViewport.js';
	import { button, dialog } from 'styled-system/recipes';

	// Shown in place of the sync dialog when its code could not be loaded.
	let { message, onClose }: { message: string; onClose: () => void } = $props();

	const d = dialog({ size: 'sm', presentation: 'appOverlay' });
</script>

<Dialog.Root
	open
	onOpenChange={(details) => !details.open && onClose()}
	preventScroll={false}
	lazyMount
	unmountOnExit
>
	<div {@attach portalToAppOverlay} class={d.portal} role="presentation">
		<Dialog.Backdrop class={d.backdrop} />
		<Dialog.Positioner class={d.positioner}>
			<Dialog.Content class={d.panel}>
				<div class={d.header}>
					<Dialog.Title class={d.title}>Sync settings</Dialog.Title>
				</div>
				<div class={d.body}>
					<p class={d.error} role="alert">{message}</p>
					<div class={d.footer}>
						<button type="button" onclick={onClose} class={button({ variant: 'quiet', size: 'md' })}
							>Close</button
						>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
