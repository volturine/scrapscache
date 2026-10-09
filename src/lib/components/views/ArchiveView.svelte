<script lang="ts">
	import NotesFeed from '#lib/components/NotesFeed.svelte';
	import SectionHeader from '#lib/components/SectionHeader.svelte';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { Archive } from '@lucide/svelte';
	import { viewHeading, viewPage } from '$panda/styles';

	const { openNote: openEditor } = useEditorActions();
	const archived = $derived(notesStore.archivedNotes);
</script>

<div class={viewPage}>
	<h1 class={viewHeading}>Archive</h1>
	{#if archived.length === 0}
		<EmptyState
			icon={Archive}
			description="Archive notes you want to keep without showing them in Notes."
		/>
	{:else}
		<SectionHeader label="Archive" count={archived.length} />
		<NotesFeed notes={archived} onOpen={openEditor} />
	{/if}
</div>
