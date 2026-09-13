<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { encryptSharedNote, createShareUrl } from '$lib/shareCrypto';
	import type { Note } from '$lib/types';
	import QRCode from 'qrcode';
	import { Check, Copy, Flame, Lock, QrCode, Share2, X, Clock, ExternalLink } from '@lucide/svelte';

	let {
		note,
		onClose
	}: {
		note: Note;
		onClose: () => void;
	} = $props();

	let lifetimeMs = $state(24 * 60 * 60 * 1000); // 24 hours
	let burnAfterReading = $state(false);
	let busy = $state(false);
	let error = $state('');
	let shareUrl = $state<string | null>(null);
	let copied = $state(false);
	let showQr = $state(false);
	let qrDataUrl = $state<string | null>(null);

	const lifetimeOptions = [
		{ label: '1 hour', value: 60 * 60 * 1000 },
		{ label: '24 hours', value: 24 * 60 * 60 * 1000 },
		{ label: '7 days', value: 7 * 24 * 60 * 60 * 1000 },
		{ label: '30 days', value: 30 * 24 * 60 * 60 * 1000 }
	];

	async function handleCreateShare() {
		busy = true;
		error = '';

		try {
			// Ensure attachments are hydrated
			await notesStore.ensureNoteAttachments(note.id);

			// Fresh note snapshot from store if available
			const currentNote = notesStore.notes.find((n) => n.id === note.id) ?? note;

			// Gather label names
			const labelNames = (currentNote.labels ?? [])
				.map((id) => notesStore.labels.find((l) => l.id === id)?.name)
				.filter((name): name is string => Boolean(name));

			// Client-side encryption with local symmetric key
			const { ciphertext, key } = encryptSharedNote(currentNote, labelNames);

			// Post ciphertext to server
			const res = await fetch('/api/share', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					ciphertext,
					burnAfterReading,
					expiresInMs: lifetimeMs
				})
			});

			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(data.error || `Server responded with ${res.status}`);
			}

			const { id } = (await res.json()) as { id: string };
			const origin = window.location.origin;
			const generatedUrl = createShareUrl(origin, id, key);
			shareUrl = generatedUrl;

			// Generate QR code
			try {
				const svg = await QRCode.toString(generatedUrl, {
					type: 'svg',
					width: 200,
					margin: 1,
					errorCorrectionLevel: 'M'
				});
				qrDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
			} catch {
				// QR failure is non-fatal
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create share link';
		} finally {
			busy = false;
		}
	}

	async function copyLink() {
		if (!shareUrl) return;
		try {
			await navigator.clipboard.writeText(shareUrl);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2500);
		} catch {
			// fallback
		}
	}

	function handleOpenChange(details: { open: boolean }) {
		if (!details.open && !busy) onClose();
	}
</script>

<Dialog.Root
	open
	onOpenChange={handleOpenChange}
	closeOnEscape={!busy}
	closeOnInteractOutside={!busy}
	preventScroll={false}
>
	<div {@attach portalToAppOverlay} class="absolute inset-0 z-[70]" role="presentation">
		<Dialog.Backdrop class="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
		<Dialog.Positioner
			class="absolute inset-0 flex items-start justify-center overflow-y-auto px-4 pb-4 pt-[calc(var(--app-topbar-height)+0.5rem)]"
		>
			<Dialog.Content class="scrapscache-dialog w-full max-w-md p-5 text-[var(--scrapscache-text)]">
				<div class="mb-4 flex items-start justify-between gap-3">
					<div class="flex items-center gap-2">
						<div
							class="grid h-8 w-8 place-items-center rounded-lg bg-[var(--scrapscache-surface-tonal)] text-[var(--scrapscache-accent)]"
						>
							<Share2 class="h-4 w-4" />
						</div>
						<div>
							<Dialog.Title class="text-base font-semibold text-[var(--scrapscache-text)]">
								Share Note
							</Dialog.Title>
							<p class="text-xs text-[var(--scrapscache-text-muted)]">
								Zero-knowledge encrypted secret link
							</p>
						</div>
					</div>
					<Dialog.CloseTrigger
						type="button"
						class="icon-btn h-8 w-8 shrink-0 p-1.5"
						aria-label="Close share dialog"
						disabled={busy}
						onclick={onClose}
					>
						<X class="h-4 w-4" aria-hidden="true" />
					</Dialog.CloseTrigger>
				</div>

				{#if error}
					<div
						class="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400"
					>
						{error}
					</div>
				{/if}

				{#if !shareUrl}
					<!-- Configuration form -->
					<div class="space-y-4">
						<div
							class="flex items-start gap-2.5 rounded-lg border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface-tonal)] p-3 text-xs text-[var(--scrapscache-text-muted)]"
						>
							<Lock class="mt-0.5 h-4 w-4 shrink-0 text-[var(--scrapscache-accent)]" />
							<p class="leading-relaxed">
								Your note is encrypted directly on your device before sending. The decryption key
								stays in the URL fragment (<code class="font-mono text-[11px]">#key</code>) and is
								never seen by the server.
							</p>
						</div>

						<!-- Expiration selection -->
						<div>
							<label
								for="share-expiry-select"
								class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--scrapscache-text)]"
							>
								<Clock class="h-3.5 w-3.5 text-[var(--scrapscache-text-muted)]" />
								Link lifetime
							</label>
							<select
								id="share-expiry-select"
								bind:value={lifetimeMs}
								disabled={busy}
								class="w-full rounded-lg border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] px-3 py-2 text-xs text-[var(--scrapscache-text)] focus:border-[var(--scrapscache-accent)] focus:outline-none"
							>
								{#each lifetimeOptions as opt}
									<option value={opt.value}>{opt.label}</option>
								{/each}
							</select>
						</div>

						<!-- Burn after reading toggle -->
						<label
							class="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--scrapscache-border)] p-3 hover:bg-[var(--scrapscache-surface-tonal)] transition-colors"
						>
							<input
								type="checkbox"
								bind:checked={burnAfterReading}
								disabled={busy}
								class="mt-1 h-4 w-4 rounded border-[var(--scrapscache-border)] text-[var(--scrapscache-accent)] focus:ring-[var(--scrapscache-accent)]"
							/>
							<div class="text-xs">
								<div class="flex items-center gap-1 font-medium text-[var(--scrapscache-text)]">
									<Flame class="h-3.5 w-3.5 text-amber-500" />
									Burn after reading
								</div>
								<p class="mt-0.5 text-[var(--scrapscache-text-muted)] leading-relaxed">
									Permanently destroys the note from the server immediately after it is opened once.
								</p>
							</div>
						</label>

						<div class="flex justify-end gap-2 pt-2">
							<button
								type="button"
								class="scrapscache-button min-h-9 px-4 text-xs"
								disabled={busy}
								onclick={onClose}
							>
								Cancel
							</button>
							<button
								type="button"
								class="scrapscache-button scrapscache-button-primary min-h-9 px-4 text-xs font-medium"
								disabled={busy}
								onclick={handleCreateShare}
							>
								{busy ? 'Encrypting & Sharing...' : 'Create Secret Link'}
							</button>
						</div>
					</div>
				{:else}
					<!-- Share Link Result -->
					<div class="space-y-4">
						{#if burnAfterReading}
							<div
								class="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400"
							>
								<Flame class="h-4 w-4 shrink-0" />
								<span>This is a single-view note. Opening the link once deletes it forever.</span>
							</div>
						{/if}

						<div>
							<label
								for="share-link-input"
								class="mb-1.5 block text-xs font-medium text-[var(--scrapscache-text)]"
							>
								Secret Link
							</label>
							<div class="flex items-center gap-2">
								<input
									id="share-link-input"
									type="text"
									readonly
									value={shareUrl}
									class="flex-1 rounded-lg border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface-tonal)] px-3 py-2 font-mono text-xs text-[var(--scrapscache-text)] select-all focus:outline-none"
								/>
								<button
									type="button"
									class="scrapscache-button scrapscache-button-primary flex items-center gap-1.5 min-h-9 px-3 text-xs"
									onclick={copyLink}
								>
									{#if copied}
										<Check class="h-3.5 w-3.5" />
										<span>Copied</span>
									{:else}
										<Copy class="h-3.5 w-3.5" />
										<span>Copy</span>
									{/if}
								</button>
							</div>
						</div>

						<div class="flex items-center justify-between pt-1">
							{#if qrDataUrl}
								<button
									type="button"
									class="inline-flex items-center gap-1.5 text-xs text-[var(--scrapscache-text-muted)] hover:text-[var(--scrapscache-text)]"
									onclick={() => (showQr = !showQr)}
								>
									<QrCode class="h-3.5 w-3.5" />
									<span>{showQr ? 'Hide QR Code' : 'Show QR Code'}</span>
								</button>
							{/if}

							<a
								href={shareUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex items-center gap-1 text-xs text-[var(--scrapscache-accent)] hover:underline ml-auto"
							>
								<span>Open Preview</span>
								<ExternalLink class="h-3.5 w-3.5" />
							</a>
						</div>

						{#if showQr && qrDataUrl}
							<div
								class="flex flex-col items-center justify-center rounded-lg border border-[var(--scrapscache-border)] bg-white p-4"
							>
								<img src={qrDataUrl} alt="QR Code for shared note" class="h-48 w-48" />
								<p class="mt-2 text-[11px] text-zinc-600 font-medium">Scan with camera to open</p>
							</div>
						{/if}

						<div class="flex justify-end pt-2">
							<button
								type="button"
								class="scrapscache-button min-h-9 px-4 text-xs"
								onclick={onClose}
							>
								Done
							</button>
						</div>
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
