<script lang="ts">
	import { sva } from 'styled-system/css';
	import '../app.css';
	import { uiStore, type View } from '$lib/stores/ui.svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { syncStore, syncEventsClient } from '$lib/stores/sync.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Topbar from '$lib/components/Topbar.svelte';
	import NoteEditor from '$lib/components/NoteEditor.svelte';
	import ReminderAlert from '$lib/components/ReminderAlert.svelte';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import AppViews from '$lib/components/AppViews.svelte';
	import { reminderStore } from '$lib/stores/reminders.svelte';
	import { preloadVapidPublicKey } from '$lib/reminderWake';
	import { provideEditorActions } from '$lib/editorContext';
	import { splitPastedHeading } from '$lib/checklistBody';
	import { Drawer } from '@ark-ui/svelte/drawer';
	import { onMount } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { attachSyncCloudIndicator } from '$lib/syncCloudIndicator';
	import { attachAppViewport } from '$lib/appViewport';
	import { attachSidebarSwipe } from '$lib/sidebarSwipe';
	import { dayKey, reminderTimeForDay } from '$lib/utils';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const mobile = new MediaQuery('max-width: 767px');
	let editingId = $state<string | null>(null);
	let closeOpenNote: (() => void) | null = null;

	function applyEditorOpen(open: boolean) {
		document.documentElement.classList.toggle('editor-open', open);
	}

	function openEditor(id: string) {
		editingId = id;
		applyEditorOpen(true);
		if (syncStore.isLoggedIn) void notesStore.syncWithCloud();
	}

	function openNoteFromQuery() {
		const noteId = new URL(window.location.href).searchParams.get('note');
		if (!noteId || !notesStore.notes.some((note) => note.id === noteId)) return;
		editingId = noteId;
		applyEditorOpen(true);
		const next = new URL(window.location.href);
		next.searchParams.delete('note');
		history.replaceState(history.state, '', `${next.pathname}${next.search}${next.hash}`);
	}

	onMount(() => {
		applyEditorOpen(editingId !== null);
		const stopViewport = attachAppViewport(document.documentElement);
		uiStore.viewChangeHandler = restoreFeedScroll;
		attachSyncCloudIndicator(syncStore);
		notesStore.onAfterSync = () => reminderStore.publish(notesStore.notes);
		notesStore.onProfileReload = (pid, notes) => reminderStore.activateProfile(pid, notes);
		if (mobile.current) uiStore.sidebarOpen = false;
		void notesStore.init().then(async () => {
			await notesStore.refreshProfileEffects();
			if (syncStore.isLoggedIn) await notesStore.syncWithCloud();
			openNoteFromQuery();
		});
		const onForeground = () => {
			if (document.visibilityState === 'hidden') return;
			if (syncStore.isLoggedIn) void notesStore.syncWithCloud();
		};
		document.addEventListener('visibilitychange', onForeground);
		const stopSyncEvents = syncEventsClient.subscribe((seq?: number) => {
			void notesStore.triggerSync(seq);
		});
		const stopReminders = reminderStore.attach(openEditor);
		void preloadVapidPublicKey();
		if ('serviceWorker' in navigator) {
			if (import.meta.env.PROD) {
				// Version query forces browsers to re-fetch sw.js after deploys.
				void navigator.serviceWorker
					.register('/sw.js', { updateViaCache: 'none' })
					.then((reg) => reg.update())
					.then(() => reminderStore.sync(notesStore.notes))
					.catch(() => undefined);
			} else {
				void navigator.serviceWorker
					.getRegistrations()
					.then((registrations) => {
						for (const registration of registrations) void registration.unregister();
					})
					.catch(() => undefined);
			}
		}
		return () => {
			stopSyncEvents();
			notesStore.onProfileReload = null;
			uiStore.viewChangeHandler = null;
			stopViewport();
			applyEditorOpen(false);
			document.removeEventListener('visibilitychange', onForeground);
			stopReminders();
		};
	});

	function startNewNote(seed?: { title?: string; body?: string }) {
		const labels =
			uiStore.view === 'label' &&
			uiStore.activeLabelId &&
			notesStore.labels.some((label) => label.id === uiStore.activeLabelId)
				? [uiStore.activeLabelId]
				: [];
		const n = notesStore.createNote({
			title: seed?.title ?? '',
			body: seed?.body ?? '',
			labels,
			reminder:
				uiStore.view === 'reminders'
					? reminderTimeForDay(uiStore.reminderFilter?.from ?? dayKey(Date.now()))
					: null
		});
		editingId = n.id;
		applyEditorOpen(true);
	}

	// Paste on the note gallery (no editor open, no editable field focused)
	// starts a new note seeded with the pasted text and opens it for editing.
	function handleGalleryPaste(event: ClipboardEvent) {
		if (editingId !== null) return;
		if (!(event.target instanceof Element)) return;
		if (event.target.closest('input, textarea, [contenteditable], .canvas-editor-shell')) return;
		const text = event.clipboardData?.getData('text/plain');
		if (!text?.trim()) return;
		event.preventDefault();
		const split = splitPastedHeading(text);
		startNewNote(split ? { title: split.title, body: split.body } : { body: text });
	}

	function requestCloseEditor() {
		closeOpenNote?.();
	}

	provideEditorActions({ openNote: openEditor, startNewNote, closeNote: requestCloseEditor });

	let feedEl: HTMLElement | null = $state(null);

	// Preserve each view's scroll offset across switches; display:none panes
	// would otherwise lose it. Save on scroll so restore does not need to
	// read scrollTop after the outgoing pane is already hidden.
	const scrollTops = new Map<string, number>();

	function viewKey(view: View, labelId: string | null): string {
		return labelId ? `${view}:${labelId}` : view;
	}

	function rememberFeedScroll() {
		if (!feedEl) return;
		scrollTops.set(viewKey(uiStore.view, uiStore.activeLabelId), feedEl.scrollTop);
	}

	function restoreFeedScroll() {
		if (!feedEl) return;
		const key = viewKey(uiStore.view, uiStore.activeLabelId);
		const target = scrollTops.get(key) ?? 0;
		queueMicrotask(() => {
			if (feedEl && viewKey(uiStore.view, uiStore.activeLabelId) === key) {
				feedEl.scrollTop = target;
			}
		});
	}

	function closeEditor() {
		editingId = null;
		applyEditorOpen(false);
	}

	function closeMobileSidebar() {
		uiStore.sidebarOpen = false;
	}

	const shellSva = sva({
		slots: [
			'shell',
			'drawerBackdrop',
			'drawerPositioner',
			'drawerContent',
			'desktopSidebar',
			'mainCol',
			'canvas',
			'feed'
		],
		base: {
			shell: {
				display: 'flex',
				h: 'full',
				w: 'full',
				overflow: 'hidden',
				bg: 'scrapscache.bg',
				color: 'scrapscache.text'
			},
			drawerBackdrop: {
				position: 'fixed',
				inset: 0,
				zIndex: 20,
				bg: 'scrapscache.backdropSoft'
			},
			drawerPositioner: { position: 'fixed', left: 0, top: 0, zIndex: 30, h: 'full' },
			drawerContent: {
				h: 'full',
				w: '18rem',
				borderRightWidth: '1px',
				borderColor: 'scrapscache.border',
				bg: 'scrapscache.surface'
			},
			desktopSidebar: {
				w: '16rem',
				flexShrink: 0,
				borderRightWidth: '1px',
				borderColor: 'scrapscache.border'
			},
			mainCol: { display: 'flex', minH: 0, minW: 0, flex: '1', flexDirection: 'column' },
			canvas: { position: 'relative', minH: 0, minW: 0, flex: '1' },
			feed: {
				h: 'full',
				minH: 0,
				overflowY: 'auto',
				overflowX: 'hidden',
				px: '1rem',
				pb: { base: '5rem', md: '1.5rem' }
			}
		}
	});
	const shell = shellSva();
</script>

<svelte:head>
	<title>Scraps Cache</title>
	<meta name="theme-color" content={uiStore.effectiveDark ? '#1a1a1a' : '#ffffff'} />
</svelte:head>

<svelte:window onpaste={handleGalleryPaste} />

<div class="app-viewport">
	<div
		class={`app-shell ${shell.shell}`}
		{@attach mobile.current &&
			attachSidebarSwipe({
				getOpen: () => uiStore.sidebarOpen,
				open: () => {
					uiStore.sidebarOpen = true;
				},
				close: () => {
					uiStore.sidebarOpen = false;
				}
			})}
	>
		{#if mobile.current}
			<Drawer.Root
				open={uiStore.sidebarOpen}
				onOpenChange={(details) => {
					uiStore.sidebarOpen = details.open;
				}}
				swipeDirection="start"
				preventScroll={false}
				lazyMount
				unmountOnExit
			>
				<Drawer.Backdrop
					data-sidebar-backdrop
					aria-label="Close sidebar"
					class={shell.drawerBackdrop}
				/>
				<Drawer.Positioner class={shell.drawerPositioner}>
					<Drawer.Content
						class={shell.drawerContent}
						role="navigation"
						aria-label="Sidebar"
						data-sidebar-drawer
					>
						<Sidebar onNavigate={closeMobileSidebar} />
					</Drawer.Content>
				</Drawer.Positioner>
			</Drawer.Root>
		{:else}
			{#if uiStore.sidebarOpen}
				<div class={shell.desktopSidebar}>
					<Sidebar />
				</div>
			{/if}
		{/if}

		<div class={shell.mainCol}>
			<Topbar />
			<div class={`app-canvas ${shell.canvas}`}>
				<main
					bind:this={feedEl}
					class={`app-feed scrollable ${shell.feed}`}
					onscroll={rememberFeedScroll}
				>
					<AppViews />
				</main>
				<div class="app-float" data-app-float>
					<BottomNav />
					<ReminderAlert />
					{#key editingId}
						<NoteEditor
							noteId={editingId}
							onClose={closeEditor}
							registerClose={(fn) => {
								closeOpenNote = fn;
							}}
						/>
					{/key}
				</div>
			</div>
		</div>
	</div>
</div>
<div class="app-overlay" data-app-overlay></div>
{@render children()}
