<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { Sparkles } from '@lucide/svelte';
	import { css } from 'styled-system/css';
	import { button, dialog } from 'styled-system/recipes';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { localAiModelDialogStyles as styles, progressMeter } from '$panda/styles';
	import { LOCAL_AI_MODELS, type LocalAiModel } from '$lib/localAi';
	import { localAiStore, LocalAiStatus } from '$lib/stores/localAi.svelte';
	import ChoiceCard from './ChoiceCard.svelte';

	let {
		onSelect,
		onClose
	}: {
		onSelect: (model: LocalAiModel) => void;
		onClose: () => void;
	} = $props();

	const d = dialog({ size: 'sm', presentation: 'appOverlay' });
	const percent = $derived(Math.round(localAiStore.progress * 100));
	const description = $derived(
		localAiStore.status === LocalAiStatus.Downloading
			? 'Your model is downloading into this browser.'
			: localAiStore.status === LocalAiStatus.Ready
				? 'Your local model is ready to use.'
				: localAiStore.status === LocalAiStatus.Unsupported
					? 'This browser does not support WebGPU, which the on-device model needs.'
					: 'Choose a model to download to this browser. It runs here and works offline after setup.'
	);
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
					<Dialog.Title class={d.title}>Set up on-device AI</Dialog.Title>
					<Dialog.Description class={d.description}>
						{description} Notes and prompts stay on this device. No external AI provider, account, or
						API key is needed.
					</Dialog.Description>
				</div>

				<div class={d.body}>
					{#if localAiStore.status === LocalAiStatus.Unsupported}
						<p class={styles.status} role="status">
							This browser does not support WebGPU, which the on-device model needs.
						</p>
					{:else if localAiStore.status === LocalAiStatus.Downloading}
						<div class={styles.statusCard}>
							<p class={styles.status} role="status">
								Downloading {localAiStore.model?.name ?? 'model'} · {percent}%
							</p>
							<div
								class={progressMeter.track}
								role="progressbar"
								aria-label="Model download progress"
								aria-valuemin="0"
								aria-valuemax="100"
								aria-valuenow={percent}
							>
								<div class={progressMeter.bar} style={`width: ${percent}%`}></div>
							</div>
							<p class={styles.detail}>The model is stored in this browser.</p>
							<button
								type="button"
								class={button({ variant: 'quiet', size: 'sm' })}
								onclick={() => localAiStore.cancel()}>Cancel download</button
							>
						</div>
					{:else if localAiStore.status === LocalAiStatus.Ready}
						<div class={styles.statusCard} role="status">
							<p class={styles.status}>
								{localAiStore.model?.name ?? 'Model'} is ready on this device.
							</p>
							<p class={styles.detail}>You can use the assistant offline.</p>
						</div>
					{:else}
						{#if localAiStore.error}
							<p class={styles.error} role="alert">{localAiStore.error}</p>
						{/if}
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
					{/if}

					<div class={d.footer}>
						<button type="button" onclick={onClose} class={button({ variant: 'quiet', size: 'md' })}
							>{localAiStore.status === LocalAiStatus.Ready ? 'Done' : 'Close'}</button
						>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
