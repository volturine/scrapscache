<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { button, dialog } from 'styled-system/recipes';

	let { message, onClose }: { message: string; onClose: () => void } = $props();

	const d = dialog({ size: 'sm', presentation: 'appOverlay' });
</script>

<!-- Tells why a note link could not open; mounted only while there is something to say. -->
<Dialog.Root open onOpenChange={(details) => !details.open && onClose()} preventScroll={false}>
	<div {@attach portalToAppOverlay} class={d.portal} role="presentation">
		<Dialog.Backdrop class={d.backdrop} />
		<Dialog.Positioner class={d.positioner}>
			<Dialog.Content class={d.panel}>
				<div class={d.header}>
					<Dialog.Title class={d.title}>Can't open this note</Dialog.Title>
				</div>
				<div class={d.body}>
					<Dialog.Description class={d.description}>{message}</Dialog.Description>
					<div class={d.footer}>
						<button
							type="button"
							onclick={onClose}
							class={button({ variant: 'primary', size: 'md' })}>OK</button
						>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
