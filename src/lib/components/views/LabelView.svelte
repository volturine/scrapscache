<script lang="ts">
	import NotesFeed from '$lib/components/NotesFeed.svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { notesShellClass } from '$lib/notesShell';
	import { useEditorActions } from '$lib/editorContext';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Tag } from '@lucide/svelte';
	import { css } from 'styled-system/css';

	const { openNote: openEditor } = useEditorActions();

	const labelId = $derived(uiStore.activeLabelId);
	const label = $derived(labelId ? notesStore.labelsById.get(labelId) : undefined);
	const notes = $derived(
		label ? notesStore.activeNotes.filter((n) => n.labels.includes(label.id)) : []
	);
	const pinned = $derived(notes.filter((n) => n.pinned));
	const others = $derived(notes.filter((n) => !n.pinned));
	const shell = $derived(notesShellClass());

	const rootClass = css({
		pt: '1rem',
		pb: '2rem'
	});

	const titleClass = css({
		mb: '1rem',
		px: '0.5rem',
		fontSize: 'xl',
		fontWeight: 'medium',
		color: 'scrapscache.text'
	});

	const sectionTitleClass = css({
		mb: '0.5rem',
		fontSize: 'xs',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.025em',
		color: 'scrapscache.textMuted'
	});

	const pinnedFeedClass = css({
		mb: '1.5rem'
	});
</script>

<div class={rootClass}>
	{#if !label}
		<EmptyState
			icon={Tag}
			description="This label no longer exists."
			actionLabel="Go to Notes"
			href="/"
		/>
	{:else if notes.length === 0}
		<EmptyState
			icon={Tag}
			description="Create a note to start collecting ideas under this label."
		/>
	{:else}
		<div class={shell}>
			<h1 class={titleClass}>{label.name}</h1>
		</div>

		{#if pinned.length > 0}
			<div class={shell}>
				<h2 class={sectionTitleClass}>Pinned</h2>
			</div>
			<NotesFeed notes={pinned} onOpen={openEditor} class={pinnedFeedClass} />
		{/if}

		{#if pinned.length > 0 && others.length > 0}
			<div class={shell}>
				<h2 class={sectionTitleClass}>Others</h2>
			</div>
		{/if}

		{#if others.length > 0}
			<NotesFeed notes={others} onOpen={openEditor} />
		{/if}
	{/if}
</div>
