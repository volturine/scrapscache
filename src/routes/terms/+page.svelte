<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowLeft, FileText, CheckCircle2, AlertTriangle, ShieldCheck } from '@lucide/svelte';
</script>

<svelte:head>
	<title>Terms of Service · Scraps Cache</title>
	<meta
		name="description"
		content="Terms of service and acceptable use guidelines for Scraps Cache."
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

	<main class="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
		<div class="space-y-4">
			<div
				class="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-400"
			>
				<FileText class="h-3.5 w-3.5" aria-hidden="true" />
				Legal & Usage
			</div>
			<h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Terms of Service</h1>
			<p class="text-sm text-[var(--scrapscache-text-muted)]">Last updated: September 2026</p>
		</div>

		<div class="mt-8 space-y-8 text-sm leading-relaxed sm:text-base">
			<section
				class="rounded-xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] p-6 sm:p-8"
			>
				<h2 class="flex items-center gap-2 text-xl font-semibold text-[var(--scrapscache-text)]">
					<CheckCircle2 class="h-5 w-5 text-[var(--scrapscache-accent)]" aria-hidden="true" />
					1. Agreement to Terms
				</h2>
				<p class="mt-3 text-[var(--scrapscache-text-muted)]">
					By accessing or using Scraps Cache (the "Service"), you agree to be bound by these Terms
					of Service. If you do not agree to these terms, do not use the Service.
				</p>
			</section>

			<section
				class="rounded-xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] p-6 sm:p-8"
			>
				<h2 class="flex items-center gap-2 text-xl font-semibold text-[var(--scrapscache-text)]">
					<ShieldCheck class="h-5 w-5 text-[var(--scrapscache-accent)]" aria-hidden="true" />
					2. Software License & Open Source
				</h2>
				<p class="mt-3 text-[var(--scrapscache-text-muted)]">
					The Scraps Cache client application is open-source software licensed under the MIT
					License. You are free to inspect, fork, modify, redistribute, or self-host your own
					instances according to the terms of the MIT License.
				</p>
			</section>

			<section
				class="rounded-xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] p-6 sm:p-8"
			>
				<h2 class="flex items-center gap-2 text-xl font-semibold text-[var(--scrapscache-text)]">
					<AlertTriangle class="h-5 w-5 text-amber-500" aria-hidden="true" />
					3. Acceptable Use of Hosted Sync Relay
				</h2>
				<p class="mt-3 text-[var(--scrapscache-text-muted)]">
					When utilizing any public or hosted sync relay provided by Scraps Cache:
				</p>
				<ul class="mt-2 list-inside list-disc space-y-1 text-[var(--scrapscache-text-muted)]">
					<li>You agree not to upload malicious software, malware, or exploit scripts.</li>
					<li>
						You agree not to launch denial-of-service (DoS) attacks or intentionally circumvent
						storage quotas or rate limits.
					</li>
					<li>
						You agree not to use the sync relay for distributing unlawful, harmful, or
						copyright-infringing content.
					</li>
				</ul>
				<p class="mt-2 text-[var(--scrapscache-text-muted)]">
					We reserve the right to limit or suspend sync access for clients that abuse network
					resources or disrupt services for other users.
				</p>
			</section>

			<section
				class="rounded-xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] p-6 sm:p-8"
			>
				<h2 class="text-xl font-semibold text-[var(--scrapscache-text)]">
					4. Backup Passphrase, Keys & Zero-Knowledge Architecture
				</h2>
				<p class="mt-3 text-[var(--scrapscache-text-muted)]">
					Scraps Cache operates on a strict zero-knowledge, client-side encryption architecture. No
					unencrypted notes, titles, drawings, or photos are ever exposed to or stored by the
					server:
				</p>
				<ul class="mt-2 list-inside list-disc space-y-1 text-[var(--scrapscache-text-muted)]">
					<li>
						<strong>Backup Passphrase:</strong> The only password or passphrase you ever create is for
						encrypting offline backup files. If you encrypt a backup file with a passphrase, you are solely
						responsible for remembering it. We do not have access to your passphrase and cannot recover
						it or decrypt your backup if you forget it.
					</li>
					<li>
						<strong>Sync Keys & Pairing Codes:</strong> When using multi-device sync, cryptographic sync
						keys are generated automatically on your device and stored in local device storage. Linking
						devices uses temporary one-time pairing codes over encrypted channels. We never have access
						to your unencrypted keys.
					</li>
					<li>
						<strong>Zero Content Exposure:</strong> All content is encrypted on your hardware before transmission
						using authenticated ciphers (XChaCha20-Poly1305 / AES-256-GCM). The hosted relay only sees
						opaque ciphertext blobs and anonymous identifiers.
					</li>
				</ul>
			</section>

			<section
				class="rounded-xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] p-6 sm:p-8"
			>
				<h2 class="text-xl font-semibold text-[var(--scrapscache-text)]">
					5. Disclaimer of Warranties
				</h2>
				<p class="mt-3 text-[var(--scrapscache-text-muted)]">
					THE SOFTWARE AND HOSTED SERVICES ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
					EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
					FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
					COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY.
				</p>
			</section>

			<section
				class="rounded-xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] p-6 sm:p-8"
			>
				<h2 class="text-xl font-semibold text-[var(--scrapscache-text)]">
					6. Service Modifications & Advance Notice
				</h2>
				<p class="mt-3 text-[var(--scrapscache-text-muted)]">
					If we ever decide to permanently discontinue the hosted sync relay or permanently delete
					hosted data, we will provide advance notice (via in-app notification or project channels)
					so you have ample time to export or back up your notes.
				</p>
				<p class="mt-2 text-[var(--scrapscache-text-muted)]">
					Because Scraps Cache is offline-first, all notes stored locally on your device will
					continue to work normally and remain completely accessible to you regardless of hosted
					service availability.
				</p>
			</section>
		</div>

		<footer
			class="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--scrapscache-border)] pt-6 text-xs text-[var(--scrapscache-text-muted)]"
		>
			<p>© Scraps Cache. MIT Licensed.</p>
			<div class="flex gap-4">
				<a href={resolve('/privacy')} class="hover:underline">Privacy Policy</a>
				<a href={resolve('/')} class="hover:underline">Home</a>
			</div>
		</footer>
	</main>
</div>
