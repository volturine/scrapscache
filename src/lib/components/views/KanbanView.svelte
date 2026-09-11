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
	import { css } from 'styled-system/css';

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

	const pageWrap = css({ pt: '1rem', pb: '2rem' });
	const controlsRow = css({
		mb: '1rem',
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'center',
		gap: '0.5rem'
	});
	const selectBox = css({ position: 'relative', minW: 0, maxW: 'full' });
	const selectEl = css({
		minW: 0,
		maxW: 'full',
		appearance: 'none',
		rounded: 'xl',
		borderWidth: '1px',
		borderColor: 'scrapscache.border',
		bg: 'scrapscache.surface',
		py: '0.5rem',
		pl: '0.75rem',
		pr: '2rem',
		fontSize: 'sm',
		fontWeight: '600',
		color: 'scrapscache.text',
		outline: 'none'
	});
	const selectChevron = css({
		pointerEvents: 'none',
		position: 'absolute',
		right: '0.625rem',
		top: '50%',
		h: '0.875rem',
		w: '0.875rem',
		transform: 'translateY(-50%)',
		color: 'scrapscache.textMuted'
	});
	const subBtn = css({
		rounded: 'xl',
		px: '0.75rem',
		py: '0.5rem',
		fontSize: 'sm',
		fontWeight: 'medium',
		color: 'scrapscache.textMuted',
		cursor: 'pointer',
		transition: 'colors 120ms ease',
		_hover: { bg: { base: 'black/5', _dark: 'white/10' }, color: 'scrapscache.text' }
	});
	const delBtn = css({
		rounded: 'xl',
		px: '0.75rem',
		py: '0.5rem',
		fontSize: 'sm',
		fontWeight: 'medium',
		color: { base: 'red.600', _dark: 'red.400' },
		cursor: 'pointer',
		transition: 'colors 120ms ease',
		_hover: { bg: { base: 'red.500/10', _dark: 'red.500/15' } }
	});
	const renameRow = css({ mb: '1rem', display: 'flex', maxW: '28rem', gap: '0.5rem' });
	const renameInput = css({
		minW: 0,
		flex: '1',
		rounded: 'xl',
		borderWidth: '1px',
		borderColor: 'scrapscache.border',
		bg: 'scrapscache.surface',
		px: '0.75rem',
		py: '0.5rem',
		fontSize: 'sm',
		outline: 'none',
		_focus: { ringWidth: '2px', ringColor: 'blue.400/40' }
	});
	const renameSaveBtn = css({
		rounded: 'xl',
		bg: { base: 'black/[0.06]', _dark: 'white/10' },
		px: '0.75rem',
		py: '0.5rem',
		fontSize: 'sm',
		fontWeight: 'medium',
		color: 'scrapscache.text',
		cursor: 'pointer',
		_hover: { bg: { base: 'black/10', _dark: 'white/15' } }
	});
	const columnsContainer = css({ mx: '-1rem', overflowX: 'auto', px: '1rem', pb: '1rem' });
	const columnsTrack = css({
		display: 'flex',
		minW: 'max-content',
		alignItems: 'flex-start',
		gap: '0.75rem'
	});
	const colSection = css({
		w: 'min(calc(var(--note-card-width) + 1.5rem), calc(100vw - 2rem))',
		flexShrink: 0,
		rounded: '2xl',
		bg: { base: 'black/[0.035]', _dark: 'white/[0.055]' },
		p: '0.75rem'
	});
	const colHeadingRow = css({
		mb: '0.5rem',
		display: 'flex',
		alignItems: 'center',
		gap: '0.5rem',
		px: '0.25rem',
		pt: '0.25rem'
	});
	const colTitle = css({
		minW: 0,
		flex: '1',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		fontSize: 'sm',
		fontWeight: '600',
		color: 'scrapscache.text'
	});
	const filterBtn = (active: boolean) =>
		css({
			display: 'grid',
			h: '1.75rem',
			minW: '1.75rem',
			placeItems: 'center',
			rounded: 'lg',
			px: '0.375rem',
			fontSize: 'xs',
			fontWeight: 'medium',
			cursor: 'pointer',
			transition: 'colors 120ms ease',
			bg: active ? 'blue.500/15' : 'transparent',
			color: active ? { base: 'blue.700', _dark: 'blue.300' } : 'scrapscache.textMuted',
			_hover: active
				? {}
				: { bg: { base: 'black/5', _dark: 'white/10' }, color: 'scrapscache.text' }
		});
	const removeColBtn = css({
		display: 'grid',
		h: '1.75rem',
		w: '1.75rem',
		placeItems: 'center',
		rounded: 'lg',
		color: 'scrapscache.textMuted',
		cursor: 'pointer',
		_hover: { bg: 'red.500/10', color: { base: 'red.600', _dark: 'red.400' } }
	});
	const backlogGroup = css({
		mb: '0.5rem',
		display: 'flex',
		flexDirection: 'column',
		gap: '0.5rem',
		rounded: 'xl',
		borderWidth: '1px',
		borderColor: { base: 'black/10', _dark: 'white/10' },
		bg: 'scrapscache.surface',
		p: '0.5rem',
		fontSize: 'xs'
	});
	const radioLabel = css({
		display: 'flex',
		cursor: 'pointer',
		alignItems: 'flex-start',
		gap: '0.5rem',
		rounded: 'lg',
		px: '0.25rem',
		py: '0.25rem',
		_hover: { bg: { base: 'black/[0.04]', _dark: 'white/[0.06]' } }
	});
	const cardsList = css({
		position: 'relative',
		display: 'flex',
		flexDirection: 'column',
		gap: '0.75rem'
	});
	const emptyDrop = css({
		rounded: 'xl',
		borderWidth: '1px',
		borderStyle: 'dashed',
		borderColor: { base: 'black/10', _dark: 'white/10' },
		px: '0.75rem',
		py: '1.25rem',
		textAlign: 'center',
		fontSize: 'xs',
		color: 'scrapscache.textMuted'
	});
	const addColWrap = css({
		position: 'relative',
		w: 'min(calc(var(--note-card-width) + 1.5rem), calc(100vw - 2rem))',
		flexShrink: 0,
		pt: '0.25rem'
	});
	const addColBtn = css({
		display: 'flex',
		w: 'full',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: '0.5rem',
		rounded: 'xl',
		borderWidth: '1px',
		borderStyle: 'dashed',
		borderColor: 'scrapscache.border',
		bg: 'transparent',
		px: '0.75rem',
		py: '0.625rem',
		textAlign: 'left',
		fontSize: 'sm',
		fontWeight: 'medium',
		color: 'scrapscache.textMuted',
		outline: 'none',
		cursor: 'pointer',
		_hover: { bg: { base: 'black/[0.035]', _dark: 'white/[0.055]' }, color: 'scrapscache.text' }
	});
	const menuItemClass = css({
		display: 'block',
		w: 'full',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		px: '0.75rem',
		py: '0.5rem',
		textAlign: 'left',
		fontSize: 'sm',
		color: 'scrapscache.text',
		_hover: { bg: { base: 'black/[0.05]', _dark: 'white/[0.08]' } }
	});

	const hintText = css({ fontSize: '11px', lineHeight: 'snug', color: 'scrapscache.textMuted' });
	const mtHalf = css({ mt: '0.125rem' });
	const optionTitle = css({ fontWeight: 'medium', color: 'scrapscache.text' });
	const optionDesc = css({ mt: '0.125rem', display: 'block', color: 'scrapscache.textMuted' });
	const customFilterIndent = css({
		ml: '0.25rem',
		display: 'flex',
		flexDirection: 'column',
		gap: '0.25rem',
		borderLeftWidth: '2px',
		borderColor: { base: 'black/10', _dark: 'white/10' },
		pl: '0.5rem'
	});
	const checkRow = css({
		display: 'flex',
		cursor: 'pointer',
		alignItems: 'center',
		gap: '0.5rem',
		rounded: 'lg',
		px: '0.25rem',
		py: '0.25rem',
		_hover: { bg: { base: 'black/[0.04]', _dark: 'white/[0.06]' } }
	});
	const checkControl = css({
		display: 'flex',
		h: '1rem',
		w: '1rem',
		alignItems: 'center',
		justifyContent: 'center',
		rounded: 'sm',
		borderWidth: '1px',
		borderColor: 'scrapscache.border',
		'&[data-state=checked]': {
			borderColor: 'scrapscache.accent',
			bg: 'scrapscache.accent'
		}
	});
	const checkMark = css({ fontSize: '10px', color: 'scrapscache.accentForeground' });
	const checkLabel = css({ color: 'scrapscache.text' });
	const checkLabelTruncate = css({
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		color: 'scrapscache.text'
	});
	const emptyTagsNotice = css({ px: '0.25rem', py: '0.25rem', color: 'scrapscache.textMuted' });
	const filterSummary = css({
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		px: '0.25rem',
		fontSize: '10px',
		color: 'scrapscache.textMuted'
	});
	const menuPositionerClass = css({ zIndex: 20, w: '[var(--reference-width)]' });
	const menuContentClass = css({ maxH: '16rem', overflowY: 'auto', py: '0.25rem' });
</script>

<div class={pageWrap}>
	<div class={controlsRow}>
		<div class={selectBox}>
			<select
				aria-label="Kanban board"
				value={board.id}
				onchange={(event) => selectBoard((event.currentTarget as HTMLSelectElement).value)}
				class={selectEl}
			>
				{#each kanbanStore.boards as choice (choice.id)}
					<option value={choice.id}>{choice.name}</option>
				{/each}
			</select>
			<ChevronDown class={selectChevron} aria-hidden="true" />
		</div>
		<button
			type="button"
			class={subBtn}
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
			class={subBtn}
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
			class={delBtn}
			onclick={deleteActiveBoard}
			aria-label={`Delete board ${board.name}`}
		>
			Delete
		</button>
	</div>

	{#if renamingBoard}
		<div class={renameRow}>
			<input
				bind:value={boardName}
				aria-label="Board name"
				onkeydown={(event) => {
					if (event.key === 'Enter') commitBoardName();
					if (event.key === 'Escape') renamingBoard = false;
				}}
				class={renameInput}
			/>
			<button type="button" onclick={commitBoardName} class={renameSaveBtn}> Save </button>
		</div>
	{/if}

	<div class={`kanban-columns ${columnsContainer}`}>
		<div class={columnsTrack}>
			{#each board.columns as column (column.id)}
				{@const items = columnItems(column)}
				<section
					data-kanban-column={column.id}
					class={colSection}
					class:kanban-column-target={kanbanDrag.target?.columnId === column.id}
					aria-label={`${columnName(column)} ${column.labelId === null ? 'Kanban' : 'label'} column`}
				>
					<div class={colHeadingRow}>
						<h2 class={colTitle}>
							{columnName(column)}
						</h2>
						{#if column.labelId === null}
							<button
								type="button"
								class={filterBtn(backlogFilterActive)}
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
								class={removeColBtn}
								aria-label={`Remove ${columnName(column)} label column`}
								title="Remove label column"
							>
								<X size={14} aria-hidden="true" />
							</button>
						{/if}
					</div>

					{#if column.labelId === null && backlogFilterOpen}
						<div class={backlogGroup} role="group" aria-label="Backlog filter options">
							<p class={hintText}>
								Choose which notes show in Backlog. Notes already in a label column are never listed
								here.
							</p>
							<label class={radioLabel}>
								<input
									type="radio"
									name="backlog-mode-{board.id}"
									checked={backlogFilter.mode === BacklogFilterMode.AllNonColumn}
									onchange={() => setBacklogMode(BacklogFilterMode.AllNonColumn)}
									class={mtHalf}
								/>
								<span>
									<span class={optionTitle}>All non-column notes</span>
									<span class={optionDesc}>Default: everything not in a label column</span>
								</span>
							</label>
							<label class={radioLabel}>
								<input
									type="radio"
									name="backlog-mode-{board.id}"
									checked={backlogFilter.mode === BacklogFilterMode.Custom}
									onchange={() => setBacklogMode(BacklogFilterMode.Custom)}
									class={mtHalf}
								/>
								<span class={optionTitle}>Only selected…</span>
							</label>

							{#if backlogFilter.mode === BacklogFilterMode.Custom}
								<div class={customFilterIndent}>
									<Checkbox.Root
										checked={backlogFilter.includeUntagged}
										onCheckedChange={toggleBacklogUntagged}
										class={checkRow}
									>
										<Checkbox.Control class={checkControl}>
											<Checkbox.Indicator class={checkMark}>✓</Checkbox.Indicator>
										</Checkbox.Control>
										<Checkbox.Label class={checkLabel}>No labels</Checkbox.Label>
										<Checkbox.HiddenInput />
									</Checkbox.Root>
									{#each backlogFilterTags as label (label.id)}
										<Checkbox.Root
											checked={backlogFilter.labelIds.includes(label.id)}
											onCheckedChange={() => toggleBacklogLabel(label.id)}
											class={checkRow}
										>
											<Checkbox.Control class={checkControl}>
												<Checkbox.Indicator class={checkMark}>✓</Checkbox.Indicator>
											</Checkbox.Control>
											<Checkbox.Label class={checkLabelTruncate}>{label.name}</Checkbox.Label>
											<Checkbox.HiddenInput />
										</Checkbox.Root>
									{/each}
									{#if backlogFilterTags.length === 0}
										<p class={emptyTagsNotice}>
											No other labels available. Create labels on notes, or remove a label column
											first.
										</p>
									{/if}
								</div>
							{/if}

							<p class={filterSummary} title={backlogFilterSummary()}>
								Showing: {backlogFilterSummary()}
							</p>
						</div>
					{/if}

					<!-- Positioned: card offsets are measured against this list while dragging. -->
					<div class={cardsList} data-kanban-list aria-live="polite">
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
							<div class={emptyDrop}>Drop a note here</div>
						{/if}
					</div>
				</section>
			{/each}

			{#if unusedTags.length > 0}
				<div class={addColWrap}>
					<Menu.Root bind:open={tagPickerOpen} positioning={{ placement: 'bottom-start' }}>
						<Menu.Trigger class={addColBtn} aria-label="Add a label column">
							<span>+ Add label column</span>
							<ChevronDown size={14} aria-hidden="true" />
						</Menu.Trigger>
						<Menu.Positioner class={menuPositionerClass}>
							<Menu.Content class={`scrapscache-popover ${menuContentClass}`} aria-label="Labels">
								{#each unusedTags as label (label.id)}
									<Menu.Item
										value={label.id}
										onSelect={() => addTagColumn(label.id)}
										class={menuItemClass}
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
