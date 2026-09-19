<script lang="ts">
	import KanbanCard from '$lib/components/KanbanCard.svelte';
	import KanbanCardBody from '$lib/components/KanbanCardBody.svelte';
	import {
		BacklogFilterMode,
		columnNotes,
		defaultBacklogFilter,
		insertIntoOrder,
		moveNoteLabels,
		slotPosition,
		type BacklogFilter,
		type KanbanColumn
	} from '$lib/kanban';
	import { kanbanDrag, type KanbanDropTarget } from '$lib/kanbanDrag.svelte';
	import { portalToAppOverlay, portalToBody } from '$lib/appViewport';
	import { useEditorActions } from '$lib/editorContext';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { kanbanStore } from '$lib/stores/kanban.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { Checkbox } from '@ark-ui/svelte/checkbox';
	import { Menu } from '@ark-ui/svelte/menu';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { Check, ChevronDown, Pencil, Plus, Trash2, X } from '@lucide/svelte';
	import { flip, type FlipParams } from 'svelte/animate';
	import { onDestroy } from 'svelte';
	import type { Note } from '$lib/types';
	import { css, cx } from 'styled-system/css';
	import { vstack } from 'styled-system/patterns';
	import { iconSizeSm as iconSm, kanbanViewStyles, popover, viewPage } from '$panda/styles';
	import {
		button,
		dialog,
		iconButton,
		input as inputRecipe,
		menuItem
	} from 'styled-system/recipes';

	const { openNote } = useEditorActions();
	const k = kanbanViewStyles;
	const board = $derived(kanbanStore.activeBoard);
	const visibleNotes = $derived(
		uiStore.search
			? notesStore.search(uiStore.search, notesStore.activeNotes)
			: notesStore.activeNotes
	);
	const unusedTags = $derived(
		notesStore.labels.filter(
			(label) => !board.columns.some((column) => column.labelId === label.id)
		)
	);
	/** Labels that can be used in the backlog filter (not already a column). */
	const backlogFilterTags = $derived(unusedTags);
	const backlogFilter = $derived(board.backlogFilter ?? defaultBacklogFilter());
	const backlogFilterActive = $derived(backlogFilter.mode === BacklogFilterMode.Custom);

	const draggedNote = $derived(
		kanbanDrag.noteId ? notesStore.notes.find((note) => note.id === kanbanDrag.noteId) : undefined
	);

	onDestroy(() => kanbanDrag.cancel());

	let renamingBoard = $state(false);
	let boardName = $state('');
	let boardMenuOpen = $state(false);
	let pendingDelete = $state(false);
	let backlogFilterOpen = $state(false);
	let tagPickerOpen = $state(false);

	const menuItemClass = menuItem({ density: 'compact' });
	const d = dialog({ size: 'sm' });

	function resetBoardUi() {
		renamingBoard = false;
		backlogFilterOpen = false;
		tagPickerOpen = false;
	}

	function selectBoard(id: string) {
		kanbanStore.selectBoard(id);
		resetBoardUi();
	}

	function createBoard() {
		resetBoardUi();
		kanbanStore.createBoard();
		startRename();
	}

	function startRename() {
		boardName = board.name;
		renamingBoard = true;
	}

	/** Focus once the menu has closed and handed focus back, so it cannot steal it. */
	function focusAndSelect(node: HTMLInputElement) {
		const frame = requestAnimationFrame(() => {
			node.focus({ preventScroll: true });
			node.select();
		});
		return () => cancelAnimationFrame(frame);
	}

	function commitBoardName() {
		if (!renamingBoard) return;
		renamingBoard = false;
		const next = boardName.trim();
		if (next && next !== board.name) kanbanStore.renameBoard(board.id, next);
	}

	function cancelRename() {
		renamingBoard = false;
	}

	function confirmDeleteBoard() {
		pendingDelete = false;
		resetBoardUi();
		kanbanStore.deleteBoard(board.id);
	}

	function columnName(column: KanbanColumn): string {
		if (column.labelId === null) return 'Backlog';
		return notesStore.labels.find((label) => label.id === column.labelId)?.name ?? 'Deleted label';
	}

	function addTagColumn(labelId: string) {
		if (!labelId) return;
		kanbanStore.addTagColumn(board.id, labelId);
		tagPickerOpen = false;
	}

	function setBacklogMode(mode: BacklogFilterMode) {
		if (mode === BacklogFilterMode.AllNonColumn) {
			kanbanStore.setBacklogFilter(board.id, defaultBacklogFilter());
			return;
		}
		kanbanStore.setBacklogFilter(board.id, {
			mode: BacklogFilterMode.Custom,
			includeUntagged: backlogFilter.includeUntagged,
			labelIds: [...backlogFilter.labelIds]
		});
	}

	function toggleBacklogUntagged() {
		kanbanStore.setBacklogFilter(board.id, {
			mode: BacklogFilterMode.Custom,
			includeUntagged: !backlogFilter.includeUntagged,
			labelIds: [...backlogFilter.labelIds]
		});
	}

	function toggleBacklogLabel(labelId: string) {
		const has = backlogFilter.labelIds.includes(labelId);
		const labelIds = has
			? backlogFilter.labelIds.filter((id) => id !== labelId)
			: [...backlogFilter.labelIds, labelId];
		kanbanStore.setBacklogFilter(board.id, {
			mode: BacklogFilterMode.Custom,
			includeUntagged: backlogFilter.includeUntagged,
			labelIds
		});
	}

	function backlogFilterSummary(): string {
		if (backlogFilter.mode !== BacklogFilterMode.Custom) return 'All non-column notes';
		const parts: string[] = [];
		if (backlogFilter.includeUntagged) parts.push('No labels');
		for (const id of backlogFilter.labelIds) {
			parts.push(notesStore.labels.find((label) => label.id === id)?.name ?? 'Deleted label');
		}
		return parts.length ? parts.join(', ') : 'Nothing selected';
	}

	function moveNote(noteId: string, sourceColumnId: string, destinationColumnId: string) {
		if (sourceColumnId === destinationColumnId) return;
		const source = board.columns.find((column) => column.id === sourceColumnId);
		const destination = board.columns.find((column) => column.id === destinationColumnId);
		const note = notesStore.notes.find((candidate) => candidate.id === noteId);
		if (!source || !destination || !note) return;
		notesStore.updateNote(note.id, {
			labels: moveNoteLabels(note.labels, source.labelId, destination.labelId)
		});
	}

	/**
	 * The cards a column shows while a drag is in flight, plus the slot the
	 * carried one would drop into. The slot is an item of its own so the whole
	 * column glides as one when the preview moves.
	 *
	 * The carried card stays in the list, only hidden. Touch events are
	 * dispatched at whatever the touch started on for the life of the gesture,
	 * so unmounting that card would cut the drag off from the document: the move
	 * never reaches the guard that keeps the page from scrolling, and the
	 * browser cancels the pointer mid-drag — the note snapping back to where it
	 * came from. Hidden, it keeps no space and no hit area, but stays connected.
	 */
	type ColumnItem = { key: string; note: Note | null; index: number; carried: boolean };

	function columnItems(column: KanbanColumn): ColumnItem[] {
		let index = 0;
		const items: ColumnItem[] = columnNotes(board, column, visibleNotes).map((note) => {
			const carried = note.id === kanbanDrag.noteId;
			// Only the cards still on show are numbered: that is what a drop aims at.
			return { key: note.id, note, index: carried ? -1 : index++, carried };
		});
		const slot = kanbanDrag.target?.columnId === column.id ? kanbanDrag.target.index : -1;
		if (slot >= 0) {
			const at = slotPosition(
				items.map((item) => item.carried),
				slot
			);
			items.splice(at, 0, { key: 'drop-slot', note: null, index: slot, carried: false });
		}
		return items;
	}

	/**
	 * flip, except on the carried card: it is hidden, so it measures zero and
	 * would animate to a NaN transform. Nothing to move — it is not on show.
	 */
	function cardFlip(node: Element, rects: { from: DOMRect; to: DOMRect }, params: FlipParams) {
		if (!rects.from.width || !rects.to.width) return {};
		return flip(node, rects, params);
	}

	function dropCard(noteId: string, sourceColumnId: string, target: KanbanDropTarget | null) {
		// Reached from the drag controller, never from the card's own list item, so
		// it may only touch board-level state.
		if (!target) return;
		const destination = board.columns.find((column) => column.id === target.columnId);
		if (!destination) return;
		// Ordering is stored over every note in the column, but aimed at with the
		// ones search left on screen.
		const order = insertIntoOrder(
			columnNotes(board, destination, notesStore.activeNotes).map((note) => note.id),
			columnNotes(board, destination, visibleNotes).map((note) => note.id),
			noteId,
			target.index
		);
		if (target.columnId !== sourceColumnId) moveNote(noteId, sourceColumnId, target.columnId);
		kanbanStore.placeCard(board.id, noteId, sourceColumnId, target.columnId, order);
	}
</script>

<div class={viewPage}>
	<div class={k.controls}>
		{#if renamingBoard}
			<input
				{@attach focusAndSelect}
				bind:value={boardName}
				type="text"
				aria-label="Board name"
				placeholder="Untitled board"
				class={cx(inputRecipe({ variant: 'unstyled' }), k.boardInput)}
				onblur={commitBoardName}
				onkeydown={(event) => {
					if (event.key === 'Enter') commitBoardName();
					if (event.key === 'Escape') cancelRename();
				}}
			/>
		{:else}
			<Menu.Root bind:open={boardMenuOpen} positioning={{ placement: 'bottom-start' }}>
				<Menu.Trigger class={k.boardTrigger} aria-label={`Board: ${board.name}`}>
					<span class={k.boardName}>{board.name}</span>
					<ChevronDown class={k.boardChevron} aria-hidden="true" />
				</Menu.Trigger>
				<Menu.Positioner>
					<Menu.Content class={cx(popover, k.boardMenuContent)} aria-label="Boards">
						<Menu.ItemGroup>
							<Menu.ItemGroupLabel class={k.boardMenuGroupLabel}>Boards</Menu.ItemGroupLabel>
							{#each kanbanStore.boards as choice (choice.id)}
								<Menu.Item
									value={`board:${choice.id}`}
									onSelect={() => selectBoard(choice.id)}
									class={menuItemClass}
								>
									<span class={k.boardMenuName}>{choice.name}</span>
									{#if choice.id === board.id}
										<Check class={k.boardMenuCheck} aria-label="Current board" />
									{/if}
								</Menu.Item>
							{/each}
						</Menu.ItemGroup>
						<Menu.Separator class={k.boardMenuSeparator} />
						<Menu.Item value="new" onSelect={createBoard} class={menuItemClass}>
							<Plus class={iconSm} aria-hidden="true" />
							New board
						</Menu.Item>
						<Menu.Item value="rename" onSelect={startRename} class={menuItemClass}>
							<Pencil class={iconSm} aria-hidden="true" />
							Rename board
						</Menu.Item>
						<Menu.Item
							value="delete"
							onSelect={() => (pendingDelete = true)}
							class={cx(menuItemClass, k.boardMenuDanger)}
						>
							<Trash2 class={iconSm} aria-hidden="true" />
							Delete board
						</Menu.Item>
					</Menu.Content>
				</Menu.Positioner>
			</Menu.Root>
		{/if}
	</div>

	<div class={['kanban-columns', k.columnsContainer]}>
		<div class={k.columnsTrack}>
			{#each board.columns as column (column.id)}
				{@const items = columnItems(column)}
				<section
					data-kanban-column={column.id}
					class={[k.column, kanbanDrag.target?.columnId === column.id && k.columnTarget]}
					aria-label={`${columnName(column)} ${column.labelId === null ? 'Kanban' : 'label'} column`}
				>
					<div class={k.colHeader}>
						<h2 class={k.colTitle}>
							{columnName(column)}
						</h2>
						{#if column.labelId === null}
							<button
								type="button"
								class={cx(
									button({ variant: 'ghost', size: 'xs' }),
									css({ rounded: 'card' }),
									backlogFilterActive
										? css({ bg: 'scrapscache.accentSubtle', color: 'scrapscache.accentHover' })
										: undefined
								)}
								onclick={() => (backlogFilterOpen = !backlogFilterOpen)}
								aria-expanded={backlogFilterOpen}
								aria-label="Backlog filter"
								title="Backlog filter"
							>
								Filter
							</button>
						{:else}
							<button
								type="button"
								onclick={() => kanbanStore.removeTagColumn(board.id, column.id)}
								class={iconButton({ variant: 'danger', size: 'xs' })}
								aria-label={`Remove ${columnName(column)} label column`}
								title="Remove label column"
							>
								<X size={14} aria-hidden="true" />
							</button>
						{/if}
					</div>

					{#if column.labelId === null && backlogFilterOpen}
						<div class={k.backlogGroup} role="group" aria-label="Backlog filter options">
							<p class={k.explain}>
								Choose which notes show in Backlog. Notes already in a label column are never listed
								here.
							</p>
							<label class={k.radioOption}>
								<input
									type="radio"
									name="backlog-mode-{board.id}"
									checked={backlogFilter.mode === BacklogFilterMode.AllNonColumn}
									onchange={() => setBacklogMode(BacklogFilterMode.AllNonColumn)}
									class={k.radioInput}
								/>
								<span>
									<span class={k.radioTitle}>All non-column notes</span>
									<span class={k.radioSubtitle}> Default: everything not in a label column </span>
								</span>
							</label>
							<label class={k.radioOption}>
								<input
									type="radio"
									name="backlog-mode-{board.id}"
									checked={backlogFilter.mode === BacklogFilterMode.Custom}
									onchange={() => setBacklogMode(BacklogFilterMode.Custom)}
									class={k.radioInput}
								/>
								<span class={k.radioTitle}>Only selected…</span>
							</label>

							{#if backlogFilter.mode === BacklogFilterMode.Custom}
								<div class={k.filterIndent}>
									<Checkbox.Root
										checked={backlogFilter.includeUntagged}
										onCheckedChange={toggleBacklogUntagged}
										class={k.checkRow}
									>
										<Checkbox.Control class={k.checkControl}>
											<Checkbox.Indicator class={k.checkMark}>✓</Checkbox.Indicator>
										</Checkbox.Control>
										<Checkbox.Label>No labels</Checkbox.Label>
										<Checkbox.HiddenInput />
									</Checkbox.Root>
									{#each backlogFilterTags as label (label.id)}
										<Checkbox.Root
											checked={backlogFilter.labelIds.includes(label.id)}
											onCheckedChange={() => toggleBacklogLabel(label.id)}
											class={k.checkRow}
										>
											<Checkbox.Control class={k.checkControl}>
												<Checkbox.Indicator class={k.checkMark}>✓</Checkbox.Indicator>
											</Checkbox.Control>
											<Checkbox.Label class={k.tagLabel}>
												{label.name}
											</Checkbox.Label>
											<Checkbox.HiddenInput />
										</Checkbox.Root>
									{/each}
									{#if backlogFilterTags.length === 0}
										<p class={k.emptyTags}>
											No other labels available. Create labels on notes, or remove a label column
											first.
										</p>
									{/if}
								</div>
							{/if}

							<p class={k.filterSummary} title={backlogFilterSummary()}>
								Showing: {backlogFilterSummary()}
							</p>
						</div>
					{/if}

					<!-- Positioned: card offsets are measured against this list while dragging. -->
					<div class={k.cardsList} data-kanban-list aria-live="polite">
						{#each items as item (item.key)}
							<!-- Cards and the drop slot share one animated element, so the whole
							     column glides when the preview moves between slots. -->
							<div
								data-kanban-card={item.note?.id}
								data-kanban-carried={item.carried ? '' : undefined}
								data-kanban-slot={item.note ? undefined : ''}
								hidden={item.carried}
								class={item.note ? undefined : k.dropSlot}
								style={item.note ? undefined : `height: ${kanbanDrag.height}px`}
								animate:cardFlip={{ duration: 160 }}
							>
								{#if item.note}
									<KanbanCard
										note={item.note}
										columnId={column.id}
										index={item.index}
										onOpen={openNote}
										onDrop={dropCard}
									/>
								{/if}
							</div>
						{/each}
						{#if items.length === 0}
							<div class={k.emptyDrop}>Drop a note here</div>
						{/if}
					</div>
				</section>
			{/each}

			{#if unusedTags.length > 0}
				<div class={k.addColWrap}>
					<Menu.Root bind:open={tagPickerOpen} positioning={{ placement: 'bottom-start' }}>
						<Menu.Trigger
							class={button({ variant: 'dashed', size: 'md' })}
							aria-label="Add a label column"
						>
							<span>+ Add label column</span>
							<ChevronDown size={14} aria-hidden="true" />
						</Menu.Trigger>
						<Menu.Positioner class={k.tagPickerPositioner}>
							<Menu.Content class={cx(popover, k.tagPickerContent)} aria-label="Labels">
								{#each unusedTags as label (label.id)}
									<Menu.Item
										value={label.id}
										onSelect={() => addTagColumn(label.id)}
										class={k.menuItem}
									>
										{label.name}
									</Menu.Item>
								{/each}
							</Menu.Content>
						</Menu.Positioner>
					</Menu.Root>
				</div>
			{/if}
		</div>
	</div>
</div>

{#if draggedNote}
	<!-- Portalled to the document: clientX/clientY are viewport coordinates, and
	     the app viewport is a transformed containing block that would shift them. -->
	<div
		{@attach portalToBody}
		class={k.dragGhost}
		style="width: {kanbanDrag.width}px; transform: translate3d({kanbanDrag.x}px, {kanbanDrag.y}px, 0);"
		aria-hidden="true"
	>
		<div class={k.dragGhostCard} data-lifted={kanbanDrag.lifted}>
			<KanbanCardBody note={draggedNote} />
		</div>
	</div>
{/if}

{#if pendingDelete}
	<Dialog.Root
		open
		onOpenChange={(details) => !details.open && (pendingDelete = false)}
		preventScroll={false}
	>
		<div
			{@attach portalToAppOverlay}
			class={css({ position: 'absolute', inset: 0, zIndex: 80 })}
			role="presentation"
		>
			<Dialog.Backdrop class={d.backdrop} />
			<Dialog.Positioner class={k.deletePositioner}>
				<Dialog.Content class={d.panel}>
					<Dialog.Title class={d.title}>Delete “{board.name}”?</Dialog.Title>
					<p class={d.description}>
						{#if kanbanStore.boards.length === 1}
							Its columns and card order will be removed and a new empty board created. Your notes
							and labels stay as they are.
						{:else}
							Its columns and card order will be removed. Your notes and labels stay as they are.
						{/if}
					</p>
					<div class={vstack({ gap: 'sm', mt: 'lg' })}>
						<button
							type="button"
							onclick={confirmDeleteBoard}
							class={button({ variant: 'destructive', size: 'md' })}
						>
							Delete board
						</button>
						<button
							type="button"
							onclick={() => (pendingDelete = false)}
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
