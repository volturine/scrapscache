<script lang="ts">
	import NotesFeed from '$lib/components/NotesFeed.svelte';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { useEditorActions } from '$lib/editorContext';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { StickyNote } from '@lucide/svelte';

	const { openNote: openEditor, startNewNote } = useEditorActions();

	const pinned = $derived(notesStore.pinnedNotes);
	const others = $derived(notesStore.unpinnedNotes);
	const search = $derived(uiStore.search);
	const filteredPinned = $derived(search ? notesStore.search(search, pinned) : pinned);
	const filteredOthers = $derived(search ? notesStore.search(search, others) : others);
</script>

<div class="pt-4 pb-8">
	{#if filteredPinned.length === 0 && filteredOthers.length === 0}
		<EmptyState
			icon={StickyNote}
			description={search
				? 'No notes found'
				: 'Capture an idea, task, or anything you want to keep.'}
			actionLabel={search ? undefined : 'Take a note'}
			onAction={search ? undefined : startNewNote}
		/>
	{:else}
		{#if filteredPinned.length > 0}
			<SectionHeader label="Pinned" count={filteredPinned.length} />
			<NotesFeed
				notes={filteredPinned}
				onOpen={openEditor}
				class={filteredOthers.length > 0 ? 'mb-8' : ''}
			/>
		{/if}

		{#if filteredOthers.length > 0}
			{#if filteredPinned.length > 0}
				<SectionHeader label="Others" count={filteredOthers.length} class="mt-6" />
			{/if}
			<NotesFeed notes={filteredOthers} onOpen={openEditor} />
		{/if}
	{/if}
</div>
