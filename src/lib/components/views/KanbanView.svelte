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
	import { portalToBody } from '$lib/appViewport';
	import { useEditorActions } from '$lib/editorContext';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { kanbanStore } from '$lib/stores/kanban.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { Checkbox } from '@ark-ui/svelte/checkbox';
	import { Menu } from '@ark-ui/svelte/menu';
	import { ChevronDown, X } from '@lucide/svelte';
	import { flip, type FlipParams } from 'svelte/animate';
	import { onDestroy } from 'svelte';
	import type { Note } from '$lib/types';
	import { sva } from 'styled-system/css';
	import { kanban, button, iconButton, input as inputRecipe, select } from 'styled-system/recipes';

	const { openNote } = useEditorActions();
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
	let boardName = $derived(board.name);
	let backlogFilterOpen = $state(false);
	let tagPickerOpen = $state(false);

	function selectBoard(id: string) {
		kanbanStore.selectBoard(id);
		renamingBoard = false;
		backlogFilterOpen = false;
		tagPickerOpen = false;
	}

	function commitBoardName() {
		const next = boardName.trim();
		if (!next) {
			boardName = board.name;
			return;
		}
		kanbanStore.renameBoard(board.id, next);
		renamingBoard = false;
	}

	function deleteActiveBoard() {
		const name = board.name.trim() || 'Untitled board';
		const message =
			kanbanStore.boards.length === 1
				? `Delete board “${name}”? A new empty board will be created.`
				: `Delete board “${name}”? This cannot be undone.`;
		if (!window.confirm(message)) return;
		renamingBoard = false;
		backlogFilterOpen = false;
		tagPickerOpen = false;
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

	const k = kanban();

	// Backlog filter copy and the label-picker popover chrome, local to this view.
	const backlogSva = sva({
		slots: [
			'explain',
			'radioInput',
			'radioTitle',
			'radioSubtitle',
			'tagLabel',
			'emptyTags',
			'tagPickerPositioner',
			'tagPickerContent'
		],
		base: {
			explain: { fontSize: '11px', lineHeight: 'snug', color: 'scrapscache.textMuted' },
			radioInput: { mt: '0.125rem' },
			radioTitle: { fontWeight: 'medium', color: 'scrapscache.text' },
			radioSubtitle: { mt: '0.125rem', display: 'block', color: 'scrapscache.textMuted' },
			tagLabel: {
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				whiteSpace: 'nowrap',
				color: 'scrapscache.text'
			},
			emptyTags: { px: '0.25rem', py: '0.25rem', color: 'scrapscache.textMuted' },
			tagPickerPositioner: { zIndex: 20, w: 'var(--reference-width)' },
			tagPickerContent: { maxH: '16rem', overflowY: 'auto', py: '0.25rem' }
		}
	});
	const b = backlogSva();
</script>

<div class={k.page}>
	<div class={k.controls}>
		<div class={k.selectWrap}>
			<select
				aria-label="Kanban board"
				value={board.id}
				onchange={(event) => selectBoard((event.currentTarget as HTMLSelectElement).value)}
				class={select({ size: 'md' })}
			>
				{#each kanbanStore.boards as choice (choice.id)}
					<option value={choice.id}>{choice.name}</option>
				{/each}
			</select>
			<ChevronDown class={k.selectChevron} aria-hidden="true" />
		</div>
		<button
			type="button"
			class={button({ variant: 'ghost', size: 'sm' })}
			onclick={() => {
				backlogFilterOpen = false;
				tagPickerOpen = false;
				kanbanStore.createBoard();
				renamingBoard = true;
			}}
		>
			New board
		</button>
		<button
			type="button"
			class={button({ variant: 'ghost', size: 'sm' })}
			onclick={() => {
				boardName = board.name;
				renamingBoard = !renamingBoard;
			}}
			aria-expanded={renamingBoard}
		>
			Rename
		</button>
		<button
			type="button"
			class={button({ variant: 'danger', size: 'sm' })}
			onclick={deleteActiveBoard}
			aria-label={`Delete board ${board.name}`}
		>
			Delete
		</button>
	</div>

	{#if renamingBoard}
		<div class={k.renameRow}>
			<input
				bind:value={boardName}
				aria-label="Board name"
				onkeydown={(event) => {
					if (event.key === 'Enter') commitBoardName();
					if (event.key === 'Escape') renamingBoard = false;
				}}
				class={inputRecipe({ variant: 'outline', size: 'md' })}
			/>
			<button
				type="button"
				onclick={commitBoardName}
				class={button({ variant: 'subtle', size: 'sm' })}
			>
				Save
			</button>
		</div>
	{/if}

	<div class={`kanban-columns ${k.columnsContainer}`}>
		<div class={k.columnsTrack}>
			{#each board.columns as column (column.id)}
				{@const items = columnItems(column)}
				<section
					data-kanban-column={column.id}
					class={k.column}
					class:kanban-column-target={kanbanDrag.target?.columnId === column.id}
					aria-label={`${columnName(column)} ${column.labelId === null ? 'Kanban' : 'label'} column`}
				>
					<div class={k.colHeader}>
						<h2 class={k.colTitle}>
							{columnName(column)}
						</h2>
						{#if column.labelId === null}
							<button
								type="button"
								class={button({
									variant: backlogFilterActive ? 'filterActive' : 'filter',
									size: 'xs'
								})}
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
							<p class={b.explain}>
								Choose which notes show in Backlog. Notes already in a label column are never listed
								here.
							</p>
							<label class={k.radioOption}>
								<input
									type="radio"
									name="backlog-mode-{board.id}"
									checked={backlogFilter.mode === BacklogFilterMode.AllNonColumn}
									onchange={() => setBacklogMode(BacklogFilterMode.AllNonColumn)}
									class={b.radioInput}
								/>
								<span>
									<span class={b.radioTitle}>All non-column notes</span>
									<span class={b.radioSubtitle}> Default: everything not in a label column </span>
								</span>
							</label>
							<label class={k.radioOption}>
								<input
									type="radio"
									name="backlog-mode-{board.id}"
									checked={backlogFilter.mode === BacklogFilterMode.Custom}
									onchange={() => setBacklogMode(BacklogFilterMode.Custom)}
									class={b.radioInput}
								/>
								<span class={b.radioTitle}>Only selected…</span>
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
										<Checkbox.Label class={k.checkLabel}>No labels</Checkbox.Label>
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
											<Checkbox.Label class={b.tagLabel}>
												{label.name}
											</Checkbox.Label>
											<Checkbox.HiddenInput />
										</Checkbox.Root>
									{/each}
									{#if backlogFilterTags.length === 0}
										<p class={b.emptyTags}>
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
								class={item.carried ? 'hidden' : item.note ? undefined : 'kanban-drop-slot'}
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
						<Menu.Positioner class={b.tagPickerPositioner}>
							<Menu.Content class={`scrapscache-popover ${b.tagPickerContent}`} aria-label="Labels">
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
		class="kanban-drag-ghost"
		style="width: {kanbanDrag.width}px; transform: translate3d({kanbanDrag.x}px, {kanbanDrag.y}px, 0);"
		aria-hidden="true"
	>
		<div class="kanban-drag-ghost-card" class:lifted={kanbanDrag.lifted}>
			<KanbanCardBody note={draggedNote} />
		</div>
	</div>
{/if}
