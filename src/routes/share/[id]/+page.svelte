<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { parseShareHash, decryptSharedNote, type SharedNoteData } from '$lib/shareCrypto';
	import type { NoteImage } from '$lib/types';
	import { NOTE_COLORS, NOTE_DARK_COLORS, type NoteColor } from '$lib/types';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { parseBody } from '$lib/checklistBody';
	import { isImageAttachment, fileIconLabel } from '$lib/noteImages';
	import { isCanvasAttachment } from '$lib/canvasAttachment';
	import { displayImageSrc } from '$lib/imageThumb';
	import { extractHttpUrls, localLinkCard } from '$lib/linkPreview';
	import {
		AlertCircle,
		ArrowLeft,
		Check,
		Clock,
		Copy,
		Download,
		ExternalLink,
		Flame,
		FolderPlus,
		Lock,
		Moon,
		ShieldCheck,
		Sun
	} from '@lucide/svelte';
	import { onMount } from 'svelte';

	let loading = $state(true);
	let error = $state<string | null>(null);
	let burnedOrExpired = $state(false);
	let note = $state<SharedNoteData | null>(null);
	let burnAfterReading = $state(false);
	let expiresAt = $state<number | null>(null);
	let copied = $state(false);
	let imported = $state(false);
	let importing = $state(false);
	let localChecked = $state<Record<number, boolean>>({});

	function bgColor(c: NoteColor): string {
		return uiStore.effectiveDark ? NOTE_DARK_COLORS[c] : NOTE_COLORS[c];
	}

	onMount(async () => {
		const hash = window.location.hash;
		const key = parseShareHash(hash);
		if (!key) {
			loading = false;
			error =
				'Missing decryption key in URL. Make sure you opened the complete link including the #key fragment.';
			return;
		}

		const id = page.params.id;
		try {
			const res = await fetch(`/api/share/${id}`);
			if (res.status === 404) {
				loading = false;
				burnedOrExpired = true;
				return;
			}
			if (!res.ok) {
				loading = false;
				error = 'Failed to load shared note from server.';
				return;
			}
			const data = await res.json();
			note = decryptSharedNote(data.ciphertext, key);
			burnAfterReading = !!data.burnAfterReading;
			expiresAt = data.expiresAt;
		} catch (err) {
			console.error(err);
			error =
				'Could not decrypt note. The decryption key may be invalid or the payload was corrupted.';
		} finally {
			loading = false;
		}
	});

	const segments = $derived(parseBody(note?.body ?? ''));
	const images = $derived(note?.images ?? []);
	const canvases = $derived(images.filter(isCanvasAttachment));
	const photos = $derived(images.filter(isImageAttachment));
	const files = $derived(
		images.filter((a: NoteImage) => !isImageAttachment(a) && !isCanvasAttachment(a))
	);
	const links = $derived(extractHttpUrls(note?.body ?? ''));

	function isChecked(lineIndex: number, originalChecked: boolean): boolean {
		return localChecked[lineIndex] ?? originalChecked;
	}

	function toggleCheck(lineIndex: number, originalChecked: boolean) {
		localChecked[lineIndex] = !isChecked(lineIndex, originalChecked);
	}

	async function handleCopy() {
		if (!note) return;
		const text = note.title ? `${note.title}\n\n${note.body}` : note.body;
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 1500);
		} catch {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			try {
				document.execCommand('copy');
				copied = true;
				setTimeout(() => {
					copied = false;
				}, 1500);
			} catch {}
			document.body.removeChild(ta);
		}
	}

	async function handleImport() {
		if (!note || importing || imported) return;
		importing = true;
		try {
			await notesStore.init();
			const labelIds: string[] = [];
			if (note.labelNames && note.labelNames.length > 0) {
				for (const name of note.labelNames) {
					const existing = notesStore.labels.find(
						(l) => l.name.toLowerCase() === name.toLowerCase()
					);
					if (existing) {
						labelIds.push(existing.id);
					} else {
						const created = notesStore.createLabel(name);
						if (created) labelIds.push(created.id);
					}
				}
			}

			const created = notesStore.createNote({
				title: note.title,
				body: note.body,
				color: note.color,
				labels: labelIds,
				images: note.images,
				linkPreviews: note.linkPreviews
			});
			imported = true;
			setTimeout(() => {
				void goto(`/?note=${created.id}`);
			}, 600);
		} catch (err) {
			console.error('Failed to import note:', err);
			alert('Failed to import note into Scraps Cache.');
		} finally {
			importing = false;
		}
	}

	function formatExpiration(timestamp: number): string {
		const diff = timestamp - Date.now();
		if (diff <= 0) return 'Expired';
		const hours = Math.floor(diff / (1000 * 60 * 60));
		const days = Math.floor(hours / 24);
		if (days > 1) return `Expires in ${days} days`;
		if (hours >= 1) return `Expires in ${hours} hour${hours > 1 ? 's' : ''}`;
		const minutes = Math.max(1, Math.floor(diff / (1000 * 60)));
		return `Expires in ${minutes} minute${minutes > 1 ? 's' : ''}`;
	}
</script>

<svelte:head>
	<title>{note?.title ? `${note.title} • Scraps Cache` : 'Shared Note • Scraps Cache'}</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-[var(--scrapscache-bg)] text-[var(--scrapscache-text)]">
	<!-- Top App Header -->
	<header
		class="sticky top-0 z-30 flex items-center justify-between border-b border-black/5 bg-[var(--scrapscache-surface)]/80 px-4 py-3 backdrop-blur-md dark:border-white/10"
	>
		<a
			href="/"
			class="flex items-center gap-2 font-semibold tracking-tight text-[var(--scrapscache-text)] transition-opacity hover:opacity-80"
		>
			<div
				class="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 font-bold text-white shadow-xs"
			>
				S
			</div>
			<span>Scraps Cache</span>
		</a>

		<div class="flex items-center gap-2">
			<button
				type="button"
				class="flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 text-[var(--scrapscache-text-muted)] transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
				onclick={() => uiStore.toggleDark()}
				aria-label="Toggle theme"
			>
				{#if uiStore.effectiveDark}
					<Sun class="h-4 w-4" />
				{:else}
					<Moon class="h-4 w-4" />
				{/if}
			</button>
			<a
				href="/"
				class="hidden items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-[var(--scrapscache-text)] transition-colors hover:bg-black/5 sm:flex dark:border-white/10 dark:hover:bg-white/5"
			>
				<ArrowLeft class="h-3.5 w-3.5" />
				Open Scraps Cache
			</a>
		</div>
	</header>

	<!-- Main Container -->
	<main class="flex flex-1 items-start justify-center p-4 sm:p-6 md:p-8">
		<div class="w-full max-w-2xl">
			{#if loading}
				<!-- Loading state -->
				<div class="flex flex-col items-center justify-center py-20 text-center">
					<div
						class="h-10 w-10 animate-spin rounded-full border-3 border-emerald-500 border-t-transparent"
					></div>
					<p class="mt-4 text-sm font-medium text-[var(--scrapscache-text-muted)]">
						Decrypting shared note on your device…
					</p>
				</div>
			{:else if burnedOrExpired}
				<!-- Burned or Expired state -->
				<div
					class="mx-auto max-w-md rounded-2xl border border-black/10 bg-[var(--scrapscache-surface)] p-8 text-center shadow-lg dark:border-white/10"
				>
					<div
						class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-500"
					>
						<Flame class="h-8 w-8" />
					</div>
					<h1 class="mt-4 text-xl font-bold tracking-tight text-[var(--scrapscache-text)]">
						Note unavailable
					</h1>
					<p class="mt-2 text-sm text-[var(--scrapscache-text-muted)]">
						This secret note has expired or was already read and permanently deleted from the
						server.
					</p>
					<div class="mt-6">
						<a
							href="/"
							class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-500"
						>
							Go to Scraps Cache
						</a>
					</div>
				</div>
			{:else if error}
				<!-- Error state -->
				<div
					class="mx-auto max-w-md rounded-2xl border border-red-500/20 bg-[var(--scrapscache-surface)] p-8 text-center shadow-lg"
				>
					<div
						class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-500"
					>
						<AlertCircle class="h-8 w-8" />
					</div>
					<h1 class="mt-4 text-xl font-bold tracking-tight text-[var(--scrapscache-text)]">
						Could not open note
					</h1>
					<p class="mt-2 text-sm text-[var(--scrapscache-text-muted)]">
						{error}
					</p>
					<div class="mt-6">
						<a
							href="/"
							class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-500"
						>
							Go to Scraps Cache
						</a>
					</div>
				</div>
			{:else if note}
				<!-- Decrypted Note Presentation -->
				<article
					class="overflow-hidden rounded-2xl border border-black/10 shadow-xl transition-colors dark:border-white/10"
					style="background-color: {bgColor(note.color)}"
				>
					<!-- Status Banner Header -->
					<div
						class="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 bg-black/5 px-5 py-2.5 dark:border-white/5 dark:bg-white/5"
					>
						<div class="flex flex-wrap items-center gap-2">
							{#if burnAfterReading}
								<span
									class="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400"
								>
									<Flame class="h-3.5 w-3.5" />
									Burn after reading (deleted from server)
								</span>
							{:else}
								<span
									class="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400"
								>
									<ShieldCheck class="h-3.5 w-3.5" />
									End-to-end encrypted
								</span>
							{/if}
							{#if expiresAt}
								<span
									class="inline-flex items-center gap-1 text-xs text-[var(--scrapscache-text-muted)]"
								>
									<Clock class="h-3 w-3" />
									{formatExpiration(expiresAt)}
								</span>
							{/if}
						</div>

						<div class="flex items-center gap-1.5">
							<button
								type="button"
								class="inline-flex items-center gap-1.5 rounded-lg bg-black/10 px-2.5 py-1 text-xs font-medium text-[var(--scrapscache-text)] transition-colors hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/15"
								onclick={handleCopy}
							>
								{#if copied}
									<Check class="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
									<span>Copied!</span>
								{:else}
									<Copy class="h-3.5 w-3.5" />
									<span>Copy text</span>
								{/if}
							</button>
						</div>
					</div>

					<!-- Note Content -->
					<div class="p-6 sm:p-8">
						{#if note.title}
							<h1
								class="mb-3 break-words text-2xl font-bold tracking-tight text-[var(--scrapscache-text)] sm:text-3xl"
							>
								{note.title}
							</h1>
						{/if}

						{#if note.labelNames && note.labelNames.length > 0}
							<div class="mb-4 flex flex-wrap gap-1.5">
								{#each note.labelNames as label}
									<span
										class="rounded-md bg-black/10 px-2 py-0.5 text-xs font-medium text-[var(--scrapscache-text-muted)] dark:bg-white/10"
									>
										{label}
									</span>
								{/each}
							</div>
						{/if}

						<!-- Checklist and Plaintext Body -->
						<div class="space-y-1 text-base leading-relaxed text-[var(--scrapscache-text)]">
							{#each segments as seg (seg.lineIndex)}
								{#if seg.type === 'check'}
									<button
										type="button"
										class="flex w-full text-left items-start gap-3 py-1 cursor-pointer select-none"
										onclick={() => toggleCheck(seg.lineIndex, seg.checked)}
										style={seg.indent > 0 ? `padding-left: ${seg.indent * 1.5}rem` : undefined}
									>
										<span
											class="checklist-toggle mt-0.5 shrink-0"
											class:checked={isChecked(seg.lineIndex, seg.checked)}
											aria-hidden="true"
										>
											{#if isChecked(seg.lineIndex, seg.checked)}
												<svg viewBox="0 0 16 16" class="checklist-toggle-mark">
													<path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
												</svg>
											{/if}
										</span>
										<span
											class="flex-1 break-words {isChecked(seg.lineIndex, seg.checked)
												? 'line-through opacity-50'
												: ''}"
										>
											{seg.text || '\u00a0'}
										</span>
									</button>
								{:else if seg.type === 'bullet'}
									<div
										class="flex items-start gap-2.5 py-0.5"
										style={seg.indent > 0 ? `padding-left: ${seg.indent * 1.5}rem` : undefined}
									>
										<span class="shrink-0 select-none text-[var(--scrapscache-text-muted)]">•</span>
										<span class="flex-1 break-words">{seg.text || '\u00a0'}</span>
									</div>
								{:else if seg.text}
									<p class="whitespace-pre-wrap break-words py-0.5">{seg.text}</p>
								{:else}
									<div class="h-3"></div>
								{/if}
							{/each}
						</div>

						<!-- Canvases -->
						{#if canvases.length > 0}
							<div class="mt-6">
								<h2
									class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--scrapscache-text-muted)]"
								>
									Canvases
								</h2>
								<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
									{#each canvases as canvas (canvas.id)}
										<div
											class="overflow-hidden rounded-xl border border-black/10 bg-white shadow-xs dark:border-white/10 dark:bg-slate-900"
										>
											{#if displayImageSrc(canvas)}
												<img
													src={displayImageSrc(canvas)}
													alt={canvas.name ?? 'Canvas'}
													class="aspect-[4/3] w-full object-contain"
												/>
											{/if}
											<div
												class="flex items-center justify-between border-t border-black/5 bg-black/5 px-3 py-2 text-xs font-medium dark:border-white/5 dark:bg-white/5"
											>
												<span class="truncate">{canvas.name ?? 'Canvas'}</span>
												{#if canvas.dataUrl}
													<a
														href={canvas.dataUrl}
														download={canvas.name || 'canvas.png'}
														class="flex items-center gap-1 text-emerald-600 hover:underline dark:text-emerald-400"
													>
														<Download class="h-3.5 w-3.5" />
														Download
													</a>
												{/if}
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Photos -->
						{#if photos.length > 0}
							<div class="mt-6">
								<h2
									class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--scrapscache-text-muted)]"
								>
									Photos
								</h2>
								<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
									{#each photos as photo (photo.id)}
										<div
											class="group relative aspect-square overflow-hidden rounded-xl border border-black/10 bg-black/5 shadow-xs dark:border-white/10 dark:bg-white/5"
										>
											{#if displayImageSrc(photo)}
												<img
													src={displayImageSrc(photo)}
													alt={photo.name ?? 'Photo'}
													class="h-full w-full object-cover transition-transform group-hover:scale-105"
												/>
											{/if}
											{#if photo.dataUrl}
												<a
													href={photo.dataUrl}
													download={photo.name || 'photo'}
													class="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white shadow-sm opacity-90 transition-opacity hover:opacity-100"
													title="Download photo"
													aria-label="Download photo"
												>
													<Download class="h-4 w-4" />
												</a>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Files -->
						{#if files.length > 0}
							<div class="mt-6">
								<h2
									class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--scrapscache-text-muted)]"
								>
									Attachments
								</h2>
								<div class="space-y-2">
									{#each files as file (file.id)}
										<div
											class="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-black/5 p-3 dark:border-white/10 dark:bg-white/5"
										>
											<div class="flex items-center gap-3 min-w-0">
												<span
													class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-black/10 text-xs font-bold dark:bg-white/10"
												>
													{fileIconLabel(file.mime, file.name)}
												</span>
												<div class="min-w-0">
													<div class="truncate text-sm font-medium text-[var(--scrapscache-text)]">
														{file.name || 'Attachment'}
													</div>
													<div class="text-xs text-[var(--scrapscache-text-muted)]">
														{file.mime || 'application/octet-stream'}
													</div>
												</div>
											</div>
											{#if file.dataUrl}
												<a
													href={file.dataUrl}
													download={file.name || 'file'}
													class="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-500"
												>
													<Download class="h-3.5 w-3.5" />
													<span>Save</span>
												</a>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Links -->
						{#if links.length > 0}
							<div class="mt-6">
								<h2
									class="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--scrapscache-text-muted)]"
								>
									Links
								</h2>
								<div class="space-y-2">
									{#each links as url (url)}
										{@const card = localLinkCard(url)}
										<a
											href={url}
											target="_blank"
											rel="noreferrer noopener"
											class="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-black/5 p-3 transition-colors hover:bg-black/10 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
										>
											<div class="min-w-0 flex-1">
												<div class="truncate text-sm font-medium text-[var(--scrapscache-text)]">
													{card?.hostname ?? url}
												</div>
												<div class="truncate text-xs text-[var(--scrapscache-text-muted)]">
													{card?.path || url}
												</div>
											</div>
											<ExternalLink class="h-4 w-4 shrink-0 text-[var(--scrapscache-text-muted)]" />
										</a>
									{/each}
								</div>
							</div>
						{/if}
					</div>

					<!-- Bottom Action Callout -->
					<div
						class="flex flex-col items-center justify-between gap-4 border-t border-black/10 bg-black/5 p-6 sm:flex-row dark:border-white/10 dark:bg-white/5"
					>
						<div>
							<div class="text-sm font-semibold text-[var(--scrapscache-text)]">
								Want to keep this note?
							</div>
							<div class="text-xs text-[var(--scrapscache-text-muted)]">
								Save it directly into your own private Scraps Cache.
							</div>
						</div>

						<button
							type="button"
							class="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-500 sm:w-auto"
							disabled={importing || imported}
							onclick={handleImport}
						>
							{#if imported}
								<Check class="h-4 w-4" />
								<span>Imported to Scraps Cache!</span>
							{:else if importing}
								<div
									class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
								></div>
								<span>Importing…</span>
							{:else}
								<FolderPlus class="h-4 w-4" />
								<span>Import to Scraps Cache</span>
							{/if}
						</button>
					</div>
				</article>
			{/if}
		</div>
	</main>
</div>
