<script lang="ts">
	import { ChevronRight, Download, Share, Smartphone, X } from '@lucide/svelte';
	import { pwaInstallStore } from '$lib/stores/pwaInstall.svelte';

	function install() {
		void pwaInstallStore.promptInstall();
	}
</script>

{#if pwaInstallStore.canPrompt}
	<section class="md:hidden" aria-label="Install app">
		<div class="flex items-center">
			<button
				type="button"
				onclick={install}
				class="flex h-8 min-w-0 flex-1 items-center gap-2.5 px-3 text-left hover:bg-black/5 dark:hover:bg-white/10"
				aria-label="Install app"
			>
				<Download class="h-4 w-4 shrink-0 text-[var(--scrapscache-accent)]" aria-hidden="true" />
				<span class="min-w-0 flex-1 text-sm font-medium text-[var(--scrapscache-text)]"
					>Install app</span
				>
				<ChevronRight
					class="h-4 w-4 shrink-0 text-[var(--scrapscache-text-muted)]"
					aria-hidden="true"
				/>
			</button>
			<button
				type="button"
				onclick={() => pwaInstallStore.dismiss()}
				class="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--scrapscache-text-muted)] hover:bg-black/5 hover:text-[var(--scrapscache-text)] dark:hover:bg-white/10"
				aria-label="Dismiss install prompt"
			>
				<X class="h-3.5 w-3.5" aria-hidden="true" />
			</button>
		</div>
	</section>
{/if}

{#if pwaInstallStore.showIOSHelp}
	<div
		class="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center"
		role="dialog"
		aria-modal="true"
		aria-labelledby="ios-install-title"
	>
		<div
			class="w-full max-w-sm rounded-2xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] p-5 text-[var(--scrapscache-text)] shadow-2xl"
		>
			<div
				class="flex items-center justify-between border-b border-[var(--scrapscache-border)] pb-3"
			>
				<div class="flex items-center gap-2">
					<Smartphone class="h-5 w-5 text-[var(--scrapscache-accent)]" aria-hidden="true" />
					<h3 id="ios-install-title" class="text-sm font-semibold">Install Scraps Cache</h3>
				</div>
				<button
					type="button"
					onclick={() => pwaInstallStore.closeIOSHelp()}
					class="rounded-lg p-1 text-[var(--scrapscache-text-muted)] hover:bg-black/5 dark:hover:bg-white/5"
					aria-label="Close"
				>
					<X class="h-4 w-4" aria-hidden="true" />
				</button>
			</div>

			<div class="mt-4 space-y-3 text-xs leading-relaxed text-[var(--scrapscache-text-muted)]">
				<p class="flex items-start gap-2">
					<span
						class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--scrapscache-accent)]/10 font-bold text-[var(--scrapscache-accent)]"
						>1</span
					>
					<span
						>Tap the <strong class="text-[var(--scrapscache-text)]">Share</strong> icon <Share
							class="inline h-3.5 w-3.5"
							aria-hidden="true"
						/> in Safari's bottom toolbar.</span
					>
				</p>
				<p class="flex items-start gap-2">
					<span
						class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--scrapscache-accent)]/10 font-bold text-[var(--scrapscache-accent)]"
						>2</span
					>
					<span
						>Scroll down and tap <strong class="text-[var(--scrapscache-text)]"
							>Add to Home Screen</strong
						>.</span
					>
				</p>
				<p class="flex items-start gap-2">
					<span
						class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--scrapscache-accent)]/10 font-bold text-[var(--scrapscache-accent)]"
						>3</span
					>
					<span
						>Tap <strong class="text-[var(--scrapscache-text)]">Add</strong> in the top right to install
						Scraps Cache.</span
					>
				</p>
			</div>

			<button
				type="button"
				onclick={() => pwaInstallStore.closeIOSHelp()}
				class="mt-5 w-full rounded-lg bg-[var(--scrapscache-accent)] py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
			>
				Got it
			</button>
		</div>
	</div>
{/if}
