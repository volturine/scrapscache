<script lang="ts">
	import NotesFeed from '$lib/components/NotesFeed.svelte';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { useEditorActions } from '$lib/editorContext';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { StickyNote } from '@lucide/svelte';
	import { css } from 'styled-system/css';
	import { viewPage } from '$lib/components/viewStyles';

	const { openNote: openEditor } = useEditorActions();

	const pinnedGap = css({ mb: '2rem' });
	const othersGap = css({ mt: '1.5rem' });

	const pinned = $derived(notesStore.pinnedNotes);
	const others = $derived(notesStore.unpinnedNotes);
	const search = $derived(uiStore.search);
	const filteredPinned = $derived(search ? notesStore.search(search, pinned) : pinned);
	const filteredOthers = $derived(search ? notesStore.search(search, others) : others);
</script>

<div class={viewPage}>
	{#if filteredPinned.length === 0 && filteredOthers.length === 0}
		<EmptyState
			icon={StickyNote}
			description="Capture an idea, task, or anything you want to keep."
		/>
	{:else}
		{#if filteredPinned.length > 0}
			<SectionHeader label="Pinned" count={filteredPinned.length} />
			<NotesFeed
				notes={filteredPinned}
				onOpen={openEditor}
				class={filteredOthers.length > 0 ? pinnedGap : ''}
			/>
		{/if}

		{#if filteredOthers.length > 0}
			{#if filteredPinned.length > 0}
				<SectionHeader label="Others" count={filteredOthers.length} class={othersGap} />
			{/if}
			<NotesFeed notes={filteredOthers} onOpen={openEditor} />
		{/if}
	{/if}
</div>
