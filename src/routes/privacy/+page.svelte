<script lang="ts">
	import { resolve } from '$app/paths';
	import { publicPageStyles as styles } from '$panda/styles';
	import { ArrowLeft, ShieldCheck, Lock, HardDrive, EyeOff, Server } from '@lucide/svelte';
</script>

<svelte:head>
	<title>Privacy Policy · Scraps Cache</title>
	<meta
		name="description"
		content="Learn how Scraps Cache protects your privacy with local-first storage, zero telemetry, and end-to-end encryption."
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

	<main class={styles.wideMain}>
		<div class={styles.intro}>
			<div class={styles.privacyBadge}>
				<ShieldCheck class={styles.badgeIcon} aria-hidden="true" />
				Privacy by Design
			</div>
			<h1 class={styles.pageTitle}>Privacy Policy</h1>
			<p class={styles.updated}>Last updated: September 2026</p>
		</div>

		<div class={styles.sections}>
			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					<HardDrive class={styles.sectionIcon} aria-hidden="true" />
					1. Local-First Storage
				</h2>
				<p class={styles.sectionCopy}>
					Scraps Cache is built from the ground up as an offline-first application. Your notes,
					checklists, canvas drawings, labels, and uploaded attachments are saved directly on your
					device using your browser's IndexedDB storage.
				</p>
				<p class={styles.sectionCopy}>
					You can use Scraps Cache completely offline without creating an account, without
					connecting to any server, and without sending a single byte of note data over the
					internet.
				</p>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					<Lock class={styles.sectionIcon} aria-hidden="true" />
					2. End-to-End Encrypted Cloud Sync
				</h2>
				<p class={styles.sectionCopy}>
					Multi-device sync is completely optional. When you choose to sync across devices, all note
					titles, bodies, checklists, attachments, and canvases are encrypted on your device using
					AES-256-GCM / XChaCha20-Poly1305 before transmission.
				</p>
				<p class={styles.sectionCopy}>
					The sync keys are generated on your hardware and never sent to any server in plaintext.
					The sync relay only stores opaque encrypted ciphertext and blinded hashes. We cannot read,
					scan, index, monetize, or decrypt your content.
				</p>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					<EyeOff class={styles.sectionIcon} aria-hidden="true" />
					3. Zero Tracking & No Analytics
				</h2>
				<p class={styles.sectionCopy}>We do not track you. Scraps Cache contains:</p>
				<ul class={styles.sectionList}>
					<li>No third-party advertising scripts or tracking pixels</li>
					<li>No behavioral tracking or analytics frameworks</li>
					<li>No personal profiling or data brokers</li>
					<li>No third-party tracking cookies</li>
				</ul>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					<Server class={styles.sectionIcon} aria-hidden="true" />
					4. Relay Server Logs & Verification
				</h2>
				<p class={styles.sectionCopy}>
					When interacting with the optional cloud sync relay or push wake service:
				</p>
				<ul class={styles.sectionList}>
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

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>5. Data Ownership & Right to Deletion</h2>
				<p class={styles.sectionCopy}>
					You own all of your data. You can export a full password-encrypted or JSON backup at any
					time from the Settings menu. If you use cloud sync, you can unlink your workspace or
					execute a permanent deletion, immediately wiping the cloud ciphertext record.
				</p>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>6. Self-Hosting & Source Code</h2>
				<p class={styles.sectionCopy}>
					Scraps Cache is open source. You are welcome to inspect the cryptographic implementations,
					audit our code, or host your own sync relay and web server so that you have 100% control
					over your infrastructure.
				</p>
			</section>
		</div>

		<footer class={styles.footer}>
			<p>© Scraps Cache. MIT Licensed.</p>
			<div class={styles.footerLinks}>
				<a href={resolve('/terms')} class={styles.footerLink}>Terms of Service</a>
				<a href={resolve('/')} class={styles.footerLink}>Home</a>
			</div>
		</footer>
	</main>
</div>
