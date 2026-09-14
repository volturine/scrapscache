<script lang="ts">
	import { resolve } from '$app/paths';
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

<div class="min-h-screen bg-[var(--scrapscache-bg)] text-[var(--scrapscache-text)]">
	<header
		class="sticky top-0 z-20 border-b border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)]/80 backdrop-blur-sm"
	>
		<div class="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 sm:px-6">
			<a
				href={resolve('/')}
				class="inline-flex items-center gap-2 text-sm font-medium text-[var(--scrapscache-text-muted)] transition-colors hover:text-[var(--scrapscache-text)]"
			>
				<ArrowLeft class="h-4 w-4" aria-hidden="true" />
				Back to Notes
			</a>
			<span
				class="text-xs font-semibold uppercase tracking-wider text-[var(--scrapscache-text-muted)]"
			>
				Scraps Cache
			</span>
		</div>
	</header>

	<main class="mx-auto max-w-2xl px-4 py-12 text-center sm:px-6 sm:py-20">
		<div
			class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10 text-rose-500"
		>
			<Heart class="h-8 w-8 fill-rose-500/20" aria-hidden="true" />
		</div>

		<h1 class="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">
			Thank You for Using Scraps Cache!
		</h1>
		<p class="mt-4 text-base leading-relaxed text-[var(--scrapscache-text-muted)]">
			We built Scraps Cache because we believe your thoughts, sketches, and notes belong to you —
			never monetized, never tracked, and always accessible offline.
		</p>

		<div
			class="mt-10 rounded-xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] p-6 text-left sm:p-8"
		>
			<h2 class="text-lg font-semibold text-[var(--scrapscache-text)]">
				How you can support the project
			</h2>
			<ul class="mt-4 space-y-3 text-sm text-[var(--scrapscache-text-muted)]">
				<li class="flex items-start gap-2.5">
					<Star class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
					<span>
						<strong class="font-medium text-[var(--scrapscache-text)]">Star the repository:</strong>
						Help more people discover private note-taking on GitHub.
					</span>
				</li>
				<li class="flex items-start gap-2.5">
					<ShieldCheck class="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
					<span>
						<strong class="font-medium text-[var(--scrapscache-text)]"
							>Contribute or report issues:</strong
						>
						Scraps Cache is open-source and welcomes community feedback and contributions.
					</span>
				</li>
				<li class="flex items-start gap-2.5">
					<Heart class="mt-0.5 h-4 w-4 shrink-0 text-rose-500" aria-hidden="true" />
					<span>
						<strong class="font-medium text-[var(--scrapscache-text)]">Tell a friend:</strong>
						Share Scraps Cache with friends and colleagues who value their privacy.
					</span>
				</li>
			</ul>

			<div
				class="mt-6 flex flex-wrap items-center gap-3 border-t border-[var(--scrapscache-border)] pt-6"
			>
				<a
					href="https://github.com/volturine/scrapscache"
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center gap-2 rounded-lg bg-[var(--scrapscache-accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
				>
					<Star class="h-4 w-4" aria-hidden="true" />
					Star on GitHub
					<ExternalLink class="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
				</a>

				<button
					type="button"
					onclick={copyShareLink}
					class="inline-flex items-center gap-2 rounded-lg border border-[var(--scrapscache-border)] bg-[var(--scrapscache-bg)] px-4 py-2 text-sm font-medium text-[var(--scrapscache-text)] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
				>
					{#if copied}
						<Check class="h-4 w-4 text-emerald-500" aria-hidden="true" />
						Link copied!
					{:else}
						<Copy class="h-4 w-4 text-[var(--scrapscache-text-muted)]" aria-hidden="true" />
						Share Scraps Cache
					{/if}
				</button>

				<a
					href={resolve('/')}
					class="inline-flex items-center gap-2 rounded-lg border border-transparent px-4 py-2 text-sm font-medium text-[var(--scrapscache-text-muted)] transition-colors hover:text-[var(--scrapscache-text)]"
				>
					Return to Notes
				</a>
			</div>
		</div>

		<footer class="mt-12 text-xs text-[var(--scrapscache-text-muted)]">
			<a href="/privacy" class="underline hover:text-[var(--scrapscache-text)]">Privacy Policy</a>
			&nbsp;·&nbsp;
			<a href="/terms" class="underline hover:text-[var(--scrapscache-text)]">Terms of Service</a>
		</footer>
	</main>
</div>
