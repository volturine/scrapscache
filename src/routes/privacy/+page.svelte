<script lang="ts">
	import PageMeta from '#lib/components/PageMeta.svelte';
	import { resolve } from '$app/paths';
	import { publicPageStyles as styles } from '$panda/styles';
	import { ArrowLeft, ShieldCheck, Lock, HardDrive, EyeOff, Server, Mail } from '@lucide/svelte';
</script>

<PageMeta
	title="Privacy Policy · Scraps Cache"
	description="Learn how Scraps Cache protects your privacy with local-first storage, zero telemetry, and end-to-end encryption."
/>

<div class={styles.root}>
	<header class={styles.header}>
		<div class={styles.headerInner}>
			<a href={resolve('')} class={styles.backLink}>
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
			<p class={styles.updated}>Last updated: November 2026</p>
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
					XChaCha20-Poly1305 before transmission.
				</p>
				<p class={styles.sectionCopy}>
					The sync keys are generated on your hardware and never sent to any server in plaintext.
					The sync relay stores your content only as opaque encrypted ciphertext, next to blinded
					hashes and the few records listed in section 4 that it needs to run sync. We cannot read,
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
					<li>
						<strong>iPhone App Push:</strong> With notifications allowed, the iPhone app registers the
						push token iOS gives it with the relay, under each workspace it syncs. iOS issues one token
						per app, so the relay can tell that those workspaces are on the same phone. A reminder push
						travels through Apple's push service and says only that a reminder is due; it never carries
						a note or its title.
					</li>
					<li>
						<strong>Workspace Records:</strong> For each synced workspace the relay keeps a random workspace
						ID, its public signing key, how many encrypted records and bytes it holds, and when it was
						last used. It uses them to run sync, enforce storage limits and remove unused workspaces.
						None of them is your name, email or phone number.
					</li>
					<li>
						<strong>Reminder Times:</strong> For the reminders in a synced workspace, the relay stores
						the time each upcoming one is due, without its note or title, so that it can wake your devices.
						Each time is deleted a day after it has passed.
					</li>
					<li>
						<strong>Abuse Limits:</strong> To slow down abuse, the relay counts requests per IP address
						(per /64 network for IPv6) and per workspace. A counter is deleted within about an hour once
						it has been idle for 10 minutes, except a workspace's count of sync writes (uploads and deletions),
						which is kept for 5 days after its last use.
					</li>
				</ul>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>5. Data Ownership & Right to Deletion</h2>
				<p class={styles.sectionCopy}>
					You own all of your data. You can export a full password-encrypted backup at any time from
					the Settings menu. If you use cloud sync, you can unlink your workspace or execute a
					permanent deletion, immediately wiping the cloud ciphertext record.
				</p>
				<p class={styles.sectionCopy}>
					A synced workspace that has not been used for 365 days is deleted from the hosted relay.
					When you remove a workspace from the cloud, the relay deletes its data at once and keeps
					its random ID and the date, so that a lost device that still holds the workspace's key
					cannot create it again. Its count of sync writes goes after 5 days, as above.
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

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>7. AI Assistants (Optional)</h2>
				<p class={styles.sectionCopy}>
					Scraps Cache has no AI features and runs no AI service. You can choose to connect an AI
					assistant by deploying your own MCP server and approving it on a consent screen that names
					its address. Approving gives that server the key to one synced workspace: whoever runs it,
					and any AI assistant you connect to it, can read and change the notes in that workspace.
					Nothing is shared unless you approve it. To end its access, remove the workspace from the
					cloud.
				</p>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					<Mail class={styles.sectionIcon} aria-hidden="true" />
					8. Contact
				</h2>
				<p class={styles.sectionCopy}>
					Questions about privacy or your data: write to
					<a href="mailto:support@scrapscache.com" class={styles.inlineLink}
						>support@scrapscache.com</a
					>. More help is on the <a href={resolve('support')} class={styles.inlineLink}>Support</a> page.
				</p>
			</section>
		</div>

		<footer class={styles.footer}>
			<p>© Scraps Cache. MIT Licensed.</p>
			<div class={styles.footerLinks}>
				<a href={resolve('terms')} class={styles.footerLink}>Terms of Service</a>
				<a href={resolve('support')} class={styles.footerLink}>Support</a>
				<a href={resolve('')} class={styles.footerLink}>Home</a>
			</div>
		</footer>
	</main>
</div>
