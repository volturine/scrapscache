<script lang="ts">
	// The phone's bottom tab bar: Notes, Reminders and Kanban one tap away; Labels,
	// which lists every label with Archive and Trash; and Search, which opens the
	// palette over the whole screen. In iPhone Duo's column the bar above has a
	// search field, so the pill leaves Search out.
	import { goto } from '$app/navigation';
	import { AlarmClock, Kanban, Search, StickyNote, Tag, type LucideIcon } from '@lucide/svelte';
	import { iconSizeMd as iconMd, phoneTabsStyles as styles } from '$panda/styles';
	import { useEditorActions } from '#lib/editorContext.js';
	import { uiStore, type View } from '#lib/stores/ui.svelte.js';
	import { pathForView } from '#lib/viewRoutes.js';
	import { cx } from 'styled-system/css';

	/**
	 * In iPhone Duo's status column the places stand in one pill of the column's
	 * stack, at any width: the open phone on its side has the stack and no sidebar.
	 */
	let { rail = null }: { rail?: 'left' | 'right' | null } = $props();

	const { closeNote } = useEditorActions();
	const barClass = $derived(rail ? styles.pill : styles.bar);
	const tabClass = $derived(rail ? styles.pillTab : styles.tab);
	const iconClass = $derived(rail ? styles.pillIcon : styles.tabIcon);
	const labelClass = $derived(rail ? styles.pillLabel : styles.tabLabel);

	const tabs: { view: View; label: string; icon: LucideIcon }[] = [
		{ view: 'notes', label: 'Notes', icon: StickyNote },
		{ view: 'reminders', label: 'Reminders', icon: AlarmClock },
		{ view: 'kanban', label: 'Kanban', icon: Kanban }
	];

	/** A label, Archive and Trash are reached from the Labels tab, so they belong to it. */
	const current = $derived(
		uiStore.labelsOpen || !tabs.some((tab) => tab.view === uiStore.view) ? 'labels' : uiStore.view
	);

	/**
	 * A place taken from under the palette closes it. The palette stays inside the
	 * app frame, so iPhone Duo's column keeps its places while it is up; a dialog
	 * that covers the whole screen, as sync does, covers the column too.
	 */
	function leavePalette() {
		uiStore.paletteOpen = false;
	}

	function go(view: View) {
		const target = pathForView(view);
		if (!target) return;
		closeNote();
		leavePalette();
		uiStore.labelsOpen = false;
		uiStore.setView(view);
		void goto(target);
	}

	function openLabels() {
		closeNote();
		leavePalette();
		uiStore.labelsOpen = true;
	}
</script>

<nav class={cx(barClass)} aria-label="Main" data-phone-tabs={rail ? undefined : true}>
	{#each tabs as tab (tab.view)}
		<button
			type="button"
			class={tabClass}
			aria-current={current === tab.view ? 'page' : undefined}
			onclick={() => go(tab.view)}
		>
			<span class={iconClass} data-tab-icon>
				<tab.icon class={iconMd} aria-hidden="true" />
			</span>
			<span class={labelClass}>{tab.label}</span>
		</button>
	{/each}
	<button
		type="button"
		class={tabClass}
		aria-current={current === 'labels' ? 'page' : undefined}
		onclick={openLabels}
	>
		<span class={iconClass} data-tab-icon>
			<Tag class={iconMd} aria-hidden="true" />
		</span>
		<span class={labelClass}>Labels</span>
	</button>
	{#if !rail}
		<button
			type="button"
			class={tabClass}
			aria-haspopup="dialog"
			aria-expanded={uiStore.paletteOpen}
			onclick={() => (uiStore.paletteOpen = !uiStore.paletteOpen)}
		>
			<span class={iconClass} data-tab-icon>
				<Search class={iconMd} aria-hidden="true" />
			</span>
			<span class={labelClass}>Search</span>
		</button>
	{/if}
</nav>
