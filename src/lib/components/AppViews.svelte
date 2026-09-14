<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { viewForPath } from '$lib/viewRoutes';
	import NotesHomeView from '$lib/components/views/NotesHomeView.svelte';
	import LabelView from '$lib/components/views/LabelView.svelte';
	import ArchiveView from '$lib/components/views/ArchiveView.svelte';
	import TrashView from '$lib/components/views/TrashView.svelte';
	import RemindersView from '$lib/components/views/RemindersView.svelte';
	import KanbanView from '$lib/components/views/KanbanView.svelte';

	function applyPath(pathname: string) {
		const target = viewForPath(pathname);
		if (target.view !== uiStore.view || target.labelId !== uiStore.activeLabelId) {
			uiStore.setView(target.view, target.labelId);
		}
	}

	applyPath(page.url.pathname);
	afterNavigate(({ to }) => {
		if (to) applyPath(to.url.pathname);
	});
</script>

{#if uiStore.view === 'notes'}
	<NotesHomeView />
{:else if uiStore.view === 'label'}
	<LabelView />
{:else if uiStore.view === 'archive'}
	<ArchiveView />
{:else if uiStore.view === 'trash'}
	<TrashView />
{:else if uiStore.view === 'reminders'}
	<RemindersView />
{:else if uiStore.view === 'kanban'}
	<KanbanView />
{/if}
