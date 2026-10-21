<script lang="ts">
	import {
		iconSizeSm as iconSm,
		noteCardHazeGroup,
		sidebarIcon,
		sidebarRow,
		sidebarStyles
	} from '$panda/styles';
	import { css, cx } from 'styled-system/css';
	import { button, dialog, iconButton, input, menuItem } from 'styled-system/recipes';
	import { hstack, vstack } from 'styled-system/patterns';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { fly } from 'svelte/transition';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { uiStore, type View } from '#lib/stores/ui.svelte.js';
	import type { Label } from '#lib/types.js';
	import {
		AlarmClock,
		Archive,
		Check,
		Kanban,
		Pencil,
		Plus,
		Search,
		StickyNote,
		Tag,
		Trash2,
		X,
		type LucideIcon
	} from '@lucide/svelte';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '#lib/appViewport.js';
	import {
		createLabelSwipe,
		labelSwipeStyle,
		labelTrayStyle,
		LABEL_TRAY_PX
	} from '#lib/labelSwipe.js';
	import { pathForView } from '#lib/viewRoutes.js';
	import { useEditorActions } from '#lib/editorContext.js';

	const { closeNote } = useEditorActions();

	let {
		onNavigate,
		labelsOnly = false
	}: {
		onNavigate?: () => void;
		/** The phone's Labels screen: its labels to make, rename and delete, without the places. */
		labelsOnly?: boolean;
	} = $props();

	let query = $state('');

	// Creating a label is its own row, apart from filtering: Enter in the filter
	// field never creates, so a half-typed name cannot become a label by accident.
	let creating = $state(false);
	let newLabelName = $state('');
	let createInput = $state<HTMLInputElement | null>(null);
	const createHintId = $props.id();

	let renamingId = $state<string | null>(null);
	let renamingName = $state('');
	let renameInput: HTMLInputElement | null = $state(null);

	let pendingDelete: Label | null = $state(null);
	let hazeLabelId = $state<string | null>(null);

	let swipeLabelId = $state<string | null>(null);
	let swipeOffsetX = $state(0);
	let swipeDragging = $state(false);
	let trayLabelId = $state<string | null>(null);

	// Touch reaches the same actions as a right click: swipe a row to the left
	// and its rename and delete buttons slide in behind it.
	const swipe = createLabelSwipe({
		setVisual: (visual) => {
			swipeLabelId = visual.labelId;
			swipeOffsetX = visual.offsetX;
			swipeDragging = visual.dragging;
		},
		setOpen: (labelId) => {
			trayLabelId = labelId;
		}
	});

	/** How far the row has drawn back for this label, if at all. */
	function swipeOffset(labelId: string): { offsetX: number; dragging: boolean } | null {
		if (swipeLabelId === labelId) return { offsetX: swipeOffsetX, dragging: swipeDragging };
		if (trayLabelId === labelId) return { offsetX: -LABEL_TRAY_PX, dragging: false };
		return null;
	}

	/** How much of the row the tray has taken; the class owns the easing. */
	function swipeStyle(labelId: string): string | undefined {
		const swiped = swipeOffset(labelId);
		return swiped ? labelSwipeStyle(swiped.offsetX, swiped.dragging) : undefined;
	}

	function trayStyle(labelId: string): string | undefined {
		const swiped = swipeOffset(labelId);
		return swiped ? labelTrayStyle(swiped.offsetX, swiped.dragging) : undefined;
	}

	const navItems: { view: View; label: string; icon: LucideIcon }[] = [
		{ view: 'notes', label: 'Notes', icon: StickyNote },
		{ view: 'kanban', label: 'Kanban', icon: Kanban },
		{ view: 'reminders', label: 'Reminders', icon: AlarmClock },
		{ view: 'archive', label: 'Archive', icon: Archive },
		{ view: 'trash', label: 'Trash', icon: Trash2 }
	];

	// One pass over active notes instead of one filter per label.
	const labelCounts = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const note of notesStore.activeNotes) {
			for (const id of note.labels) counts.set(id, (counts.get(id) ?? 0) + 1);
		}
		return counts;
	});

	/** A list this short is scanned by eye; the filter field appears above a longer one. */
	const FILTER_FROM = 8;
	const filterShown = $derived(notesStore.labels.length > FILTER_FROM);
	$effect(() => {
		// A filter typed before the list shrank must not come back once it grows again.
		if (!filterShown) query = '';
	});
	const trimmed = $derived(filterShown ? query.trim() : '');
	const filteredLabels = $derived.by(() => {
		if (!trimmed) return notesStore.labels;
		const q = trimmed.toLowerCase();
		return notesStore.labels.filter((l) => l.name.toLowerCase().includes(q));
	});

	function navigate(view: View, labelId: string | null = null) {
		const target = pathForView(view, labelId);
		if (!target) return;
		closeNote();
		uiStore.setView(view, labelId);
		onNavigate?.();
		if (target === page.url.pathname) return;

		// Navigate immediately; pendingPath only covers the highlight until
		// the route's own URL state catches up.
		uiStore.pendingPath = target;
		void goto(target).finally(() => {
			if (uiStore.pendingPath === target) uiStore.pendingPath = null;
		});
	}

	function isActive(view: View, labelId: string | null = null): boolean {
		const target = pathForView(view, labelId);
		if (!target) return false;
		return uiStore.pendingPath ? uiStore.pendingPath === target : page.url.pathname === target;
	}

	/** The + is a toggle: it opens the row, and puts an open one away again. */
	function toggleCreating() {
		if (creating) {
			stopCreating();
			return;
		}
		pendingDelete = null;
		swipe.close();
		closeHaze();
		renamingId = null;
		creating = true;
		newLabelName = '';
		queueMicrotask(() => createInput?.focus({ preventScroll: true }));
	}

	function stopCreating() {
		creating = false;
		newLabelName = '';
	}

	/** Create the typed label and open it; a name already in the list opens that label. */
	function createLabel() {
		// The field's own value: a fast tap on the tick can land before the binding settles.
		const name = (createInput?.value ?? newLabelName).trim();
		if (!name) return;
		const existing = notesStore.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
		const label = existing ?? notesStore.createLabel(name);
		stopCreating();
		if (label) navigate('label', label.id);
	}

	function onCreateKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			createLabel();
		}
	}

	/**
	 * Esc in the create row only cancels the row. The phone drawer listens for Esc on
	 * the document in the capture phase, so the row has to claim it a step earlier.
	 */
	function onWindowKeydownCapture(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !creating) return;
		if (!(event.target instanceof Element) || !event.target.closest('[data-label-create]')) return;
		event.preventDefault();
		event.stopPropagation();
		stopCreating();
	}

	/** A tap on a button beside the field must not blur it: the keyboard would start closing. */
	function keepKeyboardOpen(event: PointerEvent) {
		if (event.pointerType === 'touch') event.preventDefault();
	}

	function onQueryKeydown(event: KeyboardEvent) {
		// Enter does nothing here: the + above the list is what creates.
		if (event.key === 'Enter') event.preventDefault();
		if (event.key === 'Escape' && query !== '') {
			event.preventDefault();
			event.stopPropagation();
			query = '';
		}
	}

	function closeHaze() {
		hazeLabelId = null;
	}

	function openLabel(label: Label) {
		if (swipe.consumeDrag()) return;
		// A row showing its actions takes the next tap to put them away.
		if (trayLabelId === label.id) {
			swipe.close();
			return;
		}
		navigate('label', label.id);
	}

	function handleContextMenu(e: MouseEvent, label: Label) {
		e.preventDefault();
		e.stopPropagation();
		swipe.close();
		hazeLabelId = label.id;
	}

	function startRename(label: Label) {
		pendingDelete = null;
		swipe.close();
		closeHaze();
		renamingId = label.id;
		renamingName = label.name;
		queueMicrotask(() => {
			renameInput?.focus({ preventScroll: true });
			renameInput?.setSelectionRange(0, renamingName.length);
		});
	}

	function saveRename(label: Label) {
		if (renamingId !== label.id) return;
		const name = renamingName.trim();
		if (name && name !== label.name) notesStore.renameLabel(label.id, name);
		renamingId = null;
	}

	function cancelRename() {
		renamingId = null;
	}

	function requestDelete(label: Label) {
		renamingId = null;
		swipe.close();
		closeHaze();
		pendingDelete = label;
	}

	function confirmDeleteLabelOnly() {
		const label = pendingDelete;
		if (!label) return;
		const id = label.id;
		pendingDelete = null;
		notesStore.removeLabel(id, { deleteNotes: false });
		if (isActive('label', id)) navigate('notes');
	}

	function confirmDeleteLabelAndNotes() {
		const label = pendingDelete;
		if (!label) return;
		const id = label.id;
		pendingDelete = null;
		notesStore.removeLabel(id, { deleteNotes: true });
		if (isActive('label', id)) navigate('notes');
	}

	function cancelDelete() {
		pendingDelete = null;
	}

	const menuRow = menuItem({ density: 'sidebar' });
	const labelInputClass = cx(input({ variant: 'unstyled' }), sidebarStyles.labelInput);
	const d = dialog({ size: 'sm' });
</script>

<aside
	class={css({
		h: 'full',
		overflow: 'hidden',
		display: 'flex',
		flexDirection: 'column',
		px: 'sm',
		pt: 'sm',
		pb: 'md'
	})}
	transition:fly={{ x: -20, duration: 120 }}
>
	{#snippet placeRow(item: (typeof navItems)[number])}
		<button
			type="button"
			onclick={() => navigate(item.view)}
			class={[menuRow, sidebarRow({ navigation: true, active: isActive(item.view), wide: true })]}
		>
			<span class={sidebarIcon({ iconTone: 'nav' })} aria-hidden="true">
				<item.icon size={18} strokeWidth={1.75} />
			</span>
			<span class={sidebarStyles.navLabel}>{item.label}</span>
		</button>
	{/snippet}

	{#if !labelsOnly}
		<nav class={vstack({ gap: '3xs', flexShrink: 0, w: 'full' })} aria-label="Main navigation">
			{#each navItems as item (item.view)}
				{@render placeRow(item)}
			{/each}
		</nav>
	{/if}

	<section
		class={css({
			mt: labelsOnly ? 0 : 'lg',
			w: 'full',
			minH: 0,
			flex: '1',
			display: 'flex',
			flexDirection: 'column'
		})}
		data-labels-edit
		aria-label="Labels"
	>
		{#if labelsOnly}
			<!-- The Labels screen names itself in its own bar; making a label leads its list. -->
			<button
				type="button"
				class={[menuRow, sidebarRow({ wide: true }), css({ flexShrink: 0, mb: '3xs' })]}
				aria-label="New label"
				aria-expanded={creating}
				onclick={toggleCreating}
				data-sidebar-stay-open
			>
				<span class={sidebarIcon({ iconTone: 'nav' })} aria-hidden="true">
					<Plus size={18} strokeWidth={1.75} />
				</span>
				<span class={sidebarStyles.navLabel}>New label</span>
			</button>
		{:else}
			<div class={hstack({ mb: '2xs', h: '2rem', gap: 'sm', pl: 'lg', pr: 'sm', flexShrink: 0 })}>
				<span class={css({ minW: 0, flex: '1', textStyle: 'overline' })}>Labels</span>
				<button
					type="button"
					class={iconButton({ size: 'compact', variant: 'ghost' })}
					title="New label"
					aria-label="New label"
					aria-expanded={creating}
					onclick={toggleCreating}
					data-sidebar-stay-open
				>
					<Plus size={16} strokeWidth={1.75} aria-hidden="true" />
				</button>
			</div>
		{/if}

		{#if filterShown}
			<div class={sidebarStyles.searchWrap}>
				<Search class={sidebarStyles.searchIcon} strokeWidth={1.75} aria-hidden="true" />
				<input
					type="text"
					bind:value={query}
					placeholder="Filter labels…"
					onkeydown={onQueryKeydown}
					class={cx(input({ variant: 'outline', size: 'md' }), sidebarStyles.searchInput)}
					aria-label="Filter labels"
				/>
			</div>
		{/if}

		{#if creating}
			<div class={css({ flexShrink: 0, mb: '3xs' })} data-sidebar-stay-open data-label-create>
				<div class={[menuRow, sidebarRow({ editing: true })]}>
					<span class={sidebarIcon({ iconTone: 'muted' })} aria-hidden="true">
						<Tag size={16} strokeWidth={1.75} />
					</span>
					<input
						bind:this={createInput}
						bind:value={newLabelName}
						type="text"
						placeholder="Label name"
						aria-label="New label name"
						aria-describedby={createHintId}
						class={labelInputClass}
						onkeydown={onCreateKeydown}
					/>
					<button
						type="button"
						class={iconButton({ size: 'compact', variant: 'ghost' })}
						title="Create"
						aria-label="Create label"
						onpointerdown={keepKeyboardOpen}
						onclick={createLabel}
					>
						<Check size={16} strokeWidth={1.75} aria-hidden="true" />
					</button>
					<button
						type="button"
						class={iconButton({ size: 'compact', variant: 'ghost' })}
						title="Cancel"
						aria-label="Cancel"
						onpointerdown={keepKeyboardOpen}
						onclick={stopCreating}
					>
						<X size={16} strokeWidth={1.75} aria-hidden="true" />
					</button>
				</div>
				<p id={createHintId} class={sidebarStyles.createHint}>Enter to create, Esc to cancel</p>
			</div>
		{/if}

		<div
			class={['scrollable', sidebarStyles.labelList, vstack({ gap: '3xs', alignItems: 'stretch' })]}
		>
			{#each filteredLabels as label (label.id)}
				{#if renamingId === label.id}
					<div class={[menuRow, sidebarRow({ editing: true })]} data-sidebar-stay-open>
						<span class={sidebarIcon({ iconTone: 'muted' })} aria-hidden="true">
							<Tag size={16} strokeWidth={1.75} />
						</span>
						<input
							bind:this={renameInput}
							bind:value={renamingName}
							type="text"
							aria-label={`Rename ${label.name}`}
							class={labelInputClass}
							onblur={() => saveRename(label)}
							onkeydown={(event) => {
								if (event.key === 'Enter') saveRename(label);
								if (event.key === 'Escape') cancelRename();
							}}
						/>
					</div>
				{:else}
					<div class={sidebarStyles.labelRowContainer}>
						<button
							type="button"
							onclick={() => openLabel(label)}
							oncontextmenu={(e) => handleContextMenu(e, label)}
							onpointerdown={(e) => swipe.onPointerDown(e, label.id)}
							onpointermove={swipe.onPointerMove}
							onpointerup={swipe.onPointerUp}
							onpointercancel={swipe.onPointerCancel}
							style={swipeStyle(label.id)}
							class={[
								menuRow,
								sidebarRow({
									navigation: true,
									active: isActive('label', label.id),
									swiped: (swipeOffset(label.id)?.offsetX ?? 0) < 0
								}),
								sidebarStyles.labelSwipeRow
							]}
							aria-label={label.name}
						>
							<span class={sidebarIcon({ iconTone: 'muted' })} aria-hidden="true">
								<Tag size={16} strokeWidth={1.75} />
							</span>
							<span class={sidebarStyles.navLabel}>{label.name}</span>
							{#if labelCounts.get(label.id)}
								<span class={sidebarIcon({ hitPad: 'count' })}>
									{labelCounts.get(label.id)}
								</span>
							{/if}
						</button>

						<!-- Mounted only while some of it can show, so its buttons are out of
						     reach the rest of the time. -->
						{#if trayLabelId === label.id || (swipeLabelId === label.id && swipeOffsetX < 0)}
							<div class={sidebarStyles.labelTray} style={trayStyle(label.id)} data-label-tray>
								<button
									type="button"
									class={iconButton({ size: 'compact', variant: 'ghost' })}
									title="Rename"
									aria-label={`Rename ${label.name}`}
									onclick={(e) => {
										e.stopPropagation();
										startRename(label);
									}}
								>
									<Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
								</button>
								<button
									type="button"
									class={iconButton({ size: 'compact', variant: 'danger' })}
									title="Delete"
									aria-label={`Delete ${label.name}`}
									onclick={(e) => {
										e.stopPropagation();
										requestDelete(label);
									}}
								>
									<Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
								</button>
							</div>
						{/if}

						{#if hazeLabelId === label.id}
							<div
								class={sidebarStyles.labelHazeOverlay}
								data-label-haze
								role="presentation"
								onclick={(e) => {
									e.stopPropagation();
									closeHaze();
								}}
								onpointerdown={(e) => e.stopPropagation()}
								oncontextmenu={(e) => {
									e.preventDefault();
									e.stopPropagation();
								}}
							>
								<div class={noteCardHazeGroup.compact}>
									<button
										type="button"
										class={iconButton({ size: 'xs', variant: 'haze' })}
										title="Rename"
										aria-label={`Rename ${label.name}`}
										onclick={(e) => {
											e.stopPropagation();
											closeHaze();
											startRename(label);
										}}
									>
										<Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
									</button>
									<button
										type="button"
										class={iconButton({ size: 'xs', variant: 'hazeRose' })}
										title="Delete"
										aria-label={`Delete ${label.name}`}
										onclick={(e) => {
											e.stopPropagation();
											closeHaze();
											requestDelete(label);
										}}
									>
										<Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			{/each}
		</div>
	</section>

	{#if labelsOnly}
		<!-- The phone's tab bar has no room for these, so the Labels tab carries them. -->
		<nav class={sidebarStyles.labelsPlaces} aria-label="Archive and Trash">
			{#each navItems.filter((item) => item.view === 'archive' || item.view === 'trash') as item (item.view)}
				{@render placeRow(item)}
			{/each}
		</nav>
	{/if}
</aside>

<svelte:window
	onkeydowncapture={onWindowKeydownCapture}
	onpointerdown={(e) => {
		const target = e.target as HTMLElement | null;
		if (hazeLabelId && !target?.closest?.('[data-label-haze]')) closeHaze();
		if (trayLabelId && !target?.closest?.('[data-labels-edit]')) swipe.close();
	}}
	onkeydown={(e) => {
		if (e.key !== 'Escape') return;
		if (hazeLabelId) closeHaze();
		if (trayLabelId) swipe.close();
	}}
/>

<!-- Mounted only while it has something to confirm: its portal covers the app
     frame, so an idle one would swallow every press. -->
{#if pendingDelete}
	<Dialog.Root open onOpenChange={(e) => !e.open && cancelDelete()} preventScroll={false}>
		<div {@attach portalToAppOverlay} class={sidebarStyles.dialogPortal} role="presentation">
			<Dialog.Backdrop class={d.backdrop} />
			<Dialog.Positioner class={sidebarStyles.dialogPositioner}>
				<Dialog.Content class={d.panel} aria-describedby={undefined}>
					{@const taggedCount = labelCounts.get(pendingDelete.id) ?? 0}
					<Dialog.Title class={d.title}>
						Delete “{pendingDelete.name}”?
					</Dialog.Title>
					<Dialog.Description class={d.description}>
						{#if taggedCount > 0}
							This label is on {taggedCount} note{taggedCount === 1 ? '' : 's'}.
						{:else}
							No notes currently use this label.
						{/if}
					</Dialog.Description>
					<div class={cx(d.footer, taggedCount > 0 && sidebarStyles.stackedDialogActions)}>
						<button
							type="button"
							class={button({ variant: 'ghost', size: 'sm' })}
							onclick={cancelDelete}
						>
							Cancel
						</button>
						<button
							type="button"
							class={button({ variant: 'danger', size: 'sm' })}
							onclick={confirmDeleteLabelOnly}
						>
							Delete label only
						</button>
						{#if taggedCount > 0}
							<button
								type="button"
								class={button({ variant: 'danger', size: 'sm' })}
								onclick={confirmDeleteLabelAndNotes}
							>
								Delete label and notes
							</button>
						{/if}
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	</Dialog.Root>
{/if}
