<script lang="ts">
	import KanbanCard from '#lib/components/KanbanCard.svelte';
	import KanbanCardBody from '#lib/components/KanbanCardBody.svelte';
	import {
		boardNotes,
		BoardNoteFilterAction,
		columnNotes,
		insertIntoOrder,
		noteFilterLabelIds,
		slotPosition,
		type KanbanColumn
	} from '#lib/kanban.js';
	import { kanbanDrag, type KanbanDropTarget } from '#lib/kanbanDrag.svelte.js';
	import { moveCardToColumn, type MoveTargets } from '#lib/kanbanMove.js';
	import { applyBoardTemplate, BOARD_TEMPLATES, labelNamed } from '#lib/kanbanTemplates.js';
	import { portalToAppOverlay, portalToBody } from '#lib/appViewport.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { kanbanStore } from '#lib/stores/kanban.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { Menu } from '@ark-ui/svelte/menu';
	import { MediaQuery } from 'svelte/reactivity';
	import { SegmentGroup } from '@ark-ui/svelte/segment-group';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import {
		ArrowLeft,
		ArrowRight,
		Check,
		ChevronDown,
		EllipsisVertical,
		ListFilter,
		Pencil,
		Plus,
		Trash2,
		X
	} from '@lucide/svelte';
	import { flip, type FlipParams } from 'svelte/animate';
	import { onDestroy } from 'svelte';
	import type { Note } from '#lib/types.js';
	import { css, cx } from 'styled-system/css';
	import { vstack } from 'styled-system/patterns';
	import {
		iconSizeSm as iconSm,
		kanbanViewStyles,
		popover,
		viewHeading,
		viewPage
	} from '$panda/styles';
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
	const noteFilter = $derived(board.noteFilter);
	/** Names of the labels the note filter acts on; none means the filter is off. */
	const noteFilterNames = $derived(
		noteFilterLabelIds(board).flatMap((id) => notesStore.labelsById.get(id)?.name ?? [])
	);
	const noteFilterActive = $derived(noteFilterNames.length > 0);
	/** How many of the notes on show the filter lets onto the board. */
	const filteredCount = $derived(boardNotes(board, visibleNotes).length);

	/** On a phone one column shows at a time, picked by its tab. */
	const mobile = new MediaQuery('max-width: 767px');
	let activeColumnId = $state<string | null>(null);
	const activeColumn = $derived(
		board.columns.find((column) => column.id === activeColumnId) ?? board.columns[0]
	);
	const shownColumns = $derived(mobile.current && activeColumn ? [activeColumn] : board.columns);

	const draggedNote = $derived(
		kanbanDrag.noteId ? notesStore.notes.find((note) => note.id === kanbanDrag.noteId) : undefined
	);

	onDestroy(() => kanbanDrag.cancel());

	let renamingBoard = $state(false);
	let boardName = $state('');
	let boardMenuOpen = $state(false);
	let pendingDelete = $state(false);
	let noteFilterOpen = $state(false);
	let tagPickerOpen = $state(false);
	/** The "New label…" prompt from the add-column menu and the starter panel. */
	let newLabelOpen = $state(false);
	let newLabelName = $state('');
	let newLabelInput = $state<HTMLInputElement | null>(null);
	/** Anchored to the top, so a phone keyboard never covers the field or Create. */
	const newLabelDialog = dialog({ size: 'sm', presentation: 'appOverlay' });
	/** The column whose label is being renamed from its menu. */
	let renamingColumn = $state<KanbanColumn | null>(null);
	let renameName = $state('');
	let renameInput = $state<HTMLInputElement | null>(null);

	function startRenameLabel(column: KanbanColumn) {
		renameName = columnName(column);
		renamingColumn = column;
	}

	function commitRenameLabel() {
		const column = renamingColumn;
		const name = (renameInput?.value ?? renameName).trim();
		renamingColumn = null;
		if (!column || column.labelId === null || !name) return;
		notesStore.renameLabel(column.labelId, name);
	}

	/** Whether a label column can shift that way: Unsorted stays first, the ends stay ends. */
	function canMoveColumn(column: KanbanColumn, direction: -1 | 1): boolean {
		const at = board.columns.indexOf(column);
		const to = at + direction;
		return (
			column.labelId !== null &&
			to > 0 &&
			to < board.columns.length &&
			board.columns[to].labelId !== null
		);
	}

	/** The card's menu lists the board's columns; picking one moves it there, at the end. */
	function moveTargets(column: KanbanColumn, noteId: string): MoveTargets {
		return {
			columns: board.columns.map((candidate) => ({
				id: candidate.id,
				name: columnName(candidate)
			})),
			current: column.id,
			onMove: (columnId) => {
				const destination = board.columns.find((candidate) => candidate.id === columnId);
				if (!destination || destination.id === column.id) return;
				const order = [
					...columnNotes(board, destination, notesStore.activeNotes)
						.map((note) => note.id)
						.filter((id) => id !== noteId),
					noteId
				];
				moveCardToColumn({
					boardId: board.id,
					noteId,
					source: column,
					destination,
					order,
					message: `Moved to ${columnName(destination)}`
				});
				if (mobile.current) activeColumnId = destination.id;
			}
		};
	}
	/** A board with only its Backlog: the first run, where the panel explains and offers a start. */
	const noLabelColumns = $derived(board.columns.every((column) => column.labelId === null));

	/** What a column lists, in one line under its name: the model is said where it is used. */
	function columnCaption(column: KanbanColumn): string {
		return column.labelId === null ? 'Notes in no column' : `Notes labelled ${columnName(column)}`;
	}

	function openNewLabel() {
		tagPickerOpen = false;
		newLabelName = '';
		newLabelOpen = true;
	}

	/** Make the typed label and give the board a column for it; an existing name is reused. */
	function createLabelColumn() {
		// The field's own value: a fast tap on Create can land before the binding settles.
		const name = (newLabelInput?.value ?? newLabelName).trim();
		if (!name) return;
		const label = labelNamed(name);
		if (label) kanbanStore.addTagColumn(board.id, label.id);
		newLabelOpen = false;
		newLabelName = '';
	}

	const menuItemClass = menuItem({ density: 'compact' });
	const noteFilterActions = [
		{ action: BoardNoteFilterAction.Keep, title: 'Show only' },
		{ action: BoardNoteFilterAction.Remove, title: 'Hide' }
	];
	const d = dialog({ size: 'sm' });

	function resetBoardUi() {
		renamingBoard = false;
		noteFilterOpen = false;
		tagPickerOpen = false;
		activeColumnId = null;
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
		if (column.labelId === null) return 'Unsorted';
		return notesStore.labels.find((label) => label.id === column.labelId)?.name ?? 'Deleted label';
	}

	function addTagColumn(labelId: string) {
		if (!labelId) return;
		kanbanStore.addTagColumn(board.id, labelId);
		tagPickerOpen = false;
	}

	function setNoteFilterAction(action: BoardNoteFilterAction) {
		kanbanStore.setNoteFilter(board.id, { action, labelIds: [...noteFilter.labelIds] });
	}

	function toggleNoteFilterLabel(labelId: string) {
		const labelIds = noteFilter.labelIds.includes(labelId)
			? noteFilter.labelIds.filter((id) => id !== labelId)
			: [...noteFilter.labelIds, labelId];
		kanbanStore.setNoteFilter(board.id, { action: noteFilter.action, labelIds });
	}

	function clearNoteFilter() {
		kanbanStore.setNoteFilter(board.id, { action: noteFilter.action, labelIds: [] });
	}

	function noteFilterSummary(): string {
		if (!noteFilterActive) return 'All notes. Pick labels to filter.';
		const names = noteFilterNames.join(', ');
		return noteFilter.action === BoardNoteFilterAction.Keep
			? `Only notes with ${names}`
			: `All notes except ${names}`;
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
		const source = board.columns.find((column) => column.id === sourceColumnId);
		// A reorder within one column changes no label, so it is not recorded.
		if (target.columnId === sourceColumnId || !source) {
			kanbanStore.placeCard(board.id, noteId, sourceColumnId, target.columnId, order);
			return;
		}
		moveCardToColumn({
			boardId: board.id,
			noteId,
			source,
			destination,
			order,
			message: `Moved to ${columnName(destination)}`
		});
		// Dropped on a tab: show the column the card went to.
		if (mobile.current) activeColumnId = destination.id;
	}
</script>

<div class={viewPage}>
	<h1 class={viewHeading}>Kanban</h1>
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
		<button
			type="button"
			class={cx(
				iconButton({ variant: 'ghost', size: 'sm' }),
				k.boardFilterTrigger,
				noteFilterActive && k.filterActive
			)}
			onclick={() => (noteFilterOpen = !noteFilterOpen)}
			aria-expanded={noteFilterOpen}
			aria-label={noteFilterActive ? 'Board filter (on)' : 'Board filter'}
			title={noteFilterActive ? 'Board filter (on)' : 'Board filter'}
		>
			<ListFilter class={iconSm} aria-hidden="true" />
		</button>
	</div>

	{#if noteFilterOpen}
		<div class={k.boardFilterGroup} role="group" aria-label="Board filter options">
			<div class={k.filterHeader}>
				<SegmentGroup.Root
					value={noteFilter.action}
					onValueChange={(details) => {
						if (details.value) setNoteFilterAction(details.value as BoardNoteFilterAction);
					}}
					class={k.actionSegment}
					aria-label="What the selected labels do"
				>
					{#each noteFilterActions as option (option.action)}
						<SegmentGroup.Item value={option.action} class={k.actionSegmentItem}>
							<SegmentGroup.ItemText>{option.title}</SegmentGroup.ItemText>
							<SegmentGroup.ItemHiddenInput />
						</SegmentGroup.Item>
					{/each}
				</SegmentGroup.Root>
				{#if noteFilterActive}
					<button
						type="button"
						class={button({ variant: 'ghost', size: 'xs' })}
						onclick={clearNoteFilter}
					>
						Clear
					</button>
				{/if}
			</div>
			{#if unusedTags.length > 0}
				<div class={k.filterChips} role="group" aria-label="Board filter labels">
					{#each unusedTags as label (label.id)}
						<button
							type="button"
							class={k.filterChip}
							aria-pressed={noteFilter.labelIds.includes(label.id)}
							onclick={() => toggleNoteFilterLabel(label.id)}
						>
							{label.name}
						</button>
					{/each}
				</div>
			{:else}
				<p class={k.explain}>Every label is a column; there is nothing else to filter by.</p>
			{/if}
			<div class={k.filterFoot}>
				<p class={k.filterSummary} title={noteFilterSummary()}>
					{noteFilterSummary()}
				</p>
				<span class={k.filterCount} data-board-filter-count
					>{filteredCount} of {visibleNotes.length} notes</span
				>
			</div>
		</div>
	{/if}

	{#if mobile.current}
		<!-- One column at a time: the tabs pick it, and a carried card can be dropped on
		     one. Each tab is a drop target like a column, with an empty list to land in. -->
		<div class={k.columnTabs} role="tablist" aria-label="Columns">
			{#each board.columns as column (column.id)}
				<button
					type="button"
					role="tab"
					class={k.columnTab}
					aria-selected={activeColumn?.id === column.id}
					data-kanban-column={column.id}
					data-drop-target={kanbanDrag.target?.columnId === column.id ? '' : undefined}
					onclick={() => (activeColumnId = column.id)}
				>
					{columnName(column)}
					<span class={k.colCount}>{columnNotes(board, column, visibleNotes).length}</span>
					<span data-kanban-list hidden></span>
				</button>
			{/each}
		</div>
		{#if kanbanDrag.active}
			<p class={k.columnTabHint}>Drop on a column to move the note</p>
		{/if}
	{/if}

	<div class={['kanban-columns', k.columnsContainer]}>
		<div class={k.columnsTrack}>
			{#each shownColumns as column (column.id)}
				{@const items = columnItems(column)}
				<section
					data-kanban-column={column.id}
					class={[k.column, kanbanDrag.target?.columnId === column.id && k.columnTarget]}
					aria-label={`${columnName(column)} ${column.labelId === null ? 'Kanban' : 'label'} column`}
				>
					<div class={k.colHeader}>
						<div class={k.colTitleGroup}>
							<h2 class={k.colTitle}>
								{columnName(column)}
								<span class={k.colCount} data-column-count
									>{items.filter((item) => item.note && !item.carried).length}</span
								>
							</h2>
							<p class={k.colCaption}>{columnCaption(column)}</p>
						</div>
						{#if column.labelId !== null}
							<Menu.Root positioning={{ placement: 'bottom-end' }} lazyMount unmountOnExit>
								<Menu.Trigger
									class={iconButton({ variant: 'ghost', size: 'compact' })}
									aria-label={`${columnName(column)} column actions`}
									title="Column actions"
								>
									<EllipsisVertical class={iconSm} aria-hidden="true" />
								</Menu.Trigger>
								<Menu.Positioner>
									<Menu.Content
										class={cx(popover, k.colMenuContent)}
										aria-label={`${columnName(column)} column actions`}
									>
										<Menu.Item
											value="rename"
											onSelect={() => startRenameLabel(column)}
											class={menuItemClass}
										>
											<Pencil class={iconSm} aria-hidden="true" />
											Rename label…
										</Menu.Item>
										<Menu.Item
											value="left"
											disabled={!canMoveColumn(column, -1)}
											onSelect={() => kanbanStore.moveColumn(board.id, column.id, -1)}
											class={menuItemClass}
										>
											<ArrowLeft class={iconSm} aria-hidden="true" />
											Move left
										</Menu.Item>
										<Menu.Item
											value="right"
											disabled={!canMoveColumn(column, 1)}
											onSelect={() => kanbanStore.moveColumn(board.id, column.id, 1)}
											class={menuItemClass}
										>
											<ArrowRight class={iconSm} aria-hidden="true" />
											Move right
										</Menu.Item>
										<Menu.Separator class={k.boardMenuSeparator} />
										<Menu.Item
											value="remove"
											onSelect={() => kanbanStore.removeTagColumn(board.id, column.id)}
											class={menuItemClass}
										>
											<X class={iconSm} aria-hidden="true" />
											Remove column
										</Menu.Item>
										<p class={k.colMenuCaption}>The label and its notes stay.</p>
									</Menu.Content>
								</Menu.Positioner>
							</Menu.Root>
						{/if}
					</div>

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
										columnLabelId={column.labelId}
										index={item.index}
										onOpen={openNote}
										onDrop={dropCard}
										moveTo={moveTargets(column, item.note.id)}
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

			{#if noLabelColumns}
				<!-- The first run: say what columns are, and offer a start. -->
				<section class={k.starter} aria-labelledby="kanban-starter-title">
					<h2 id="kanban-starter-title" class={k.starterTitle}>Boards group your notes by label</h2>
					<p class={k.starterText}>
						Each column is a label. Moving a card to a column puts that label on the note.
					</p>
					<div class={k.starterChoices}>
						{#each BOARD_TEMPLATES as template (template.id)}
							<button
								type="button"
								class={button({ variant: 'secondary', size: 'md' })}
								onclick={() => applyBoardTemplate(board.id, template.names)}
							>
								{template.names.join(' · ')}
							</button>
						{/each}
						<button
							type="button"
							class={button({ variant: 'ghost', size: 'md' })}
							onclick={() => (tagPickerOpen = true)}
						>
							Choose from my labels…
						</button>
					</div>
				</section>
			{/if}
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
						<Menu.Content class={cx(popover, k.tagPickerContent)} aria-label="Add a label column">
							<Menu.Item value="new-label" onSelect={openNewLabel} class={k.menuItem}>
								<Plus size={14} aria-hidden="true" />
								New label…
							</Menu.Item>
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
		</div>
	</div>
</div>

{#if newLabelOpen}
	<Dialog.Root
		open
		onOpenChange={(details) => !details.open && (newLabelOpen = false)}
		preventScroll={false}
	>
		<div {@attach portalToAppOverlay} class={newLabelDialog.portal} role="presentation">
			<Dialog.Backdrop class={newLabelDialog.backdrop} />
			<Dialog.Positioner class={newLabelDialog.positioner}>
				<Dialog.Content class={newLabelDialog.panel}>
					<form
						onsubmit={(event) => {
							event.preventDefault();
							createLabelColumn();
						}}
					>
						<div class={newLabelDialog.header}>
							<Dialog.Title class={newLabelDialog.title}>New label column</Dialog.Title>
						</div>
						<div class={newLabelDialog.body}>
							<p class={newLabelDialog.description}>
								The label is created and gets a column on this board.
							</p>
							<input
								{@attach focusAndSelect}
								bind:this={newLabelInput}
								bind:value={newLabelName}
								type="text"
								aria-label="Label name"
								placeholder="Label name"
								class={cx(inputRecipe({ variant: 'outline', size: 'md' }), k.newLabelInput)}
							/>
							<div class={newLabelDialog.footer}>
								<button
									type="button"
									onclick={() => (newLabelOpen = false)}
									class={button({ variant: 'quiet', size: 'md' })}
								>
									Cancel
								</button>
								<!-- A touch press must not blur the field: the keyboard would start closing. -->
								<button
									type="submit"
									disabled={!newLabelName.trim()}
									onpointerdown={(event) => {
										if (event.pointerType === 'touch') event.preventDefault();
									}}
									class={button({ variant: 'primary', size: 'md' })}
								>
									Create label
								</button>
							</div>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	</Dialog.Root>
{/if}

{#if renamingColumn}
	<Dialog.Root
		open
		onOpenChange={(details) => !details.open && (renamingColumn = null)}
		preventScroll={false}
	>
		<div {@attach portalToAppOverlay} class={newLabelDialog.portal} role="presentation">
			<Dialog.Backdrop class={newLabelDialog.backdrop} />
			<Dialog.Positioner class={newLabelDialog.positioner}>
				<Dialog.Content class={newLabelDialog.panel}>
					<form
						onsubmit={(event) => {
							event.preventDefault();
							commitRenameLabel();
						}}
					>
						<div class={newLabelDialog.header}>
							<Dialog.Title class={newLabelDialog.title}>Rename label</Dialog.Title>
						</div>
						<div class={newLabelDialog.body}>
							<p class={newLabelDialog.description}>
								The column and every note with this label take the new name.
							</p>
							<input
								{@attach focusAndSelect}
								bind:this={renameInput}
								bind:value={renameName}
								type="text"
								aria-label="Label name"
								placeholder="Label name"
								class={cx(inputRecipe({ variant: 'outline', size: 'md' }), k.newLabelInput)}
							/>
							<div class={newLabelDialog.footer}>
								<button
									type="button"
									onclick={() => (renamingColumn = null)}
									class={button({ variant: 'quiet', size: 'md' })}
								>
									Cancel
								</button>
								<button
									type="submit"
									disabled={!renameName.trim()}
									onpointerdown={(event) => {
										if (event.pointerType === 'touch') event.preventDefault();
									}}
									class={button({ variant: 'primary', size: 'md' })}
								>
									Rename
								</button>
							</div>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Positioner>
		</div>
	</Dialog.Root>
{/if}

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
