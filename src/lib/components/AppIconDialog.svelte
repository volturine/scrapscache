<script lang="ts">
	// Settings > App icon, in the iPhone app: the icon large, built from three
	// choices. The tile is Automatic (the app's own pair, which follows light and
	// dark mode), dark or light; then the notes and their colour. The choices
	// change the preview; Apply changes the home screen's icon, which iOS
	// confirms with an alert, so that alert comes once and not at every tap.
	import {
		appIconStyles as styles,
		iconSizeMd as iconMd,
		settingsMenuStyles,
		settingsPageStyles as page,
		visuallyHidden
	} from '$panda/styles';
	import { cx } from 'styled-system/css';
	import { button, dialog, iconButton } from 'styled-system/recipes';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { RadioGroup } from '@ark-ui/svelte/radio-group';
	import { ArrowLeft, X } from '@lucide/svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { PHONE_MEDIA, portalToAppOverlay } from '#lib/appViewport.js';
	import { iconArt } from '#lib/appIconArt.js';
	import {
		NOTES,
		TILES,
		coloursFor,
		describeChoice,
		masterName,
		withTile,
		type IconColour,
		type IconNotes,
		type IconTile
	} from '#lib/native/appIcon.js';
	import { appIconStore } from '#lib/stores/appIcon.svelte.js';

	let { onClose }: { onClose: () => void } = $props();

	const phone = new MediaQuery(PHONE_MEDIA, false);
	const d = dialog({ presentation: 'appOverlay' });
	const id = $props.id();
	const ids = { tile: `${id}-tile`, notes: `${id}-notes`, colour: `${id}-colour` };

	/** The icon being built; the store keeps the one iOS shows. */
	let choice = $state(appIconStore.choice);
	const automatic = $derived(choice.tile === 'automatic');
	const showing = $derived(appIconStore.isShowing(choice));
	const master = $derived(masterName(choice));
</script>

{#snippet segments(
	labelId: string,
	label: string,
	options: { value: string; label: string }[],
	value: string,
	disabled: boolean,
	onChange: (value: string) => void
)}
	<RadioGroup.Root
		{value}
		{disabled}
		orientation="horizontal"
		onValueChange={(details) => {
			if (details.value) onChange(details.value);
		}}
		class={styles.controlRow}
		aria-labelledby={labelId}
	>
		<RadioGroup.Label id={labelId} class={page.rowLabel}>{label}</RadioGroup.Label>
		<div class={settingsMenuStyles.segment}>
			{#each options as option (option.value)}
				<RadioGroup.Item value={option.value} class={settingsMenuStyles.segmentItem}>
					<RadioGroup.ItemText>{option.label}</RadioGroup.ItemText>
					<RadioGroup.ItemHiddenInput />
				</RadioGroup.Item>
			{/each}
		</div>
	</RadioGroup.Root>
{/snippet}

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
		<Dialog.Backdrop class={d.backdrop} />
		<Dialog.Positioner class={cx(d.positioner, phone.current && page.phonePositioner)}>
			<Dialog.Content class={cx(d.panel, page.panel, phone.current && page.phonePanel)}>
				<div class={cx(page.header, phone.current && page.phoneHeader)}>
					{#if phone.current}
						<Dialog.CloseTrigger
							class={iconButton({ variant: 'ghost', size: 'compact' })}
							aria-label="Back"
						>
							<ArrowLeft class={iconMd} aria-hidden="true" />
						</Dialog.CloseTrigger>
					{/if}
					<Dialog.Title class={page.title}>App icon</Dialog.Title>
					{#if !phone.current}
						<Dialog.CloseTrigger
							class={iconButton({ variant: 'ghost', size: 'compact' })}
							aria-label="Close"
						>
							<X class={iconMd} aria-hidden="true" />
						</Dialog.CloseTrigger>
					{/if}
				</div>

				<div class={page.body}>
					<div class={styles.hero}>
						{#if master}
							<img src={iconArt(master)} alt="" class={cx(styles.art, styles.large)} />
						{:else}
							<span class={styles.pair}>
								<img
									src={iconArt('light-tilted-peach')}
									alt=""
									class={cx(styles.art, styles.pairIcon)}
								/>
								<img
									src={iconArt('dark-tilted-amber')}
									alt=""
									class={cx(styles.art, styles.pairIcon)}
								/>
							</span>
						{/if}
						<p class={styles.heroCaption} aria-live="polite">
							{automatic ? 'Peach in light mode, amber in dark mode' : describeChoice(choice)}
						</p>
					</div>

					<section class={page.card} aria-label="Icon">
						{@render segments(
							ids.tile,
							'Tile',
							TILES,
							choice.tile,
							false,
							(tile) => (choice = withTile(choice, tile as IconTile))
						)}
						<div class={page.rowRule}>
							{@render segments(
								ids.notes,
								'Notes',
								NOTES,
								choice.notes,
								automatic,
								(notes) => (choice = { ...choice, notes: notes as IconNotes })
							)}
						</div>
						<RadioGroup.Root
							value={automatic ? null : choice.colour}
							disabled={automatic}
							orientation="horizontal"
							onValueChange={(details) => {
								if (details.value) choice = { ...choice, colour: details.value as IconColour };
							}}
							class={cx(styles.controlRow, page.rowRule)}
							aria-labelledby={ids.colour}
						>
							<RadioGroup.Label id={ids.colour} class={page.rowLabel}>Colour</RadioGroup.Label>
							<div class={styles.swatches}>
								{#each coloursFor(choice.tile) as colour (colour.value)}
									<RadioGroup.Item
										value={colour.value}
										class={styles.swatchItem}
										title={colour.label}
									>
										<RadioGroup.ItemText class={visuallyHidden}>{colour.label}</RadioGroup.ItemText>
										<span
											class={styles.swatch}
											style:--icon-front={colour.front}
											style:--icon-back={colour.back}
										></span>
										<RadioGroup.ItemHiddenInput />
									</RadioGroup.Item>
								{/each}
							</div>
						</RadioGroup.Root>
					</section>

					<button
						type="button"
						class={cx(button({ variant: 'primary', size: 'md' }), styles.apply)}
						disabled={showing || appIconStore.applying}
						onclick={() => appIconStore.apply(choice)}
					>
						{showing ? 'Current icon' : appIconStore.applying ? 'Applying…' : 'Apply'}
					</button>
					{#if appIconStore.error}
						<p class={styles.alert} role="alert">{appIconStore.error}</p>
					{/if}
					<p class={styles.note}>
						Automatic uses the tilted notes, peach in light mode and amber in dark mode. Amber comes
						on dark tiles only.
					</p>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
