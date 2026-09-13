<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowLeft, ShieldCheck, Lock, HardDrive, EyeOff, Server } from '@lucide/svelte';
</script>

<svelte:head>
	<title>Privacy Policy · Scraps Cache</title>
	<meta
		name="description"
		content="Learn how Scraps Cache protects your privacy with local-first storage, zero telemetry, and end-to-end encryption."
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
				class="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"
			>
				<ShieldCheck class="h-3.5 w-3.5" aria-hidden="true" />
				Privacy by Design
			</div>
			<h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Privacy Policy</h1>
			<p class="text-sm text-[var(--scrapscache-text-muted)]">Last updated: September 2026</p>
		</div>

		<div class="mt-8 space-y-8 text-sm leading-relaxed sm:text-base">
			<section
				class="rounded-xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] p-6 sm:p-8"
			>
				<h2 class="flex items-center gap-2 text-xl font-semibold text-[var(--scrapscache-text)]">
					<HardDrive class="h-5 w-5 text-[var(--scrapscache-accent)]" aria-hidden="true" />
					1. Local-First Storage
				</h2>
				<p class="mt-3 text-[var(--scrapscache-text-muted)]">
					Scraps Cache is built from the ground up as an offline-first application. Your notes,
					checklists, canvas drawings, labels, and uploaded attachments are saved directly on your
					device using your browser's IndexedDB storage.
				</p>
				<p class="mt-2 text-[var(--scrapscache-text-muted)]">
					You can use Scraps Cache completely offline without creating an account, without
					connecting to any server, and without sending a single byte of note data over the
					internet.
				</p>
			</section>

			<section
				class="rounded-xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] p-6 sm:p-8"
			>
				<h2 class="flex items-center gap-2 text-xl font-semibold text-[var(--scrapscache-text)]">
					<Lock class="h-5 w-5 text-[var(--scrapscache-accent)]" aria-hidden="true" />
					2. End-to-End Encrypted Cloud Sync
				</h2>
				<p class="mt-3 text-[var(--scrapscache-text-muted)]">
					Multi-device sync is completely optional. When you choose to sync across devices, all note
					titles, bodies, checklists, attachments, and canvases are encrypted on your device using
					AES-256-GCM / XChaCha20-Poly1305 before transmission.
				</p>
				<p class="mt-2 text-[var(--scrapscache-text-muted)]">
					The sync keys are generated on your hardware and never sent to any server in plaintext.
					The sync relay only stores opaque encrypted ciphertext and blinded hashes. We cannot read,
					scan, index, monetize, or decrypt your content.
				</p>
			</section>

			<section
				class="rounded-xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] p-6 sm:p-8"
			>
				<h2 class="flex items-center gap-2 text-xl font-semibold text-[var(--scrapscache-text)]">
					<EyeOff class="h-5 w-5 text-[var(--scrapscache-accent)]" aria-hidden="true" />
					3. Zero Tracking & No Analytics
				</h2>
				<p class="mt-3 text-[var(--scrapscache-text-muted)]">
					We do not track you. Scraps Cache contains:
				</p>
				<ul class="mt-2 list-inside list-disc space-y-1 text-[var(--scrapscache-text-muted)]">
					<li>No third-party advertising scripts or tracking pixels</li>
					<li>No behavioral tracking or analytics frameworks</li>
					<li>No personal profiling or data brokers</li>
					<li>No third-party tracking cookies</li>
				</ul>
			</section>

			<section
				class="rounded-xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] p-6 sm:p-8"
			>
				<h2 class="flex items-center gap-2 text-xl font-semibold text-[var(--scrapscache-text)]">
					<Server class="h-5 w-5 text-[var(--scrapscache-accent)]" aria-hidden="true" />
					4. Relay Server Logs & Verification
				</h2>
				<p class="mt-3 text-[var(--scrapscache-text-muted)]">
					When interacting with the optional cloud sync relay or push wake service:
				</p>
				<ul class="mt-2 list-inside list-disc space-y-1 text-[var(--scrapscache-text-muted)]">
					<li>
						<strong>Transient Network Logs:</strong> Standard network logs (such as IP addresses and request
						timestamps) may be processed temporarily by infrastructure providers (e.g., Cloudflare) strictly
						for DDoS mitigation and operational stability.
					</li>
					<li>
						<strong>Bot Verification:</strong> When creating a sync workspace on public relays, Cloudflare
						Turnstile may be used to verify human visitors without setting tracking cookies.
					</li>
					<li>
						<strong>Push Notifications:</strong> Web Push notification endpoints and encrypted wake payloads
						are stored only to deliver background sync wake signals to your devices.
					</li>
				</ul>
			</section>

			<section
				class="rounded-xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] p-6 sm:p-8"
			>
				<h2 class="text-xl font-semibold text-[var(--scrapscache-text)]">
					5. Data Ownership & Right to Deletion
				</h2>
				<p class="mt-3 text-[var(--scrapscache-text-muted)]">
					You own all of your data. You can export a full password-encrypted or JSON backup at any
					time from the Settings menu. If you use cloud sync, you can unlink your workspace or
					execute a permanent deletion, immediately wiping the cloud ciphertext record.
				</p>
			</section>

			<section
				class="rounded-xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] p-6 sm:p-8"
			>
				<h2 class="text-xl font-semibold text-[var(--scrapscache-text)]">
					6. Self-Hosting & Source Code
				</h2>
				<p class="mt-3 text-[var(--scrapscache-text-muted)]">
					Scraps Cache is open source. You are welcome to inspect the cryptographic implementations,
					audit our code, or host your own sync relay and web server so that you have 100% control
					over your infrastructure.
				</p>
			</section>
		</div>

		<footer
			class="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--scrapscache-border)] pt-6 text-xs text-[var(--scrapscache-text-muted)]"
		>
			<p>© Scraps Cache. MIT Licensed.</p>
			<div class="flex gap-4">
				<a href={resolve('/terms')} class="hover:underline">Terms of Service</a>
				<a href={resolve('/')} class="hover:underline">Home</a>
			</div>
		</footer>
	</main>
</div>
