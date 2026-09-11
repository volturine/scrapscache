<script lang="ts">
	import { css, cva, cx } from 'styled-system/css';
	import { sidebar, dialog, button, input } from 'styled-system/recipes';
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
		Plus,
		StickyNote,
		Tag,
		Trash2,
		X,
		type LucideIcon
	} from '@lucide/svelte';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '$lib/appViewport';
	import { pathForView } from '$lib/viewRoutes';
	import { useEditorActions } from '$lib/editorContext';

	const { closeNote } = useEditorActions();

	let { onNavigate }: { onNavigate?: () => void } = $props();
	let labelsEditMode = $state(false);
	let creatingLabel = $state(false);
	let newLabelName = $state('');
	let renamingId = $state<string | null>(null);
	let renamingName = $state('');
	let pendingDelete: Label | null = $state(null);
	let newLabelInput: HTMLInputElement | null = $state(null);
	let renameInput: HTMLInputElement | null = $state(null);

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

	function enterEditMode() {
		labelsEditMode = true;
		renamingId = null;
		newLabelName = '';
		pendingDelete = null;
	}

	function exitEditMode() {
		labelsEditMode = false;
		creatingLabel = false;
		renamingId = null;
		newLabelName = '';
		pendingDelete = null;
	}

	function startCreateLabel() {
		labelsEditMode = true;
		creatingLabel = true;
		renamingId = null;
		newLabelName = '';
		queueMicrotask(() => newLabelInput?.focus({ preventScroll: true }));
	}

	function finishCreateLabel() {
		if (!creatingLabel) return;
		notesStore.createLabel(newLabelName);
		newLabelName = '';
		creatingLabel = false;
	}

	function cancelCreateLabel() {
		newLabelName = '';
		creatingLabel = false;
	}

	function startRename(label: Label) {
		if (!labelsEditMode) return;
		pendingDelete = null;
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

	const createBtnClass = css({
		display: 'flex',
		w: 'full',
		alignItems: 'center',
		gap: '0.75rem',
		rounded: 'xl',
		py: '0.625rem',
		pl: '1rem',
		pr: '0.5rem',
		textAlign: 'left',
		fontSize: 'sm',
		fontWeight: 'medium',
		color: 'scrapscache.textMuted'
	});
	const createIconWrap = css({
		display: 'grid',
		h: '1.75rem',
		w: '1.75rem',
		flexShrink: 0,
		placeItems: 'center'
	});
	const delBtnClass = css({
		position: 'relative',
		display: 'grid',
		h: '1.75rem',
		w: '1.75rem',
		flexShrink: 0,
		placeItems: 'center',
		color: 'scrapscache.textMuted',
		_before: { position: 'absolute', inset: '-0.5rem', content: '""' }
	});
	const navScroller = css({
		display: 'flex',
		h: 'full',
		flexDirection: 'column',
		gap: '0.125rem',
		overflowY: 'auto',
		px: '0.5rem',
		pb: '1rem',
		pt: '0.5rem'
	});
	const navRowRecipe = cva({
		base: {
			display: 'flex',
			alignItems: 'center',
			gap: '0.75rem',
			rounded: 'xl',
			px: '1rem',
			py: '0.625rem',
			fontSize: 'sm',
			cursor: 'pointer'
		},
		variants: {
			active: {
				true: { fontWeight: 'semibold', color: 'scrapscache.text' },
				false: { fontWeight: 'medium', color: 'scrapscache.textMuted' }
			}
		}
	});
	const navIconBox = css({
		display: 'grid',
		h: '1.75rem',
		w: '1.75rem',
		flexShrink: 0,
		placeItems: 'center',
		color: 'scrapscache.text'
	});
	const labelsSectionClass = css({ mt: '1.25rem' });
	const labelsHeaderClass = css({
		mb: '0.25rem',
		display: 'flex',
		h: '2rem',
		alignItems: 'center',
		gap: '0.5rem',
		pl: '1rem',
		pr: '0.5rem'
	});
	const labelsHeaderTitle = css({
		minW: 0,
		flex: '1',
		fontSize: '11px',
		fontWeight: 'semibold',
		textTransform: 'uppercase',
		letterSpacing: '0.14em',
		color: 'scrapscache.textMuted'
	});
	const labelsEditToggle = css({
		position: 'relative',
		flexShrink: 0,
		rounded: 'md',
		px: '0.5rem',
		py: '0.25rem',
		fontSize: 'xs',
		fontWeight: 'medium',
		color: 'scrapscache.textMuted',
		cursor: 'pointer',
		_before: { position: 'absolute', inset: '-0.625rem', content: '""' }
	});
	const labelEditingRow = css({
		mb: '0.25rem',
		display: 'flex',
		alignItems: 'center',
		gap: '0.75rem',
		rounded: 'xl',
		py: '0.625rem',
		pl: '1rem',
		pr: '0.5rem'
	});
	const labelTagBox = css({
		display: 'grid',
		h: '1.75rem',
		w: '1.75rem',
		flexShrink: 0,
		placeItems: 'center',
		color: 'scrapscache.textMuted'
	});
	const labelInputClass = cx(
		input({ variant: 'unstyled' }),
		css({
			flex: '1',
			fontWeight: 'medium',
			_placeholder: { fontWeight: 'normal', color: 'scrapscache.textMuted' }
		})
	);
	const labelsCol = css({ display: 'flex', flexDirection: 'column', gap: '0.125rem' });
	const labelDisplayRow = css({
		display: 'flex',
		alignItems: 'center',
		gap: '0.75rem',
		rounded: 'xl',
		py: '0.625rem',
		pl: '1rem',
		pr: '0.5rem'
	});
	const labelDisplayText = css({
		minW: 0,
		flex: '1',
		alignSelf: 'stretch',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		textAlign: 'left',
		fontSize: 'sm',
		fontWeight: 'medium',
		color: 'scrapscache.text',
		cursor: 'pointer'
	});
	const s = sidebar();
	const navLabelText = cx(s.navLabel, css({ minW: 0, textAlign: 'left' }));
	const labelNavRowRecipe = cva({
		base: {
			display: 'flex',
			w: 'full',
			alignItems: 'center',
			gap: '0.75rem',
			rounded: 'xl',
			py: '0.625rem',
			pl: '1rem',
			pr: '0.5rem',
			textAlign: 'left',
			fontSize: 'sm',
			cursor: 'pointer'
		},
		variants: {
			active: {
				true: { fontWeight: 'semibold', color: 'scrapscache.text' },
				false: { fontWeight: 'medium', color: 'scrapscache.textMuted' }
			}
		}
	});
	const labelCountBadge = css({
		display: 'grid',
		h: '1.75rem',
		w: '1.75rem',
		flexShrink: 0,
		placeItems: 'center',
		fontSize: 'xs',
		fontVariantNumeric: 'tabular-nums',
		opacity: 0.7
	});
	const d = dialog({ size: 'sm' });
	const dialogPositioner = css({
		position: 'absolute',
		inset: 0,
		display: 'flex',
		alignItems: { base: 'flex-end', sm: 'center' },
		justifyContent: 'center',
		p: '1rem'
	});
	const dialogPanel = css({
		w: 'full',
		maxW: 'sm',
		rounded: '2xl',
		borderWidth: '1px',
		borderColor: 'scrapscache.border',
		bg: 'scrapscache.surface',
		p: '1rem',
		boxShadow: '2xl'
	});
	const dialogActions = css({
		mt: '1rem',
		display: 'flex',
		flexDirection: 'column',
		gap: '0.5rem'
	});
</script>

{#snippet newLabelRow(extraClass: string)}
	<button
		type="button"
		onclick={startCreateLabel}
		data-sidebar-stay-open
		class={`sidebar-row ${createBtnClass} ${extraClass}`}
	>
		<span class={createIconWrap} aria-hidden="true">
			<Plus size={16} strokeWidth={1.75} />
		</span>
		<span class={navLabelText}>New label</span>
	</button>
{/snippet}

{#snippet deleteButton(label: Label)}
	<!-- The ::before pad reaches a thumb-sized hit area without widening the row. -->
	<button
		type="button"
		onclick={() => requestDelete(label)}
		data-sidebar-stay-open
		class={`icon-btn sidebar-row-danger ${delBtnClass}`}
		aria-label={`Delete ${label.name}`}
		title="Delete"
	>
		<X size={14} strokeWidth={1.75} aria-hidden="true" />
	</button>
{/snippet}

<aside
	class={`scrollable sidebar-scroll ${navScroller}`}
	transition:fly={{ x: -20, duration: 120 }}
>
	{#each navItems as item (item.view)}
		{@const NavIcon = item.icon}
		<button
			type="button"
			onclick={() => navigate(item.view)}
			class={`sidebar-row ${navRowRecipe({ active: isActive(item.view) })} ${isActive(item.view) ? 'sidebar-row-active' : ''}`}
		>
			<span class={navIconBox} aria-hidden="true">
				<NavIcon size={18} strokeWidth={1.75} />
			</span>
			<span class={navLabelText}>{item.label}</span>
		</button>
	{/each}

	<section class={labelsSectionClass} data-labels-edit aria-label="Labels">
		<div class={labelsHeaderClass}>
			<span class={labelsHeaderTitle}>Labels</span>
			<!-- One control in both modes, so the header never reflows on toggle. The
			     ::before pad gives it a thumb-sized hit area without a taller header. -->
			<button
				type="button"
				onclick={labelsEditMode ? exitEditMode : enterEditMode}
				data-sidebar-stay-open
				class={`sidebar-row ${labelsEditToggle}`}
				aria-label={labelsEditMode ? 'Finish editing labels' : 'Edit labels'}
				title={labelsEditMode ? 'Finish editing labels' : 'Edit labels'}
			>
				{labelsEditMode ? 'Done' : 'Edit'}
			</button>
		</div>

		{#if labelsEditMode && creatingLabel}
			<div class={`sidebar-row-editing ${labelEditingRow}`} data-sidebar-stay-open>
				<span class={labelTagBox} aria-hidden="true">
					<Tag size={16} strokeWidth={1.75} aria-hidden="true" />
				</span>
				<input
					bind:this={newLabelInput}
					bind:value={newLabelName}
					type="text"
					placeholder="New label"
					aria-label="New label name"
					class={labelInputClass}
					onblur={finishCreateLabel}
					onkeydown={(event) => {
						if (event.key === 'Enter') finishCreateLabel();
						if (event.key === 'Escape') cancelCreateLabel();
					}}
				/>
			</div>
		{:else if labelsEditMode}
			{@render newLabelRow('mb-1')}
		{/if}

		{#if notesStore.labels.length === 0 && !labelsEditMode}
			{@render newLabelRow('')}
		{:else}
			<div class={labelsCol}>
				{#each notesStore.labels as label (label.id)}
					{#if labelsEditMode && renamingId === label.id}
						<!-- Same box as the rows around it, so starting a rename never nudges
						     the list; only the tint and the field change. -->
						<div class={`sidebar-row-editing ${labelEditingRow}`} data-sidebar-stay-open>
							<span class={labelTagBox} aria-hidden="true">
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
							{@render deleteButton(label)}
						</div>
					{:else if labelsEditMode}
						<div class={`sidebar-row ${labelDisplayRow}`}>
							<span class={labelTagBox} aria-hidden="true">
								<Tag size={16} strokeWidth={1.75} />
							</span>
							<button
								type="button"
								onclick={() => startRename(label)}
								data-sidebar-stay-open
								class={labelDisplayText}
								aria-label={`Rename ${label.name}`}
								title="Rename"
							>
								{label.name}
							</button>
							{@render deleteButton(label)}
						</div>
					{:else}
						<button
							type="button"
							onclick={() => navigate('label', label.id)}
							class={`sidebar-row ${labelNavRowRecipe({ active: isActive('label', label.id) })} ${isActive('label', label.id) ? 'sidebar-row-active' : ''}`}
						>
							<span class={createIconWrap} aria-hidden="true">
								<Tag size={16} strokeWidth={1.75} />
							</span>
							<span class={navLabelText}>{label.name}</span>
							{#if (labelCounts.get(label.id) ?? 0) > 0}
								<span class={labelCountBadge}>{labelCounts.get(label.id)}</span>
							{/if}
						</button>
					{/if}
				{/each}
			</div>
		{/if}
	</section>
</aside>

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
			<Dialog.Positioner class={dialogPositioner} data-sidebar-stay-open>
				<Dialog.Content class={`${d.panel} ${dialogPanel}`} data-sidebar-stay-open>
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
					<div class={dialogActions}>
						<button
							type="button"
							onclick={confirmDeleteLabelOnly}
							class={button({ variant: 'subtle', size: 'md' })}
						>
							Delete label only
						</button>
						<button
							type="button"
							onclick={confirmDeleteLabelAndNotes}
							class={button({ variant: 'destructive', size: 'md' })}
						>
							Delete label and its notes
						</button>
						<button
							type="button"
							onclick={cancelDelete}
							class={button({ variant: 'ghost', size: 'md' })}
						>
							Cancel
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	</Dialog.Root>
{/if}
