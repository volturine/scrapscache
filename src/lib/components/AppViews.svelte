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
	import { cva } from 'styled-system/css';

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

	const hiddenView = cva({ base: { display: 'none !important' } });
	const hiddenViewClass = `hidden ${hiddenView()}`;
</script>

{#if uiStore.opened.notes}
	<div class={uiStore.view !== 'notes' ? hiddenViewClass : undefined}>
		<NotesHomeView />
	</div>
{/if}
{#if uiStore.opened.label}
	<div class={uiStore.view !== 'label' ? hiddenViewClass : undefined}>
		<LabelView />
	</div>
{/if}
{#if uiStore.opened.archive}
	<div class={uiStore.view !== 'archive' ? hiddenViewClass : undefined}>
		<ArchiveView />
	</div>
{/if}
{#if uiStore.opened.trash}
	<div class={uiStore.view !== 'trash' ? hiddenViewClass : undefined}>
		<TrashView />
	</div>
{/if}
{#if uiStore.opened.reminders}
	<div class={uiStore.view !== 'reminders' ? hiddenViewClass : undefined}>
		<RemindersView />
	</div>
{/if}
{#if uiStore.opened.kanban}
	<div class={uiStore.view !== 'kanban' ? hiddenViewClass : undefined}>
		<KanbanView />
	</div>
{/if}
