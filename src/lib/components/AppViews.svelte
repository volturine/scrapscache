<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { uiStore, type View } from '#lib/stores/ui.svelte.js';
	import { viewForPath } from '#lib/viewRoutes.js';
	import NotesHomeView from '#lib/components/views/NotesHomeView.svelte';
	import LabelView from '#lib/components/views/LabelView.svelte';
	import ArchiveView from '#lib/components/views/ArchiveView.svelte';
	import TrashView from '#lib/components/views/TrashView.svelte';
	import RemindersView from '#lib/components/views/RemindersView.svelte';
	import KanbanView from '#lib/components/views/KanbanView.svelte';
	import LabelsScreen from '#lib/components/LabelsScreen.svelte';

	/** The phone's Labels screen covers the view under it, which stays mounted. */
	const shown = (view: View) => !uiStore.labelsOpen && uiStore.view === view;

	function applyPath(pathname: string) {
		const target = viewForPath(pathname);
		if (target.view !== uiStore.view || target.labelId !== uiStore.activeLabelId) {
			uiStore.setView(target.view, target.labelId);
		}
	}

	applyPath(page.url.pathname);

	afterNavigate(({ to, shallow }) => {
		if (shallow) return;
		if (to) applyPath(to.url.pathname);
	});
</script>

{#if uiStore.labelsOpen}
	<LabelsScreen />
{/if}
{#if uiStore.opened.notes}
	<div hidden={!shown('notes')}>
		<NotesHomeView />
	</div>
{/if}
{#if uiStore.opened.label}
	<div hidden={!shown('label')}>
		<LabelView />
	</div>
{/if}
{#if uiStore.opened.archive}
	<div hidden={!shown('archive')}>
		<ArchiveView />
	</div>
{/if}
{#if uiStore.opened.trash}
	<div hidden={!shown('trash')}>
		<TrashView />
	</div>
{/if}
{#if uiStore.opened.reminders}
	<div hidden={!shown('reminders')}>
		<RemindersView />
	</div>
{/if}
{#if uiStore.opened.kanban}
	<div hidden={!shown('kanban')}>
		<KanbanView />
	</div>
{/if}
