<script lang="ts">
	// The phone top bar's title: the view's name, and a menu of every place and label to
	// go to instead, the way a workspace picker lists workspaces.
	import { placePickerStyles as styles, popover, settingsMenuStyles } from '$panda/styles';
	import { Menu } from '@ark-ui/svelte/menu';
	import { goto } from '$app/navigation';
	import {
		AlarmClock,
		Archive,
		Check,
		ChevronDown,
		Kanban,
		Pencil,
		StickyNote,
		Tag,
		Trash2,
		type LucideIcon
	} from '@lucide/svelte';
	import { useEditorActions } from '#lib/editorContext.js';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { uiStore, type View } from '#lib/stores/ui.svelte.js';
	import { pathForView } from '#lib/viewRoutes.js';
	import { cx } from 'styled-system/css';
	import { menuItem } from 'styled-system/recipes';

	let { title }: { title: string } = $props();

	const { closeNote } = useEditorActions();
	const PLACES: { view: Exclude<View, 'label'>; name: string; icon: LucideIcon }[] = [
		{ view: 'notes', name: 'Notes', icon: StickyNote },
		{ view: 'reminders', name: 'Reminders', icon: AlarmClock },
		{ view: 'kanban', name: 'Kanban', icon: Kanban },
		{ view: 'archive', name: 'Archive', icon: Archive },
		{ view: 'trash', name: 'Trash', icon: Trash2 }
	];
	const id = $props.id();
	const placesId = `${id}-places`;
	const labelsId = `${id}-labels`;
	const itemClass = cx(menuItem({ density: 'compact' }), settingsMenuStyles.row, styles.item);

	let open = $state(false);
	/** The shown place as a menu value: a view, or `label:<id>` for a label's view. */
	const current = $derived(
		uiStore.view === 'label' ? `label:${uiStore.activeLabelId}` : uiStore.view
	);
	const labelCounts = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const note of notesStore.activeNotes) {
			for (const labelId of note.labels) counts.set(labelId, (counts.get(labelId) ?? 0) + 1);
		}
		return counts;
	});

	function go(value: string) {
		if (value === current) return;
		const labelId = value.startsWith('label:') ? value.slice('label:'.length) : null;
		const view: View = labelId ? 'label' : (value as View);
		const target = pathForView(view, labelId);
		if (!target) return;
		closeNote();
		uiStore.setView(view, labelId);
		void goto(target);
	}
</script>

<Menu.Root bind:open positioning={{ placement: 'bottom-start' }} lazyMount unmountOnExit>
	<Menu.Trigger class={styles.trigger} aria-label={`${title}, go to another place or label`}>
		<span class={styles.title} data-view-title>{title}</span>
		<ChevronDown class={cx(styles.chevron, open && styles.chevronOpen)} aria-hidden="true" />
	</Menu.Trigger>
	<Menu.Positioner class={styles.positioner}>
		<Menu.Content class={cx(popover, styles.content)} aria-label="Go to">
			<Menu.RadioItemGroup
				value={current}
				onValueChange={(details) => details.value && go(details.value)}
			>
				<div role="group" aria-labelledby={placesId} class={settingsMenuStyles.section}>
					<div id={placesId} class={settingsMenuStyles.sectionLabel}>Places</div>
					{#each PLACES as place (place.view)}
						<Menu.RadioItem value={place.view} class={itemClass}>
							<place.icon class={styles.icon} aria-hidden="true" />
							<Menu.ItemText class={styles.name}>{place.name}</Menu.ItemText>
							<Menu.ItemIndicator
								><Check class={styles.check} aria-hidden="true" /></Menu.ItemIndicator
							>
						</Menu.RadioItem>
					{/each}
				</div>
				{#if notesStore.labels.length > 0}
					<div role="group" aria-labelledby={labelsId} class={settingsMenuStyles.section}>
						<div id={labelsId} class={settingsMenuStyles.sectionLabel}>Labels</div>
						{#each notesStore.labels as label (label.id)}
							{@const count = labelCounts.get(label.id) ?? 0}
							<Menu.RadioItem value={`label:${label.id}`} class={itemClass}>
								<Tag class={styles.icon} aria-hidden="true" />
								<Menu.ItemText class={styles.name}>{label.name}</Menu.ItemText>
								<Menu.ItemIndicator
									><Check class={styles.check} aria-hidden="true" /></Menu.ItemIndicator
								>
								{#if count > 0}<span class={styles.count}>{count}</span>{/if}
							</Menu.RadioItem>
						{/each}
					</div>
				{/if}
			</Menu.RadioItemGroup>
			<!-- Making, renaming and deleting labels has its own screen. -->
			<div class={styles.edit}>
				<Menu.Item
					value="edit-labels"
					class={itemClass}
					onSelect={() => (uiStore.labelsOpen = true)}
				>
					<Pencil class={styles.icon} aria-hidden="true" />
					<span class={styles.name}>Edit labels…</span>
				</Menu.Item>
			</div>
		</Menu.Content>
	</Menu.Positioner>
</Menu.Root>
