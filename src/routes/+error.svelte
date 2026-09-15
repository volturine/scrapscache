<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { publicPageStyles as styles } from '$panda/styles';
	import { button } from 'styled-system/recipes';
	import { cx } from 'styled-system/css';
	import { FileQuestion, ArrowLeft } from '@lucide/svelte';

	const status = $derived(page.status ?? 404);
	const message = $derived(
		status === 404 ? 'Page not found' : page.error?.message || 'Something went wrong'
	);
</script>

<svelte:head>
	<title>{status} · {status === 404 ? 'Page Not Found' : 'Error'} · Scraps Cache</title>
</svelte:head>

<main class={cx(styles.root, styles.errorRoot)}>
	<div class={styles.errorContent}>
		<div class={styles.errorIcon}>
			<FileQuestion class={styles.errorGlyph} strokeWidth={1.5} aria-hidden="true" />
		</div>
		<span class={styles.errorCode}>
			Error {status}
		</span>
		<h1 class={styles.errorTitle}>
			{message}
		</h1>
		<p class={styles.errorMessage}>
			{status === 404
				? "The page you are looking for doesn't exist, was moved, or is no longer available."
				: 'An unexpected error occurred. Your local notes remain safe.'}
		</p>
		<a
			href={resolve('/')}
			class={cx(button({ variant: 'primary', size: 'md' }), styles.errorAction)}
		>
			<ArrowLeft class={styles.errorActionGlyph} strokeWidth={2} aria-hidden="true" />
			Return to Notes
		</a>
	</div>
</main>
