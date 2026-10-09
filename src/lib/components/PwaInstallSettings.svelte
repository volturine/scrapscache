<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { Menu } from '@ark-ui/svelte/menu';
	import { iconSizeSm, iconSizeXs, pwaStyles as styles } from '$panda/styles';
	import { css, cx } from 'styled-system/css';
	import { button, menuItem } from 'styled-system/recipes';
	import { Download, Share, Smartphone, X } from '@lucide/svelte';
	import { pwaInstallStore } from '#lib/stores/pwaInstall.svelte.js';

	function install() {
		void pwaInstallStore.promptInstall();
	}
</script>

{#if pwaInstallStore.canPrompt}
	<Menu.Item
		value="install-app"
		closeOnSelect={false}
		onSelect={install}
		class={menuItem({ density: 'compact' })}
		aria-label="Install app"
	>
		<Download class={cx(iconSizeSm, css({ color: 'scrapscache.accent' }))} aria-hidden="true" />
		<span>Install app</span>
	</Menu.Item>
{/if}

<Dialog.Root
	open={pwaInstallStore.showIOSHelp}
	onOpenChange={(details) => {
		if (!details.open) pwaInstallStore.closeIOSHelp();
	}}
	lazyMount
	unmountOnExit
>
	<Dialog.Positioner class={styles.iosPortal}>
		<Dialog.Content class={styles.iosPanel}>
			<div class={styles.iosHeader}>
				<div class={styles.iosTitle}>
					<Smartphone
						class={cx(iconSizeSm, css({ w: '1.25rem', h: '1.25rem', color: 'scrapscache.accent' }))}
						aria-hidden="true"
					/>
					<Dialog.Title>Install Scraps Cache</Dialog.Title>
				</div>
				<Dialog.CloseTrigger class={styles.iosClose} aria-label="Close">
					<X class={iconSizeSm} aria-hidden="true" />
				</Dialog.CloseTrigger>
			</div>

			<div class={styles.iosSteps}>
				<p class={styles.iosStep}>
					<span class={styles.iosStepNumber}>1</span>
					<span
						>Tap the <strong class={styles.iosAction}>Share</strong> icon <Share
							class={cx(iconSizeXs, css({ display: 'inline' }))}
							aria-hidden="true"
						/> in Safari's bottom toolbar.</span
					>
				</p>
				<p class={styles.iosStep}>
					<span class={styles.iosStepNumber}>2</span>
					<span
						>Scroll down and tap <strong class={styles.iosAction}>Add to Home Screen</strong>.</span
					>
				</p>
				<p class={styles.iosStep}>
					<span class={styles.iosStepNumber}>3</span>
					<span
						>Tap <strong class={styles.iosAction}>Add</strong> in the top right to install Scraps Cache.</span
					>
				</p>
			</div>

			<Dialog.CloseTrigger class={cx(button({ variant: 'primary' }), styles.iosDoneLayout)}>
				Got it
			</Dialog.CloseTrigger>
		</Dialog.Content>
	</Dialog.Positioner>
</Dialog.Root>
