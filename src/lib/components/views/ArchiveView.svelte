<script lang="ts">
	import NotesFeed from '#lib/components/NotesFeed.svelte';
	import SectionHeader from '#lib/components/SectionHeader.svelte';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { Archive } from '@lucide/svelte';
	import { viewHeading, viewPage } from '$panda/styles';

	const { openNote: openEditor } = useEditorActions();
	const archived = $derived(notesStore.archivedNotes);
	const search = $derived(uiStore.search);
	const visible = $derived(search ? notesStore.search(search, archived) : archived);
</script>

<div class={viewPage}>
	<h1 class={viewHeading}>Archive</h1>
	{#if archived.length === 0}
		<EmptyState
			icon={Archive}
			description="Archive notes you want to keep without showing them in Notes."
		/>
	{:else if visible.length === 0}
		<EmptyState icon={Archive} description="No notes found" />
	{:else}
		<SectionHeader label="Archive" count={visible.length} />
		<NotesFeed notes={visible} onOpen={openEditor} />
	{/if}
</div>
