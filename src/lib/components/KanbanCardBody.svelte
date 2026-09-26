<script lang="ts">
	// The look of a Kanban card, with no interaction of its own. The board renders
	// it twice: once in the column, once inside the ghost that follows a drag, so
	// the card the user carries is the card they see land.
	import { boardShowsLabel } from '$lib/kanban';
	import { kanbanStore } from '$lib/stores/kanban.svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import type { Note } from '$lib/types';
	import NoteBodyDisplay from './NoteBodyDisplay.svelte';
	import ReminderLabel from './ReminderLabel.svelte';
	import { Lock } from '@lucide/svelte';
	import { cx, css } from 'styled-system/css';
	import { badge, noteCard, noteSurface } from 'styled-system/recipes';

	let { note, shield = false }: { note: Note; shield?: boolean } = $props();

	// Only the labels the board shows: a board narrowed to a few labels keeps its cards quiet.
	const labelsForNote = $derived(
		note.labels
			.filter((id) => boardShowsLabel(kanbanStore.activeBoard, id))
			.map((id) => notesStore.labelsById.get(id))
			.filter((label): label is NonNullable<typeof label> => !!label)
	);

	const card = noteCard();
	let labelsOwnsPointer: number | null = null;
</script>

<div
	class={cx(
		'kanban-card',
		noteSurface({ color: note.color }),
		css({
			overflow: 'hidden',
			rounded: 'dialog',
			borderWidth: 'hairline',
			borderColor: 'scrapscache.borderFaint',
			boxShadow: 'sm',
			touchAction: 'pan-y',
			userSelect: 'none'
		})
	)}
>
	<div
		class={cx(
			css({ position: 'relative', maxH: '240px', overflow: 'hidden' }),
			note.secret && css({ display: 'flex', flexDirection: 'column' })
		)}
	>
		<div
			class={cx(
				css({ w: 'full', textAlign: 'left', p: 'md' }),
				note.secret && css({ flex: '1', minH: 0, display: 'flex', flexDirection: 'column', p: 0 })
			)}
		>
			{#if note.reminder != null}
				<div
					class={cx(
						css({ flexShrink: 0 }),
						!note.secret && css({ mb: '2xs' }),
						note.secret && css({ px: 'md', pt: 'md' })
					)}
				>
					<ReminderLabel reminder={note.reminder} variant="inline" />
				</div>
			{/if}
			{#if note.title}
				<h3
					class={cx(
						card.title,
						css({ flexShrink: 0 }),
						!note.secret && css({ mb: '2xs' }),
						note.secret && css({ px: 'md', pt: note.reminder == null ? 'md' : 0, pb: 'sm' })
					)}
				>
					{note.title}
				</h3>
			{/if}
			<div
				class={cx(
					css({ position: 'relative', minH: '3rem' }),
					note.secret && css({ flex: '1', minH: 0, overflow: 'hidden' })
				)}
			>
				<div
					class={cx(
						css({}),
						note.secret &&
							css({
								filter: 'blur(4px)',
								userSelect: 'none',
								h: 'full',
								overflow: 'hidden',
								px: 'md',
								pb: 'md',
								pt: !note.title && note.reminder == null ? 'sm' : 0
							})
					)}
				>
					<NoteBodyDisplay {note} />
				</div>
				{#if note.secret}
					<div
						class={cx(card.hazeOverlay, css({ pointerEvents: 'none', zIndex: 10 }))}
						data-secret-overlay
						aria-hidden="true"
					>
						<Lock
							class={css({
								w: '1.5rem',
								h: '1.5rem',
								color: 'scrapscache.textMuted',
								filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.35))'
							})}
						/>
					</div>
				{/if}
			</div>
		</div>
		{#if shield}
			<!-- Every press lands here, so links, photos, canvases and files can
			     never swallow a drag or start one of their own. -->
			<div class={card.shield} data-card-shield aria-hidden="true"></div>
		{/if}
	</div>

	{#if labelsForNote.length}
		<!-- Kanban drag owns presses on the card shell; when tags overflow, keep the press local. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class={cx(card.labelsRow, 'note-scrollbar-hidden')}
			data-card-hscroll
			onpointerdown={(e) => {
				const el = e.currentTarget as HTMLElement;
				if (el.scrollWidth > el.clientWidth + 1 && !(e.pointerType === 'mouse' && e.button !== 0)) {
					e.stopPropagation();
					labelsOwnsPointer = e.pointerId;
				}
			}}
			onpointermove={(e) => {
				if (labelsOwnsPointer !== e.pointerId) return;
				e.stopPropagation();
			}}
			onpointerup={(e) => {
				if (labelsOwnsPointer !== e.pointerId) return;
				labelsOwnsPointer = null;
				e.stopPropagation();
			}}
			onpointercancel={(e) => {
				if (labelsOwnsPointer !== e.pointerId) return;
				labelsOwnsPointer = null;
				e.stopPropagation();
			}}
		>
			{#each labelsForNote as label (label.id)}
				<span class={badge()}>{label.name}</span>
			{/each}
		</div>
	{/if}
</div>
