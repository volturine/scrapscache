<script lang="ts">
	import { historicalGalleryStyles as styles, historyStyles, sidebarStyles } from '$panda/styles';
	import { button, dialog, input } from 'styled-system/recipes';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import type { Note } from '$lib/types';
	import type { HistoricalProfile } from '$lib/historyClient';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { BackupImportMode, prepareImportedNotes } from '$lib/backup';

	let { profile, onClose }: { profile: HistoricalProfile; onClose: () => void } = $props();
	let selected = $state<string[]>([]);
	let restoring = $state(false);
	let message = $state('');
	let filter = $state('');
	let previewNote = $state.raw<Note | null>(null);
	const d = dialog({ size: 'sm' });
	const notes = $derived(
		profile.snapshot.notes.filter((note) =>
			`${note.title} ${note.body}`.toLowerCase().includes(filter.toLowerCase())
		)
	);

	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
	}

	function restoreNotes(ids: string[]) {
		const accountId = syncStore.account?.accountId;
		if (!accountId || accountId !== profile.accountId || ids.length === 0) return;
		const availableLabels = new Set(notesStore.labels.map((label) => label.id));
		const selectedNotes = profile.snapshot.notes.filter((note) => ids.includes(note.id));
		for (const note of prepareImportedNotes(selectedNotes, BackupImportMode.Keep)) {
			if (syncStore.account?.accountId !== accountId) break;
			notesStore.createNote({
				...note,
				labels: note.labels.filter((id) => availableLabels.has(id))
			});
		}
		message = `Restored ${selectedNotes.length} note${selectedNotes.length === 1 ? '' : 's'} as ${selectedNotes.length === 1 ? 'a new note' : 'new notes'}.`;
		selected = [];
		previewNote = null;
	}

	async function restoreAll() {
		const accountId = syncStore.account?.accountId;
		if (
			!accountId ||
			accountId !== profile.accountId ||
			restoring ||
			!confirm('Replace the current synced profile with this historical version on all devices?')
		)
			return;
		restoring = true;
		message = '';
		const success = await notesStore.restoreHistoricalProfile(profile.snapshot, accountId);
		message = success
			? 'Profile restored and synced to your devices.'
			: 'Could not finish restoring this profile. Check sync status and try again.';
		restoring = false;
		if (success) onClose();
	}
</script>

<section class={styles.root} aria-label="Historical gallery">
	<div class={styles.bar}>
		<div>
			<h1 class={styles.heading}>Gallery on {new Date(profile.at).toLocaleString()}</h1>
			<p class={styles.meta}>Read-only preview · {profile.snapshot.notes.length} notes</p>
		</div>
		<div class={styles.actions}>
			<button type="button" class={button({ variant: 'ghost', size: 'sm' })} onclick={onClose}
				>Back to now</button
			>
			<button
				type="button"
				class={button({ variant: 'secondary', size: 'sm' })}
				onclick={() => restoreNotes(selected)}
				disabled={selected.length === 0 || restoring}>Restore selected ({selected.length})</button
			>
			<button
				type="button"
				class={button({ variant: 'primary', size: 'sm' })}
				onclick={() => void restoreAll()}
				disabled={restoring}>{restoring ? 'Restoring…' : 'Restore entire profile'}</button
			>
		</div>
	</div>
	{#if message}<p class={styles.status} role="status">{message}</p>{/if}
	<input
		class={input({ size: 'sm' })}
		aria-label="Search historical notes"
		placeholder="Search this gallery"
		bind:value={filter}
	/>
	<p class={styles.meta}>
		Select notes to restore them as copies. The entire profile action also restores labels and
		boards.
	</p>
	<div class={styles.grid}>
		{#each notes as note (note.id)}
			<article class={[styles.card, selected.includes(note.id) && styles.cardSelected]}>
				<label class={styles.selectRow}>
					<input
						type="checkbox"
						checked={selected.includes(note.id)}
						onchange={() => toggle(note.id)}
						aria-label={`Select ${note.title || 'Untitled note'}`}
					/>
					Select
				</label>
				<button
					type="button"
					class={styles.cardOpen}
					onclick={() => (previewNote = note)}
					aria-label={`Preview ${note.title || 'Untitled note'}`}
				>
					<strong class={styles.cardTitle}>{note.title || 'Untitled note'}</strong>
					{#if note.trashed}<span class={styles.meta}>In Trash</span>{:else if note.archived}<span
							class={styles.meta}>Archived</span
						>{/if}
					<span class={styles.cardBody}>{note.body || 'No text'}</span>
					{#if note.images?.[0]?.mime.startsWith('image/')}
						<img
							class={styles.cardImage}
							src={note.images[0].dataUrl}
							alt={note.images[0].name || 'Note image'}
						/>
					{/if}
				</button>
			</article>
		{/each}
	</div>
</section>

{#if previewNote}
	<Dialog.Root
		open
		onOpenChange={(details) => {
			if (!details.open) previewNote = null;
		}}
		preventScroll={false}
	>
		<div {@attach portalToAppOverlay} class={sidebarStyles.dialogPortal} role="presentation">
			<Dialog.Backdrop class={d.backdrop} />
			<Dialog.Positioner class={sidebarStyles.dialogPositioner}>
				<Dialog.Content class={d.panel} aria-describedby={undefined}>
					<Dialog.Title class={d.title}>{previewNote.title || 'Untitled note'}</Dialog.Title>
					<p class={historyStyles.previewMeta}>From {new Date(profile.at).toLocaleString()}</p>
					<div class={historyStyles.previewBody}>
						{previewNote.body || 'This note has no text.'}
					</div>
					{#if previewNote.images?.length}
						<div class={historyStyles.previewMedia}>
							{#each previewNote.images as image (image.id)}
								{#if image.mime.startsWith('image/')}<img
										class={historyStyles.previewImage}
										src={image.dataUrl}
										alt={image.name || 'Note image'}
									/>{:else}<span>{image.name || 'Attachment'}</span>{/if}
							{/each}
						</div>
					{/if}
					<div class={d.footer}>
						<button
							type="button"
							class={button({ variant: 'ghost', size: 'sm' })}
							onclick={() => (previewNote = null)}>Close</button
						>
						<button
							type="button"
							class={button({ variant: 'primary', size: 'sm' })}
							onclick={() => restoreNotes([previewNote!.id])}>Restore as new note</button
						>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	</Dialog.Root>
{/if}
