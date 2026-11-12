<script lang="ts">
	import PageMeta from '#lib/components/PageMeta.svelte';
	import { resolve } from '$app/paths';
	import { publicPageStyles as styles } from '$panda/styles';
	import { ArrowLeft, LifeBuoy, Mail, Bug, Cloud, Archive, Bell, Trash2 } from '@lucide/svelte';

	const email = 'support@scrapscache.com';
</script>

<PageMeta
	title="Support · Scraps Cache"
	description="Get help with Scraps Cache: contact support, report a problem, and answers about sync, backups, reminders and deleting your data."
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
				<LifeBuoy class={styles.badgeIcon} aria-hidden="true" />
				Help
			</div>
			<h1 class={styles.pageTitle}>Support</h1>
			<p class={styles.updated}>For the web app and the iPhone and iPad app.</p>
		</div>

		<div class={styles.sections}>
			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					<Mail class={styles.sectionIcon} aria-hidden="true" />
					Contact us
				</h2>
				<p class={styles.sectionCopy}>
					Write to <a href="mailto:{email}" class={styles.inlineLink}>{email}</a>. Say which device
					you use and what you expected to happen. Please never send your notes, a backup passphrase
					or a pairing code: we don't need them, and we can't read your synced notes anyway.
				</p>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					<Bug class={styles.sectionIcon} aria-hidden="true" />
					Report a problem or suggest a feature
				</h2>
				<p class={styles.sectionCopy}>
					Scraps Cache is open source. You can report a bug or ask for a feature on
					<a
						href="https://github.com/volturine/scrapscache/issues/new/choose"
						target="_blank"
						rel="noreferrer"
						class={styles.inlineLink}>GitHub</a
					>, or from the app: open the Settings menu (⋮ More on a phone) and choose Report an issue.
				</p>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					<Cloud class={styles.sectionIcon} aria-hidden="true" />
					Do I need an account? How does sync work?
				</h2>
				<p class={styles.sectionCopy}>
					No account is needed. Your notes are saved on your device and the app works offline. Sync
					between your own devices is optional. Open Sync and start syncing a workspace. Then choose
					Connect another device: it shows a QR code and a one-time code, which you scan or type on
					the other device under Join a synced workspace. Your notes are encrypted on your device
					before they are sent, so the sync service cannot read them; the
					<a href={resolve('privacy')} class={styles.inlineLink}>Privacy Policy</a> lists the few records
					it keeps to run sync.
				</p>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					<Archive class={styles.sectionIcon} aria-hidden="true" />
					Backups and a new phone
				</h2>
				<p class={styles.sectionCopy}>
					In the Settings menu (⋮ More on a phone), Back up notes… saves your notes to a file locked
					with a passphrase you choose, and Restore from a backup… brings them back, on the same or
					a new device. Keep the passphrase safe: nobody, including us, can open the file without
					it. If you sync, you can also connect the new device to your workspace instead.
				</p>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					<Bell class={styles.sectionIcon} aria-hidden="true" />
					Reminders don't alert me
				</h2>
				<p class={styles.sectionCopy}>
					Allow notifications for Scraps Cache when the app asks, or later in your device's settings
					(on iPhone and iPad: Settings › Notifications › Scraps Cache). Then check that Reminder
					alerts is on in the app's Settings menu (⋮ More on a phone) on that device.
				</p>
			</section>

			<section class={styles.section}>
				<h2 class={styles.sectionHeading}>
					<Trash2 class={styles.sectionIcon} aria-hidden="true" />
					Deleting your data
				</h2>
				<p class={styles.sectionCopy}>
					In Sync, pick the workspace: Remove from the cloud deletes the synced copy and stops
					syncing on all devices, and Delete from this device removes the workspace and its notes
					from that device. Deleting the app also deletes the notes stored on that device. See the
					<a href={resolve('privacy')} class={styles.inlineLink}>Privacy Policy</a> for what the sync
					service keeps.
				</p>
			</section>
		</div>

		<footer class={styles.footer}>
			<p>© Scraps Cache. MIT Licensed.</p>
			<div class={styles.footerLinks}>
				<a href={resolve('privacy')} class={styles.footerLink}>Privacy Policy</a>
				<a href={resolve('terms')} class={styles.footerLink}>Terms of Service</a>
				<a href={resolve('')} class={styles.footerLink}>Home</a>
			</div>
		</footer>
	</main>
</div>
