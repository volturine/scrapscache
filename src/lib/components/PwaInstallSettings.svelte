<script lang="ts">
	import { iconSizeSm, iconSizeXs, pwaStyles as styles } from '$panda/styles';
	import { css, cx } from 'styled-system/css';
	import { ChevronRight, Download, Share, Smartphone, X } from '@lucide/svelte';
	import { pwaInstallStore } from '$lib/stores/pwaInstall.svelte';

	function install() {
		void pwaInstallStore.promptInstall();
	}
</script>

{#if pwaInstallStore.canPrompt}
	<section aria-label="Install app">
		<div class={styles.installRow}>
			<button type="button" onclick={install} class={styles.installButton} aria-label="Install app">
				<Download class={cx(iconSizeSm, css({ color: 'scrapscache.accent' }))} aria-hidden="true" />
				<span class={styles.installLabel}>Install app</span>
				<ChevronRight
					class={cx(iconSizeSm, css({ color: 'scrapscache.textMuted' }))}
					aria-hidden="true"
				/>
			</button>
			<button
				type="button"
				onclick={() => pwaInstallStore.dismiss()}
				class={styles.dismiss}
				aria-label="Dismiss install prompt"
			>
				<X class={iconSizeXs} aria-hidden="true" />
			</button>
		</div>
	</section>
{/if}

{#if pwaInstallStore.showIOSHelp}
	<div class={styles.iosPortal} role="dialog" aria-modal="true" aria-labelledby="ios-install-title">
		<div class={styles.iosPanel}>
			<div class={styles.iosHeader}>
				<div class={styles.iosTitle}>
					<Smartphone
						class={cx(iconSizeSm, css({ w: '1.25rem', h: '1.25rem', color: 'scrapscache.accent' }))}
						aria-hidden="true"
					/>
					<h3 id="ios-install-title">Install Scraps Cache</h3>
				</div>
				<button
					type="button"
					onclick={() => pwaInstallStore.closeIOSHelp()}
					class={styles.iosClose}
					aria-label="Close"
				>
					<X class={iconSizeSm} aria-hidden="true" />
				</button>
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

			<button type="button" onclick={() => pwaInstallStore.closeIOSHelp()} class={styles.iosDone}>
				Got it
			</button>
		</div>
	</div>
{/if}
