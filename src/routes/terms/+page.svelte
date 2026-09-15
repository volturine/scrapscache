<script lang="ts">
	import { resolve } from '$app/paths';
	import { publicPageStyles as styles } from '$panda/styles';
	import { cx } from 'styled-system/css';
	import { ArrowLeft, FileText, CheckCircle2, AlertTriangle, ShieldCheck } from '@lucide/svelte';
</script>

<svelte:head>
	<title>Terms of Service · Scraps Cache</title>
	<meta
		name="description"
		content="Terms of service and acceptable use guidelines for Scraps Cache."
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
			<div class={styles.termsBadge}>
				<FileText class={styles.badgeIcon} aria-hidden="true" />
				Legal & Usage
			</div>
			<h1 class={styles.pageTitle}>Terms of Service</h1>
			<p class={styles.updated}>Last updated: September 2026</p>
		</div>

		<div class={styles.sections}>
			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					<CheckCircle2 class={styles.sectionIcon} aria-hidden="true" />
					1. Agreement to Terms
				</h2>
				<p class={styles.sectionCopy}>
					By accessing or using Scraps Cache (the "Service"), you agree to be bound by these Terms
					of Service. If you do not agree to these terms, do not use the Service.
				</p>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					<ShieldCheck class={styles.sectionIcon} aria-hidden="true" />
					2. Software License & Open Source
				</h2>
				<p class={styles.sectionCopy}>
					The Scraps Cache client application is open-source software licensed under the MIT
					License. You are free to inspect, fork, modify, redistribute, or self-host your own
					instances according to the terms of the MIT License.
				</p>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					<AlertTriangle class={cx(styles.sectionIcon, styles.warningIcon)} aria-hidden="true" />
					3. Acceptable Use of Hosted Sync Relay
				</h2>
				<p class={styles.sectionCopy}>
					When utilizing any public or hosted sync relay provided by Scraps Cache:
				</p>
				<ul class={styles.sectionList}>
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
				<p class={styles.sectionCopy}>
					We reserve the right to limit or suspend sync access for clients that abuse network
					resources or disrupt services for other users.
				</p>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					4. Backup Passphrase, Keys & Zero-Knowledge Architecture
				</h2>
				<p class={styles.sectionCopy}>
					Scraps Cache operates on a strict zero-knowledge, client-side encryption architecture. No
					unencrypted notes, titles, drawings, or photos are ever exposed to or stored by the
					server:
				</p>
				<ul class={styles.sectionList}>
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

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>5. Disclaimer of Warranties</h2>
				<p class={styles.sectionCopy}>
					THE SOFTWARE AND HOSTED SERVICES ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
					EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
					FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
					COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY.
				</p>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>6. Service Modifications & Advance Notice</h2>
				<p class={styles.sectionCopy}>
					If we ever decide to permanently discontinue the hosted sync relay or permanently delete
					hosted data, we will provide advance notice (via in-app notification or project channels)
					so you have ample time to export or back up your notes.
				</p>
				<p class={styles.sectionCopy}>
					Because Scraps Cache is offline-first, all notes stored locally on your device will
					continue to work normally and remain completely accessible to you regardless of hosted
					service availability.
				</p>
			</section>
		</div>

		<footer class={styles.footer}>
			<p>© Scraps Cache. MIT Licensed.</p>
			<div class={styles.footerLinks}>
				<a href={resolve('/privacy')} class={styles.footerLink}>Privacy Policy</a>
				<a href={resolve('/')} class={styles.footerLink}>Home</a>
			</div>
		</footer>
	</main>
</div>
