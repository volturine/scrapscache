<script lang="ts">
	// Settings > Text and code: the text size for the whole app, its own size for note
	// titles, and how code blocks are sized and whether their long lines wrap. Each
	// section previews its change, and the app behind the dialog follows as the controls move.
	import {
		iconSizeMd as iconMd,
		markdownStyles,
		textSettingsStyles as styles
	} from '$panda/styles';
	import { cx } from 'styled-system/css';
	import { dialog, iconButton, noteSurface } from 'styled-system/recipes';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { Slider } from '@ark-ui/svelte/slider';
	import { Switch } from '@ark-ui/svelte/switch';
	import { ArrowLeft, TextWrap, X } from '@lucide/svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { PHONE_MEDIA, portalToAppOverlay } from '#lib/appViewport.js';
	import { CODE_SIZE, TEXT_SIZE, TITLE_SIZE, uiStore } from '#lib/stores/ui.svelte.js';

	let { onClose }: { onClose: () => void } = $props();

	const phone = new MediaQuery(PHONE_MEDIA, false);
	const d = dialog({ presentation: 'appOverlay' });
	// The settings menu hands focus on by script, which Chrome counts as keyboard focus
	// all the way to a slider's thumb; the thumb's ring follows the last input instead.
	let pointer = $state(false);
	const codeSample = [
		'git commit -m "Bump the version"',
		'curl -fsSL https://example.com/install.sh | sh # a long line that keeps going past the edge'
	];
</script>

{#snippet sizeSlider(
	label: string,
	value: number,
	range: { min: number; max: number; default: number },
	onChange: (size: number) => void
)}
	<Slider.Root
		value={[value]}
		min={range.min}
		max={range.max}
		step={1}
		onValueChange={(details) => onChange(details.value[0])}
	>
		<div class={styles.row}>
			<Slider.Label class={styles.rowLabel}>{label}</Slider.Label>
			<Slider.ValueText class={styles.value}
				>{value} px{value === range.default ? ' · Default' : ''}</Slider.ValueText
			>
		</div>
		<div class={styles.slider}>
			<span class={styles.smallA} aria-hidden="true">A</span>
			<Slider.Control class={styles.sliderControl}>
				<Slider.Track class={styles.track}>
					<Slider.Range class={styles.range} />
					<!-- In the track, so the mark's offset is a share of the track's width. -->
					<Slider.MarkerGroup>
						<Slider.Marker value={range.default} class={styles.marker} />
					</Slider.MarkerGroup>
				</Slider.Track>
				<Slider.Thumb index={0} class={styles.thumb} data-pointer={pointer || undefined}>
					<Slider.HiddenInput />
				</Slider.Thumb>
			</Slider.Control>
			<span class={styles.largeA} aria-hidden="true">A</span>
		</div>
	</Slider.Root>
{/snippet}

{#snippet toggle(
	label: string,
	Icon: typeof TextWrap,
	checked: boolean,
	onChange: (on: boolean) => void
)}
	<Switch.Root
		{checked}
		onCheckedChange={(details) => onChange(details.checked)}
		class={cx(styles.row, styles.switchRoot)}
	>
		<Icon class={styles.rowIcon} aria-hidden="true" />
		<Switch.Label class={styles.rowLabel}>{label}</Switch.Label>
		<Switch.Control class={styles.switchControl}>
			<Switch.Thumb class={styles.switchThumb} />
		</Switch.Control>
		<Switch.HiddenInput />
	</Switch.Root>
{/snippet}

<svelte:window
	onpointerdowncapture={() => (pointer = true)}
	onkeydowncapture={() => (pointer = false)}
/>

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
		<Dialog.Positioner class={cx(d.positioner, phone.current && styles.phonePositioner)}>
			<Dialog.Content class={cx(d.panel, styles.panel, phone.current && styles.phonePanel)}>
				<div class={cx(styles.header, phone.current && styles.phoneHeader)}>
					{#if phone.current}
						<Dialog.CloseTrigger
							class={iconButton({ variant: 'ghost', size: 'compact' })}
							aria-label="Back"
						>
							<ArrowLeft class={iconMd} aria-hidden="true" />
						</Dialog.CloseTrigger>
					{/if}
					<Dialog.Title class={styles.title}>Text and code</Dialog.Title>
					{#if !phone.current}
						<Dialog.CloseTrigger
							class={iconButton({ variant: 'ghost', size: 'compact' })}
							aria-label="Close"
						>
							<X class={iconMd} aria-hidden="true" />
						</Dialog.CloseTrigger>
					{/if}
				</div>

				<div class={styles.body}>
					<h3 class={styles.sectionLabel}>Text</h3>
					<section class={styles.card} aria-label="Text">
						<div class={styles.preview}>
							<div class={cx(noteSurface({ color: 'brown' }), styles.sampleNote)}>
								<span class={styles.sampleTitle}>Groceries</span>
								<span>Sourdough bread, oat milk and two avocados.</span>
							</div>
							<p class={styles.caption}>
								App text covers menus, labels, headings and what you write in a note.
							</p>
						</div>
						{@render sizeSlider(
							'App text',
							uiStore.textSize,
							TEXT_SIZE,
							(size) => (uiStore.textSize = size)
						)}
						<div class={styles.rowRule}>
							{@render sizeSlider(
								'Note titles',
								uiStore.titleSize,
								TITLE_SIZE,
								(size) => (uiStore.titleSize = size)
							)}
						</div>
					</section>

					<h3 class={styles.sectionLabel}>Code blocks</h3>
					<section class={styles.card} aria-label="Code blocks">
						<div class={cx(styles.preview, markdownStyles, styles.sampleCode)}>
							<pre class="markdown-block-surface markdown-code-block note-scrollbar-hidden"><code
									>{#each codeSample as line (line)}<span class="markdown-code-line">{line}</span
										>{/each}</code
								></pre>
							<p class={styles.caption}>
								Wrapping is for cards; while you edit a note, long lines always wrap.
							</p>
						</div>
						{@render sizeSlider(
							'Code size',
							uiStore.codeSize,
							CODE_SIZE,
							(size) => (uiStore.codeSize = size)
						)}
						<div class={styles.rowRule}>
							{@render toggle(
								'Wrap long lines',
								TextWrap,
								uiStore.codeWrap,
								(on) => (uiStore.codeWrap = on)
							)}
						</div>
					</section>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
