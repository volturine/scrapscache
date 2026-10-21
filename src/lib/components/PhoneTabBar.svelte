<script lang="ts">
	// The phone's bottom tab bar: Notes, Reminders and Kanban one tap away, and
	// Search, which opens the palette over the whole screen.
	import { goto } from '$app/navigation';
	import { AlarmClock, Kanban, Search, StickyNote, type LucideIcon } from '@lucide/svelte';
	import { iconSizeMd as iconMd, phoneTabsStyles as styles } from '$panda/styles';
	import { useEditorActions } from '#lib/editorContext.js';
	import { uiStore, type View } from '#lib/stores/ui.svelte.js';
	import { pathForView } from '#lib/viewRoutes.js';

	const { closeNote } = useEditorActions();

	const tabs: { view: View; label: string; icon: LucideIcon }[] = [
		{ view: 'notes', label: 'Notes', icon: StickyNote },
		{ view: 'reminders', label: 'Reminders', icon: AlarmClock },
		{ view: 'kanban', label: 'Kanban', icon: Kanban }
	];

	function go(view: View) {
		const target = pathForView(view);
		if (!target) return;
		closeNote();
		uiStore.setView(view);
		void goto(target);
	}
</script>

<nav class={styles.bar} aria-label="Main" data-phone-tabs>
	{#each tabs as tab (tab.view)}
		<button
			type="button"
			class={styles.tab}
			aria-current={uiStore.view === tab.view ? 'page' : undefined}
			onclick={() => go(tab.view)}
		>
			<span class={styles.tabIcon} data-tab-icon>
				<tab.icon class={iconMd} aria-hidden="true" />
			</span>
			<span class={styles.tabLabel}>{tab.label}</span>
		</button>
	{/each}
	<button
		type="button"
		class={styles.tab}
		aria-haspopup="dialog"
		aria-expanded={uiStore.paletteOpen}
		onclick={() => (uiStore.paletteOpen = true)}
	>
		<span class={styles.tabIcon} data-tab-icon>
			<Search class={iconMd} aria-hidden="true" />
		</span>
		<span class={styles.tabLabel}>Search</span>
	</button>
</nav>
