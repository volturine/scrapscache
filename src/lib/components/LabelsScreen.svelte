<script lang="ts">
	// The phone's Labels screen: every label to make, rename (swipe a row) or delete,
	// over the whole screen, the way the palette opens. Opened from the title's picker.
	import {
		commandPaletteStyles,
		iconSizeMd as iconMd,
		labelsScreenStyles as styles
	} from '$panda/styles';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { ArrowLeft } from '@lucide/svelte';
	import { portalToAppOverlay } from '#lib/appViewport.js';
	import { cx } from 'styled-system/css';
	import { dialog, iconButton } from 'styled-system/recipes';
	import Sidebar from './Sidebar.svelte';

	let { onClose }: { onClose: () => void } = $props();

	const d = dialog({ presentation: 'appOverlay' });
</script>

<Dialog.Root
	open
	onOpenChange={(details) => {
		if (!details.open) onClose();
	}}
	preventScroll={false}
	lazyMount
	unmountOnExit
>
	<div {@attach portalToAppOverlay} class={d.portal} role="presentation">
		<Dialog.Positioner class={cx(d.positioner, commandPaletteStyles.phonePositioner)}>
			<Dialog.Content class={cx(d.panel, commandPaletteStyles.phonePanel, styles.panel)}>
				<div class={styles.bar}>
					<button
						type="button"
						class={iconButton({ variant: 'ghost', size: 'compact' })}
						onclick={onClose}
						aria-label="Close labels"
					>
						<ArrowLeft class={iconMd} aria-hidden="true" />
					</button>
					<Dialog.Title class={styles.title}>Labels</Dialog.Title>
				</div>
				<p class={styles.hint}>Swipe a label to the left to rename or delete it.</p>
				<div class={styles.body}>
					<!-- Opening a label goes to its notes and puts this screen away. -->
					<Sidebar labelsOnly onNavigate={onClose} />
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
