<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { FileQuestion, ArrowLeft } from '@lucide/svelte';

	const status = $derived(page.status ?? 404);
	const message = $derived(
		status === 404 ? 'Page not found' : page.error?.message || 'Something went wrong'
	);
</script>

<svelte:head>
	<title>{status} · {status === 404 ? 'Page Not Found' : 'Error'} · Scraps Cache</title>
</svelte:head>

<main
	class="flex min-h-screen flex-col items-center justify-center px-4 py-12 text-center bg-[var(--scrapscache-bg)] text-[var(--scrapscache-text)]"
>
	<div class="mx-auto flex max-w-md flex-col items-center">
		<div
			class="mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] text-[var(--scrapscache-text-muted)] shadow-xs"
		>
			<FileQuestion class="h-8 w-8" strokeWidth={1.5} aria-hidden="true" />
		</div>
		<span
			class="text-xs font-semibold tracking-wider uppercase text-[var(--scrapscache-text-muted)]"
		>
			Error {status}
		</span>
		<h1 class="mt-2 text-2xl font-bold tracking-tight text-[var(--scrapscache-text)] sm:text-3xl">
			{message}
		</h1>
		<p class="mt-3 text-sm leading-relaxed text-[var(--scrapscache-text-muted)]">
			{status === 404
				? "The page you are looking for doesn't exist, was moved, or is no longer available."
				: 'An unexpected error occurred. Your local notes remain safe.'}
		</p>
		<a
			href={resolve('/')}
			class="scrapscache-button scrapscache-button-primary mt-8 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium"
		>
			<ArrowLeft class="h-4 w-4" strokeWidth={2} aria-hidden="true" />
			Return to Notes
		</a>
	</div>
</main>
