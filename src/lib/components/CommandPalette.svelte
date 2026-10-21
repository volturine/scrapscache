<script lang="ts">
	// One box for notes, labels and actions (Mod+K; the Search tab on a phone). Notes
	// come from every place, archived and trashed ones marked; with nothing typed it
	// lists the notes opened last on this device and the actions.
	import {
		commandPaletteStyles as styles,
		iconSizeMd as iconMd,
		searchStyles
	} from '$panda/styles';
	import { tick } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { goto } from '$app/navigation';
	import {
		AlarmClock,
		Archive,
		ArrowLeft,
		Cloud,
		CornerDownLeft,
		Download,
		Kanban,
		LayoutGrid,
		List,
		Moon,
		Plus,
		Search,
		StickyNote,
		Sun,
		Tag,
		Trash2,
		type LucideIcon
	} from '@lucide/svelte';
	import { PHONE_MEDIA, portalToAppOverlay } from '#lib/appViewport.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import { readRecentNotes } from '#lib/recentNotes.js';
	import { matchSegments, type MatchSegment } from '#lib/search.js';
	import { notesStore } from '#lib/stores/notes.svelte.js';
	import { syncStore } from '#lib/stores/sync.svelte.js';
	import { uiStore, type View } from '#lib/stores/ui.svelte.js';
	import type { Note } from '#lib/types.js';
	import { noteActivity } from '#lib/utils.js';
	import { pathForView } from '#lib/viewRoutes.js';
	import { cx } from 'styled-system/css';
	import { dialog, iconButton, input, noteSurface } from 'styled-system/recipes';

	let { onClose, onBackup }: { onClose: () => void; onBackup: () => void } = $props();

	const NOTE_LIMIT = 8;
	const LABEL_LIMIT = 4;

	type Group = 'Recent' | 'Notes' | 'Labels' | 'Actions';
	type Entry = {
		key: string;
		group: Group;
		title: MatchSegment[];
		detail: MatchSegment[];
		badge: string | null;
		note: Note | null;
		icon: LucideIcon | null;
		run: () => void;
	};
	type Action = {
		key: string;
		title: string;
		icon: LucideIcon;
		keywords?: string;
		run: () => void;
	};

	const { openNote, startNewNote, closeNote } = useEditorActions();
	const phone = new MediaQuery(PHONE_MEDIA, false);
	const id = $props.id();
	const listId = `${id}-list`;
	const optionId = (index: number) => `${id}-option-${index}`;

	let query = $state('');
	let active = $state(0);
	let field = $state<HTMLInputElement | null>(null);
	const q = $derived(query.trim());
	const needle = $derived(q.toLowerCase());
	// Read once: the list should not shift under the pointer while the palette is open.
	const recentIds = readRecentNotes(syncStore.activePid);

	/** A line as the card shows it, without its Markdown list, heading or quote marker. */
	function plainLine(line: string): string {
		return line
			.replace(/^\s*(?:#{1,6}\s+|(?:[-*+]\s+)?\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '')
			.trim();
	}

	function bodyLines(note: Note): string[] {
		return (note.body ?? '').split('\n').map(plainLine).filter(Boolean);
	}

	/** The title, or the first line standing in for one. */
	function noteTitle(note: Note): string {
		return note.title.trim() || bodyLines(note)[0] || 'Untitled note';
	}

	/** A long line cut down around the match, so the matched words stay in view. */
	function around(line: string, at: number): string {
		if (line.length <= 90) return line;
		let start = Math.max(0, at - 30);
		// Start on a word, not halfway through one.
		const space = line.slice(start, at).search(/\s/);
		if (start > 0 && space >= 0) start += space + 1;
		const end = Math.min(line.length, start + 90);
		return `${start > 0 ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`;
	}

	function noteDetail(note: Note): string {
		const lines = note.title.trim() ? bodyLines(note) : bodyLines(note).slice(1);
		if (needle) {
			for (const line of lines) {
				const at = line.toLowerCase().indexOf(needle);
				if (at >= 0) return around(line, at);
			}
			const labels = note.labels
				.map((labelId) => notesStore.labelsById.get(labelId)?.name)
				.filter((name): name is string => !!name);
			if (labels.some((name) => name.toLowerCase().includes(needle))) return labels.join(' · ');
		}
		return lines[0] ? around(lines[0], 0) : '';
	}

	function place(note: Note): string | null {
		return note.trashed ? 'In Trash' : note.archived ? 'Archived' : null;
	}

	function noteEntry(note: Note, group: Group, detail: string): Entry {
		return {
			key: `${group}:${note.id}`,
			group,
			title: matchSegments(noteTitle(note), q),
			detail: matchSegments(detail, q),
			badge: place(note),
			note,
			icon: null,
			run: () => openNote(note.id)
		};
	}

	function go(view: View, labelId: string | null = null) {
		const target = pathForView(view, labelId);
		if (!target) return;
		closeNote();
		uiStore.setView(view, labelId);
		void goto(target);
	}

	const PLACES: { view: Exclude<View, 'label'>; title: string; icon: LucideIcon }[] = [
		{ view: 'notes', title: 'Go to Notes', icon: StickyNote },
		{ view: 'reminders', title: 'Go to Reminders', icon: AlarmClock },
		{ view: 'kanban', title: 'Go to Kanban', icon: Kanban },
		{ view: 'archive', title: 'Go to Archive', icon: Archive },
		{ view: 'trash', title: 'Go to Trash', icon: Trash2 }
	];

	const actions = $derived.by((): Action[] => {
		const dark = uiStore.effectiveDark;
		const grid = uiStore.layout === 'grid';
		return [
			{
				key: 'new',
				title: 'New note',
				icon: Plus,
				keywords: 'create add write',
				run: () => startNewNote()
			},
			...PLACES.filter((entry) => entry.view !== uiStore.view).map((entry) => ({
				key: `go-${entry.view}`,
				title: entry.title,
				icon: entry.icon,
				run: () => go(entry.view)
			})),
			{
				key: 'theme',
				title: dark ? 'Switch to light theme' : 'Switch to dark theme',
				icon: dark ? Sun : Moon,
				keywords: 'theme appearance mode',
				run: () => uiStore.setTheme(dark ? 'light' : 'dark')
			},
			{
				key: 'layout',
				title: grid ? 'Show notes as a list' : 'Show notes as a grid',
				icon: grid ? List : LayoutGrid,
				keywords: 'layout view',
				run: () => (uiStore.layout = grid ? 'list' : 'grid')
			},
			{
				key: 'backup',
				title: 'Back up notes…',
				icon: Download,
				keywords: 'export download save',
				run: onBackup
			},
			{
				key: 'sync',
				title: 'Sync settings',
				icon: Cloud,
				keywords: 'cloud devices pair',
				run: () => (uiStore.syncOpen = true)
			}
		];
	});

	function actionMatches(action: Action): boolean {
		if (action.title.toLowerCase().includes(needle)) return true;
		return (action.keywords ?? '').split(' ').some((word) => word.startsWith(needle));
	}

	function actionEntry(action: Action): Entry {
		return {
			key: `Actions:${action.key}`,
			group: 'Actions',
			title: matchSegments(action.title, q),
			detail: [],
			badge: null,
			note: null,
			icon: action.icon,
			run: action.run
		};
	}

	/** Active notes first, then archived, then trashed. */
	function placeRank(note: Note): number {
		return note.trashed ? 2 : note.archived ? 1 : 0;
	}

	const entries = $derived.by((): Entry[] => {
		if (!needle) {
			const recent = recentIds
				.map((noteId) => notesStore.notes.find((note) => note.id === noteId))
				.filter((note): note is Note => !!note)
				.slice(0, 5)
				.map((note) => noteEntry(note, 'Recent', noteActivity(note).label));
			return [...recent, ...actions.map(actionEntry)];
		}
		const notes = notesStore
			.search(q, notesStore.notes)
			.map((note, index) => ({ note, index }))
			.sort((a, b) => placeRank(a.note) - placeRank(b.note) || a.index - b.index)
			.slice(0, NOTE_LIMIT)
			.map(({ note }) => noteEntry(note, 'Notes', noteDetail(note)));
		const labels = notesStore.labels
			.filter((label) => label.name.toLowerCase().includes(needle))
			.slice(0, LABEL_LIMIT)
			.map((label): Entry => {
				const count = notesStore.activeNotes.filter((note) =>
					note.labels.includes(label.id)
				).length;
				return {
					key: `Labels:${label.id}`,
					group: 'Labels',
					title: matchSegments(label.name, q),
					detail: [
						{
							text:
								count === 0
									? 'No notes with this label yet'
									: `Show the ${count === 1 ? 'note' : `${count} notes`} with this label`,
							match: false
						}
					],
					badge: null,
					note: null,
					icon: Tag,
					run: () => go('label', label.id)
				};
			});
		return [...notes, ...labels, ...actions.filter(actionMatches).map(actionEntry)];
	});

	const groups = $derived.by(() => {
		const byGroup = new Map<Group, { entry: Entry; index: number }[]>();
		entries.forEach((entry, index) => {
			const list = byGroup.get(entry.group) ?? [];
			list.push({ entry, index });
			byGroup.set(entry.group, list);
		});
		return [...byGroup].map(([name, items]) => ({ name, items }));
	});

	const current = $derived(Math.min(active, Math.max(0, entries.length - 1)));

	// The highlighted row stays in view as the arrows move it through a long list.
	$effect(() => {
		document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' });
	});

	function choose(entry: Entry) {
		onClose();
		// After the palette lets go of focus, so a note or dialog it opens can take it.
		void tick().then(entry.run);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.isComposing) return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const count = entries.length;
			if (count === 0) return;
			active = (current + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const entry = entries[current];
			if (entry) choose(entry);
		}
	}

	const d = dialog({ presentation: 'appOverlay' });
</script>

{#snippet marked(segments: MatchSegment[])}
	{#each segments as segment, index (index)}
		{#if segment.match}<mark class={searchStyles.mark}>{segment.text}</mark
			>{:else}{segment.text}{/if}
	{/each}
{/snippet}

<Dialog.Root
	open
	onOpenChange={(details) => {
		if (!details.open) onClose();
	}}
	initialFocusEl={() => field}
	preventScroll={false}
	lazyMount
	unmountOnExit
>
	<div {@attach portalToAppOverlay} class={d.portal} role="presentation">
		<Dialog.Backdrop class={d.backdrop} />
		<Dialog.Positioner class={cx(d.positioner, phone.current && styles.phonePositioner)}>
			<Dialog.Content
				class={cx(d.panel, styles.panel, phone.current && styles.phonePanel)}
				aria-label="Search notes, labels and actions"
			>
				<div class={styles.inputRow}>
					{#if phone.current}
						<button
							type="button"
							class={iconButton({ variant: 'ghost', size: 'compact' })}
							onclick={onClose}
							aria-label="Close search"
						>
							<ArrowLeft class={iconMd} aria-hidden="true" />
						</button>
					{:else}
						<Search class={styles.searchIcon} aria-hidden="true" />
					{/if}
					<input
						bind:this={field}
						bind:value={query}
						oninput={() => (active = 0)}
						onkeydown={onKeydown}
						type="text"
						role="combobox"
						aria-expanded="true"
						aria-controls={listId}
						aria-autocomplete="list"
						aria-activedescendant={entries.length > 0 ? optionId(current) : undefined}
						aria-label="Search notes, labels and actions"
						placeholder="Search notes, labels and actions"
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
						enterkeyhint="go"
						class={cx(input({ variant: 'unstyled' }), styles.input)}
					/>
					{#if !phone.current}<kbd class={styles.kbd}>esc</kbd>{/if}
				</div>
				<div class={styles.results}>
					<div id={listId} role="listbox" aria-label="Results">
						{#each groups as group (group.name)}
							<div role="group" aria-labelledby={`${id}-${group.name}`} class={styles.group}>
								<div id={`${id}-${group.name}`} class={styles.groupLabel}>{group.name}</div>
								{#each group.items as { entry, index } (entry.key)}
									<!-- svelte-ignore a11y_click_events_have_key_events -- the field's arrows and Enter drive the list -->
									<div
										id={optionId(index)}
										role="option"
										tabindex="-1"
										aria-selected={index === current}
										class={styles.option}
										onpointermove={() => (active = index)}
										onmousedown={(event) => event.preventDefault()}
										onclick={() => choose(entry)}
									>
										{#if entry.note}
											<span
												class={cx(styles.dot, noteSurface({ color: entry.note.color }))}
												aria-hidden="true"
											></span>
										{:else if entry.icon}
											<span class={styles.iconBox} aria-hidden="true">
												<entry.icon class={styles.icon} />
											</span>
										{/if}
										<span class={styles.text}>
											<span class={styles.title}>{@render marked(entry.title)}</span>
											{#if entry.detail.length > 0}
												<span class={styles.detail}>{@render marked(entry.detail)}</span>
											{/if}
										</span>
										{#if entry.badge}<span class={styles.badge}>{entry.badge}</span>{/if}
										{#if index === current && !phone.current}
											<CornerDownLeft class={styles.enter} aria-hidden="true" />
										{/if}
									</div>
								{/each}
							</div>
						{/each}
					</div>
					{#if needle && entries.length === 0}
						<p class={styles.empty} role="status">Nothing matches “{q}”.</p>
					{/if}
				</div>
				{#if !phone.current}
					<div class={styles.footer} aria-hidden="true">
						<span><kbd class={styles.kbd}>↑</kbd><kbd class={styles.kbd}>↓</kbd> move</span>
						<span><kbd class={styles.kbd}>↵</kbd> open</span>
						<span><kbd class={styles.kbd}>esc</kbd> close</span>
						<span class={styles.footerNote}>Archived and trashed notes are marked</span>
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
