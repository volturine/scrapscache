<script lang="ts">
	import {
		iconSizeSm as iconSm,
		popover,
		sidebarIcon,
		sidebarRow,
		sidebarStyles
	} from '$panda/styles';
	import { css, cx } from 'styled-system/css';
	import { button, dialog, input, menuItem } from 'styled-system/recipes';
	import { hstack, vstack } from 'styled-system/patterns';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { fly } from 'svelte/transition';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { uiStore, type View } from '$lib/stores/ui.svelte';
	import type { Label } from '$lib/types';
	import {
		AlarmClock,
		Archive,
		Kanban,
		Pencil,
		Plus,
		Search,
		StickyNote,
		Tag,
		Trash2,
		type LucideIcon
	} from '@lucide/svelte';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { pathForView } from '$lib/viewRoutes';
	import { useEditorActions } from '$lib/editorContext';

	const { closeNote } = useEditorActions();

	let { onNavigate }: { onNavigate?: () => void } = $props();

	let query = $state('');
	let queryInput = $state<HTMLInputElement | null>(null);

	let renamingId = $state<string | null>(null);
	let renamingName = $state('');
	let renameInput: HTMLInputElement | null = $state(null);

	let pendingDelete: Label | null = $state(null);
	let contextMenu = $state<{ label: Label; x: number; y: number } | null>(null);

	let swipedLabelId = $state<string | null>(null);
	let swipeOffsetX = $state(0);
	let isDraggingSwipe = $state(false);

	let trackingLabelId = $state<string | null>(null);
	let pointerStartX = 0;
	let pointerStartY = 0;
	let decidedSwipe = $state(false);
	let trackingPointerId: number | null = null;
	let wasSwipeDrag = false;

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

	const trimmed = $derived(query.trim());
	const filteredLabels = $derived.by(() => {
		if (!trimmed) return notesStore.labels;
		const q = trimmed.toLowerCase();
		return notesStore.labels.filter((l) => l.name.toLowerCase().includes(q));
	});
	const exactMatch = $derived(
		trimmed ? notesStore.labels.find((l) => l.name.toLowerCase() === trimmed.toLowerCase()) : null
	);
	const canCreate = $derived(trimmed !== '' && !exactMatch);

	type Destination = '/' | '/kanban' | '/reminders' | '/archive' | '/trash' | `/label/${string}`;

	function destination(view: View, labelId: string | null = null): Destination | null {
		return pathForView(view, labelId) as Destination | null;
	}

	function navigate(view: View, labelId: string | null = null) {
		const target = destination(view, labelId);
		if (!target) return;
		closeNote();
		uiStore.setView(view, labelId);
		onNavigate?.();
		if (target === page.url.pathname) return;

		// Navigate immediately; pendingPath only covers the highlight until
		// the route's own URL state catches up.
		uiStore.pendingPath = target;
		void goto(resolve(target)).finally(() => {
			if (uiStore.pendingPath === target) uiStore.pendingPath = null;
		});
	}

	function isActive(view: View, labelId: string | null = null): boolean {
		const target = destination(view, labelId);
		if (!target) return false;
		return uiStore.pendingPath ? uiStore.pendingPath === target : page.url.pathname === target;
	}

	function createAndNavigate() {
		const name = (queryInput?.value ?? query).trim();
		if (!name) return;
		const newLabel = notesStore.createLabel(name);
		query = '';
		if (newLabel) navigate('label', newLabel.id);
	}

	function submitQuery() {
		const name = (queryInput?.value ?? query).trim();
		if (!name) return;
		const existing = notesStore.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
		if (existing) {
			query = '';
			navigate('label', existing.id);
			return;
		}
		createAndNavigate();
	}

	function onQueryKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			submitQuery();
			return;
		}
		if (event.key === 'Escape' && query !== '') {
			event.preventDefault();
			event.stopPropagation();
			query = '';
		}
	}

	function startRename(label: Label) {
		pendingDelete = null;
		contextMenu = null;
		swipedLabelId = null;
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
		contextMenu = null;
		swipedLabelId = null;
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

	function handleContextMenu(e: MouseEvent, label: Label) {
		e.preventDefault();
		e.stopPropagation();
		swipedLabelId = null;
		swipeOffsetX = 0;
		contextMenu = { label, x: e.clientX, y: e.clientY };
	}

	function contextMenuStyle(x: number, y: number): string {
		const menuWidth = 160;
		const menuHeight = 88;
		const left =
			typeof window !== 'undefined' && x + menuWidth > window.innerWidth
				? Math.max(8, x - menuWidth)
				: x;
		const top =
			typeof window !== 'undefined' && y + menuHeight > window.innerHeight
				? Math.max(8, y - menuHeight)
				: y;
		return `left: ${left}px; top: ${top}px;`;
	}

	function onRowPointerDown(e: PointerEvent, labelId: string) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;

		if (swipedLabelId && swipedLabelId !== labelId) {
			swipedLabelId = null;
			swipeOffsetX = 0;
		}

		wasSwipeDrag = false;
		trackingLabelId = labelId;
		trackingPointerId = e.pointerId;
		pointerStartX = e.clientX;
		pointerStartY = e.clientY;
		decidedSwipe = false;
		isDraggingSwipe = false;
	}

	function onRowPointerMove(e: PointerEvent, labelId: string) {
		if (trackingLabelId !== labelId || trackingPointerId !== e.pointerId) return;

		const dx = e.clientX - pointerStartX;
		const dy = e.clientY - pointerStartY;

		if (!decidedSwipe) {
			if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
			if (Math.abs(dy) >= Math.abs(dx)) {
				trackingLabelId = null;
				trackingPointerId = null;
				return;
			}
			decidedSwipe = true;
			isDraggingSwipe = true;
			try {
				(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
			} catch {}
		}

		e.preventDefault();
		wasSwipeDrag = true;
		const currentBase = swipedLabelId === labelId ? -136 : 0;
		const nextX = currentBase + dx;
		swipeOffsetX = Math.max(-160, Math.min(0, nextX));
	}

	function onRowPointerUp(e: PointerEvent, labelId: string) {
		if (trackingLabelId !== labelId || trackingPointerId !== e.pointerId) return;

		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {}

		trackingLabelId = null;
		trackingPointerId = null;
		isDraggingSwipe = false;

		if (!decidedSwipe) return;

		if (swipeOffsetX <= -50) {
			swipedLabelId = labelId;
			swipeOffsetX = -136;
		} else {
			swipedLabelId = null;
			swipeOffsetX = 0;
		}

		setTimeout(() => {
			wasSwipeDrag = false;
		}, 100);
	}

	function onRowPointerCancel(e: PointerEvent, labelId: string) {
		if (trackingLabelId === labelId) {
			trackingLabelId = null;
			trackingPointerId = null;
			isDraggingSwipe = false;
			swipedLabelId = null;
			swipeOffsetX = 0;
		}
	}

	function handleLabelClick(label: Label) {
		if (wasSwipeDrag) return;
		if (swipedLabelId) {
			swipedLabelId = null;
			swipeOffsetX = 0;
			return;
		}
		navigate('label', label.id);
	}

	function onSwipeRename(label: Label) {
		swipedLabelId = null;
		swipeOffsetX = 0;
		startRename(label);
	}

	function onSwipeDelete(label: Label) {
		swipedLabelId = null;
		swipeOffsetX = 0;
		requestDelete(label);
	}

	function rowStyle(labelId: string): string | undefined {
		if (trackingLabelId === labelId && decidedSwipe) {
			return `transform: translate3d(${swipeOffsetX}px, 0, 0); transition: none;`;
		}
		if (swipedLabelId === labelId) {
			return `transform: translate3d(-136px, 0, 0); transition: transform 180ms cubic-bezier(0.2, 0, 0, 1);`;
		}
		return `transform: translate3d(0, 0, 0); transition: transform 180ms cubic-bezier(0.2, 0, 0, 1);`;
	}

	const menuRow = menuItem({ density: 'sidebar' });
	const menuItemClass = cx(
		menuItem({ density: 'compact' }),
		css({ w: 'full', textAlign: 'left', cursor: 'pointer' })
	);
	const labelInputClass = cx(input({ variant: 'unstyled' }), sidebarStyles.labelInput);
	const d = dialog({ size: 'sm' });
</script>

<aside
	class={[
		'scrollable',
		css({ scrollbarWidth: 'thin' }),
		vstack({
			h: 'full',
			gap: '3xs',
			overflowY: 'auto',
			px: 'sm',
			pb: 'lg',
			pt: 'sm'
		})
	]}
	transition:fly={{ x: -20, duration: 120 }}
>
	{#each navItems as item (item.view)}
		{@const NavIcon = item.icon}
		<button
			type="button"
			onclick={() => navigate(item.view)}
			class={[menuRow, sidebarRow({ navigation: true, active: isActive(item.view), wide: true })]}
		>
			<span class={sidebarIcon({ iconTone: 'nav' })} aria-hidden="true">
				<NavIcon size={18} strokeWidth={1.75} />
			</span>
			<span class={sidebarStyles.navLabel}>{item.label}</span>
		</button>
	{/each}

	<section class={css({ mt: 'xl', w: 'full' })} data-labels-edit aria-label="Labels">
		<div class={hstack({ mb: '2xs', h: '2rem', gap: 'sm', pl: 'lg', pr: 'sm' })}>
			<span
				class={css({
					minW: 0,
					flex: '1',
					textStyle: 'captionStrong',
					textTransform: 'uppercase',
					letterSpacing: 'eyebrow',
					color: 'scrapscache.textMuted'
				})}
			>
				Labels
			</span>
		</div>

		<!-- Search / create label input -->
		<div class={sidebarStyles.searchWrap}>
			<Search class={sidebarStyles.searchIcon} strokeWidth={1.75} aria-hidden="true" />
			<input
				bind:this={queryInput}
				type="text"
				bind:value={query}
				placeholder="Search or create a label…"
				onkeydown={onQueryKeydown}
				class={cx(input({ variant: 'outline', size: 'sm' }), sidebarStyles.searchInput)}
				aria-label="Search or create a label"
			/>
		</div>

		<!-- Create button when query doesn't match an existing label -->
		{#if canCreate}
			<button
				type="button"
				onclick={createAndNavigate}
				aria-label={`Create "${trimmed}"`}
				class={[
					menuRow,
					sidebarRow({ navigation: true, active: false }),
					sidebarStyles.createButton
				]}
			>
				<span class={sidebarIcon()} aria-hidden="true">
					<Plus size={16} strokeWidth={1.75} />
				</span>
				<span class={sidebarStyles.navLabel}>Create “{trimmed}”</span>
			</button>
		{/if}

		<div class={vstack({ gap: '3xs' })}>
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
					<div class={sidebarStyles.swipeRowContainer} data-swipe-row={label.id}>
						{#if swipedLabelId === label.id || (trackingLabelId === label.id && decidedSwipe)}
							<div class={sidebarStyles.swipeActions}>
								<button
									type="button"
									class={sidebarStyles.swipeActionRename}
									onclick={() => onSwipeRename(label)}
									aria-label={`Rename ${label.name}`}
									title="Rename"
								>
									<Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
									<span class={sidebarStyles.swipeActionText}>Rename</span>
								</button>
								<button
									type="button"
									class={sidebarStyles.swipeActionDelete}
									onclick={() => onSwipeDelete(label)}
									aria-label={`Delete ${label.name}`}
									title="Delete"
								>
									<Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
									<span class={sidebarStyles.swipeActionText}>Delete</span>
								</button>
							</div>
						{/if}
						<button
							type="button"
							onclick={() => handleLabelClick(label)}
							oncontextmenu={(e) => handleContextMenu(e, label)}
							onpointerdown={(e) => onRowPointerDown(e, label.id)}
							onpointermove={(e) => onRowPointerMove(e, label.id)}
							onpointerup={(e) => onRowPointerUp(e, label.id)}
							onpointercancel={(e) => onRowPointerCancel(e, label.id)}
							style={rowStyle(label.id)}
							class={[
								menuRow,
								sidebarRow({ navigation: true, active: isActive('label', label.id) }),
								sidebarStyles.labelRow
							]}
							aria-label={label.name}
						>
							<span class={sidebarIcon({ iconTone: 'muted' })} aria-hidden="true">
								<Tag size={16} strokeWidth={1.75} />
							</span>
							<span class={sidebarStyles.navLabel}>{label.name}</span>
							{#if (labelCounts.get(label.id) ?? 0) > 0}
								<span class={sidebarIcon({ hitPad: 'count' })}>{labelCounts.get(label.id)}</span>
							{/if}
						</button>
					</div>
				{/if}
			{/each}
		</div>
	</section>
</aside>

<svelte:window
	onpointerdown={(e) => {
		if (
			swipedLabelId &&
			!(e.target as HTMLElement | null)?.closest?.(`[data-swipe-row="${swipedLabelId}"]`)
		) {
			swipedLabelId = null;
			swipeOffsetX = 0;
		}
	}}
/>

{#if contextMenu}
	<div
		{@attach portalToAppOverlay}
		class={css({ position: 'fixed', inset: 0, zIndex: 90 })}
		role="presentation"
		onclick={() => (contextMenu = null)}
		oncontextmenu={(e) => {
			e.preventDefault();
			contextMenu = null;
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') contextMenu = null;
		}}
	>
		<div
			class={cx(popover, css({ position: 'absolute', minW: '10rem', py: '2xs', zIndex: 91 }))}
			style={contextMenuStyle(contextMenu.x, contextMenu.y)}
			role="menu"
			tabindex="-1"
			aria-label="Label options"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<button
				type="button"
				role="menuitem"
				class={menuItemClass}
				onclick={() => {
					const l = contextMenu?.label;
					contextMenu = null;
					if (l) startRename(l);
				}}
			>
				<Pencil size={14} strokeWidth={1.75} class={iconSm} aria-hidden="true" />
				<span>Rename</span>
			</button>
			<button
				type="button"
				role="menuitem"
				class={cx(menuItemClass, css({ color: 'scrapscache.danger' }))}
				onclick={() => {
					const l = contextMenu?.label;
					contextMenu = null;
					if (l) requestDelete(l);
				}}
			>
				<Trash2 size={14} strokeWidth={1.75} class={iconSm} aria-hidden="true" />
				<span>Delete</span>
			</button>
		</div>
	</div>
{/if}

{#if pendingDelete}
	<Dialog.Root
		open
		onOpenChange={(details) => !details.open && cancelDelete()}
		preventScroll={false}
	>
		<div
			{@attach portalToAppOverlay}
			class={css({ position: 'absolute', inset: 0, zIndex: 80 })}
			role="presentation"
			data-sidebar-stay-open
		>
			<Dialog.Backdrop class={d.backdrop} />
			<Dialog.Positioner
				class={css({
					position: 'absolute',
					inset: 0,
					display: 'flex',
					alignItems: { base: 'flex-end', sm: 'center' },
					justifyContent: 'center',
					p: 'lg'
				})}
				data-sidebar-stay-open
			>
				<Dialog.Content class={d.panel} data-sidebar-stay-open>
					<Dialog.Title class={d.title}>
						Delete “{pendingDelete.name}”?
					</Dialog.Title>
					<p class={d.description}>
						{#if (labelCounts.get(pendingDelete.id) ?? 0) > 0}
							This label is on {labelCounts.get(pendingDelete.id)} note{(labelCounts.get(
								pendingDelete.id
							) ?? 0) === 1
								? ''
								: 's'}.
						{:else}
							No notes currently use this label.
						{/if}
					</p>
					<div
						class={hstack({
							mt: 'lg',
							gap: 'sm',
							justifyContent: 'flex-end',
							flexWrap: 'wrap'
						})}
					>
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
						{#if (labelCounts.get(pendingDelete.id) ?? 0) > 0}
							<button
								type="button"
								class={button({ variant: 'destructive', size: 'sm' })}
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
