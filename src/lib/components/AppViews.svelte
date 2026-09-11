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
	import { css } from 'styled-system/css';

	const hiddenPane = css({ display: 'none !important' });

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

{#if uiStore.opened.notes}
	<div class={uiStore.view !== 'notes' ? `hidden ${hiddenPane}` : undefined}>
		<NotesHomeView />
	</div>
{/if}
{#if uiStore.opened.label}
	<div class={uiStore.view !== 'label' ? `hidden ${hiddenPane}` : undefined}>
		<LabelView />
	</div>
{/if}
{#if uiStore.opened.archive}
	<div class={uiStore.view !== 'archive' ? `hidden ${hiddenPane}` : undefined}>
		<ArchiveView />
	</div>
{/if}
{#if uiStore.opened.trash}
	<div class={uiStore.view !== 'trash' ? `hidden ${hiddenPane}` : undefined}>
		<TrashView />
	</div>
{/if}
{#if uiStore.opened.reminders}
	<div class={uiStore.view !== 'reminders' ? `hidden ${hiddenPane}` : undefined}>
		<RemindersView />
	</div>
{/if}
{#if uiStore.opened.kanban}
	<div class={uiStore.view !== 'kanban' ? `hidden ${hiddenPane}` : undefined}>
		<KanbanView />
	</div>
{/if}
