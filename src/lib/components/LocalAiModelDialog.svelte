<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { Sparkles } from '@lucide/svelte';
	import { css } from 'styled-system/css';
	import { button, dialog } from 'styled-system/recipes';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { LOCAL_AI_MODELS, type LocalAiModel } from '$lib/localAi';
	import ChoiceCard from './ChoiceCard.svelte';

	let {
		onSelect,
		onClose
	}: {
		onSelect: (model: LocalAiModel) => void;
		onClose: () => void;
	} = $props();

	const d = dialog({ size: 'sm', presentation: 'appOverlay' });
</script>

<Dialog.Root
	open
	onOpenChange={(details) => {
		if (!details.open) onClose();
	}}
	preventScroll={false}
>
	<div {@attach portalToAppOverlay} class={d.portal} role="presentation">
		<Dialog.Backdrop class={d.backdrop} />
		<Dialog.Positioner class={d.positioner}>
			<Dialog.Content class={d.panel}>
				<div class={d.header}>
					<Dialog.Title class={d.title}>Choose a local AI model</Dialog.Title>
					<Dialog.Description class={d.description}>
						It downloads once and runs in this browser. Notes never leave the device.
					</Dialog.Description>
				</div>

				<div class={d.body}>
					<div class={css({ display: 'grid', gap: 'sm' })}>
						{#each LOCAL_AI_MODELS as model, index (model.name)}
							<ChoiceCard
								title={model.name}
								badge={index === 0 ? 'Recommended' : ''}
								caption={`${model.size} · ${model.description}`}
								onclick={() => onSelect(model)}
							>
								{#snippet icon()}<Sparkles size={18} />{/snippet}
							</ChoiceCard>
						{/each}
					</div>
					<div class={d.footer}>
						<button type="button" onclick={onClose} class={button({ variant: 'quiet', size: 'md' })}
							>Cancel</button
						>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
