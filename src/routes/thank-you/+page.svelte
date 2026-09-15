<script lang="ts">
	import { resolve } from '$app/paths';
	import { publicPageStyles as styles } from '$panda/styles';
	import { cx } from 'styled-system/css';
	import { button } from 'styled-system/recipes';
	import { ArrowLeft, Heart, Star, ExternalLink, ShieldCheck, Check, Copy } from '@lucide/svelte';

	let copied = $state(false);

	async function copyShareLink() {
		try {
			await navigator.clipboard.writeText('https://scrapscache.com');
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch {
			// fallback
		}
	}
</script>

<svelte:head>
	<title>Thank You · Scraps Cache</title>
	<meta
		name="description"
		content="Thank you for using and supporting Scraps Cache — private, local-first, end-to-end encrypted notes."
	/>
</svelte:head>

<div class={styles.root}>
	<header class={styles.header}>
		<div class={styles.headerInner}>
			<a href={resolve('/')} class={styles.backLink}>
				<ArrowLeft class={styles.iconSm} aria-hidden="true" />
				Back to Notes
			</a>
			<span class={styles.brand}> Scraps Cache </span>
		</div>
	</header>

	<main class={styles.narrowMain}>
		<div class={styles.thankYouMark}>
			<Heart class={styles.thankYouMarkGlyph} aria-hidden="true" />
		</div>

		<h1 class={styles.thankYouTitle}>Thank You for Using Scraps Cache!</h1>
		<p class={styles.thankYouLead}>
			We built Scraps Cache because we believe your thoughts, sketches, and notes belong to you —
			never monetized, never tracked, and always accessible offline.
		</p>

		<div class={styles.supportCard}>
			<h2 class={styles.supportTitle}>How you can support the project</h2>
			<ul class={styles.supportList}>
				<li class={styles.supportItem}>
					<Star class={cx(styles.supportIcon, styles.supportStar)} aria-hidden="true" />
					<span>
						<strong class={styles.supportStrong}>Star the repository:</strong>
						Help more people discover private note-taking on GitHub.
					</span>
				</li>
				<li class={styles.supportItem}>
					<ShieldCheck class={cx(styles.supportIcon, styles.supportShield)} aria-hidden="true" />
					<span>
						<strong class={styles.supportStrong}>Contribute or report issues:</strong>
						Scraps Cache is open-source and welcomes community feedback and contributions.
					</span>
				</li>
				<li class={styles.supportItem}>
					<Heart class={cx(styles.supportIcon, styles.supportHeart)} aria-hidden="true" />
					<span>
						<strong class={styles.supportStrong}>Tell a friend:</strong>
						Share Scraps Cache with friends and colleagues who value their privacy.
					</span>
				</li>
			</ul>

			<div class={styles.supportActions}>
				<a
					href="https://github.com/volturine/scrapscache"
					target="_blank"
					rel="noopener noreferrer"
					class={button({ variant: 'primary', size: 'md' })}
				>
					<Star class={styles.iconSm} aria-hidden="true" />
					Star on GitHub
					<ExternalLink class={cx(styles.iconXs, styles.supportExternalIcon)} aria-hidden="true" />
				</a>

				<button
					type="button"
					onclick={copyShareLink}
					class={button({ variant: 'secondary', size: 'md' })}
				>
					{#if copied}
						<Check class={cx(styles.iconSm, styles.supportShield)} aria-hidden="true" />
						Link copied!
					{:else}
						<Copy class={styles.mutedIcon} aria-hidden="true" />
						Share Scraps Cache
					{/if}
				</button>

				<a href={resolve('/')} class={button({ variant: 'ghost', size: 'md' })}>
					Return to Notes
				</a>
			</div>
		</div>

		<footer class={styles.thankYouFooter}>
			<a href="/privacy" class={styles.footerLink}>Privacy Policy</a>
			&nbsp;·&nbsp;
			<a href="/terms" class={styles.footerLink}>Terms of Service</a>
		</footer>
	</main>
</div>
