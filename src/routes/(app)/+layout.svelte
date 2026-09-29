<script lang="ts">
	import { appLayout as styles } from '$panda/styles';
	import { cx } from 'styled-system/css';
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
	import { reminderHistoryClient } from '$lib/reminderHistoryClient';
	import { getAllNotesMetadata } from '$lib/db/idb';
	import { preloadVapidPublicKey } from '$lib/reminderWake';
	import { provideEditorActions } from '$lib/editorContext';
	import { splitPastedHeading } from '$lib/checklistBody';
	import { Drawer } from '@ark-ui/svelte/drawer';
	import { onMount, untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { attachSyncCloudIndicator } from '$lib/syncCloudIndicator';
	import { attachAppViewport } from '$lib/appViewport';
	import { dayKey, reminderTimeForDay } from '$lib/utils';
	import { noteAddressHistory } from '$lib/noteAddressHistory';
	import { profileForWorkspaceTag, readNoteLink, withNoteLink } from '$lib/noteLinks';
	import { pushState, replaceState } from '$app/navigation';
	import { page, updated } from '$app/state';
	import { version } from '$app/environment';
	import { profileCoordinator } from '$lib/stores/profiles.svelte';
	import type { StoredProfile } from '$lib/profiles';
	import NoteLinkNotice from '$lib/components/NoteLinkNotice.svelte';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const mobile = new MediaQuery('max-width: 767px');
	let editingId = $state<string | null>(null);
	let autoFocusBody = $state(false);
	let closeOpenNote: (() => Promise<void>) | null = null;
	let reloadingForUpdate = false;

	$effect(() => {
		if (!updated.current || editingId !== null || reloadingForUpdate) return;
		reloadingForUpdate = true;
		window.location.reload();
	});

	function applyEditorOpen(open: boolean) {
		document.documentElement.classList.toggle('editor-open', open);
	}

	function openEditor(id: string) {
		autoFocusBody = false;
		editingId = id;
		applyEditorOpen(true);
	}

	/** Open a note in its own workspace: a reminder from another one switches to it first. */
	async function openNoteInWorkspace(pid: string, noteId: string) {
		if (pid !== syncStore.activeId) {
			if (editingId !== null) await closeOpenNote?.();
			const switched = await profileCoordinator.switchTo(pid);
			if (!switched.success) {
				noteLinkProblem = switched.error ?? 'Could not open that workspace.';
				return;
			}
		}
		openEditor(noteId);
	}

	/** Receipts reconcile on their own channel, even while note sync is busy. */
	function reconcileReminders(pid: string) {
		void reminderHistoryClient
			.exchange(pid)
			.catch(() => undefined)
			.finally(() => reminderStore.receiptsSettled(pid));
	}

	let noteLinkProblem = $state<string | null>(null);
	/** Off until the address this window opened with has been read. */
	let addressFollowsNote = $state(false);
	/** History entry pushed so Back closes the note instead of leaving the page. */
	let noteEntry: string | null = null;
	/** Back already popped the note entry; don't push it again while the editor saves and closes. */
	let notePopped = false;
	/** Forward or back landed on a note entry that is already in history. */
	let noteFromHistory = false;

	// The address names the open note and its workspace, so copying it shares
	// the note and reloading reopens it. The note gets its own history entry
	// so Back closes it. Later changes to that entry are replaced, which does
	// not fire hashchange.
	$effect(() => {
		if (!addressFollowsNote) return;
		const noteId = editingId;
		const workspace = syncStore.activeProfile;
		untrack(() => showNoteInAddress(noteId, workspace));
	});

	function addressOf(url: URL): string {
		return `${url.pathname}${url.search}${url.hash}`;
	}

	function showNoteInAddress(noteId: string | null, workspace: StoredProfile | null) {
		if (notePopped) {
			if (!noteId) notePopped = false;
			return;
		}
		const url = new URL(window.location.href);
		const current = addressOf(url);
		const next = withNoteLink(url, noteId && workspace ? { profile: workspace, noteId } : null);
		if (noteFromHistory && noteId) {
			noteFromHistory = false;
			noteEntry = next;
			return;
		}
		const update = noteAddressHistory({
			current,
			next,
			closed: withNoteLink(url, null),
			open: noteId !== null,
			covering: noteEntry
		});
		noteEntry = update.covering;
		if (update.replace) replaceState(update.replace, page.state);
		// Only the hash changes, so SvelteKit treats Back to the page underneath as
		// shallow routing: it restores the address and state without navigating.
		if (update.push) pushState(update.push, page.state);
		if (update.back) history.back();
	}

	/**
	 * Open the note a link points at, in the workspace the link names. Runs once
	 * the boot workspace has loaded and synced. A link without a workspace opens
	 * in the active one.
	 */
	async function openNoteFromLink() {
		try {
			await followNoteLink();
		} finally {
			addressFollowsNote = true;
		}
	}

	async function followNoteLink() {
		const link = readNoteLink(new URL(window.location.href));
		if (!link || link.noteId === editingId) return;
		// A link pasted into an open tab lands while another note may be open: save it first.
		if (editingId !== null) await closeOpenNote?.();
		if (link.workspaceTag) {
			const workspace = profileForWorkspaceTag(syncStore.profiles, link.workspaceTag);
			if (!workspace) {
				noteLinkProblem =
					"This note is in a workspace that isn't on this device. Connect this device to that workspace first, then open the link again.";
				return;
			}
			const switched = await profileCoordinator.switchTo(workspace.id);
			if (!switched.success) {
				noteLinkProblem = switched.error ?? `Could not switch to ${workspace.name}.`;
				return;
			}
			// The switch syncs in the background; a note only on the relay arrives with it.
			if (!notesStore.notes.some((note) => note.id === link.noteId))
				await notesStore.reconcileWithCloud();
		}
		if (!notesStore.notes.some((note) => note.id === link.noteId)) {
			noteLinkProblem = `This note isn't in ${syncStore.activeProfile?.name ?? 'this workspace'}. It may have been deleted, or it hasn't synced to this device yet.`;
			return;
		}
		openEditor(link.noteId);
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
			await openNoteFromLink();
		});
		// Pasting a link into this tab only changes the fragment; nothing reloads.
		const onHashChange = async () => {
			if (!addressFollowsNote) return;
			await followNoteLink();
			// A link that could not open leaves the address as the open note has it.
			showNoteInAddress(editingId, syncStore.activeProfile);
		};
		window.addEventListener('hashchange', onHashChange);
		const onPopState = () => {
			const here = addressOf(new URL(window.location.href));
			if (editingId !== null && noteEntry !== null && here !== noteEntry) {
				noteEntry = null;
				notePopped = true;
				if (closeOpenNote) void closeOpenNote();
				else closeEditor();
				return;
			}
			if (editingId === null && readNoteLink(new URL(window.location.href))) noteFromHistory = true;
		};
		window.addEventListener('popstate', onPopState);
		const onForeground = () => {
			if (document.visibilityState === 'hidden') return;
			if (syncStore.isLoggedIn) void notesStore.syncWithCloud();
		};
		document.addEventListener('visibilitychange', onForeground);
		const stopSyncEvents = syncEventsClient.subscribe((seq?: number) => {
			void notesStore.triggerSync(seq);
		});
		const stopReminderHistory = reminderHistoryClient.attach();
		const stopReminders = reminderStore.attach({
			workspaces: () =>
				syncStore.profiles.map((profile) => ({ id: profile.id, linked: !!profile.syncKey })),
			loadNotes: (pid) => getAllNotesMetadata(pid),
			reconcile: reconcileReminders,
			openNote: (pid, noteId) => void openNoteInWorkspace(pid, noteId)
		});
		void preloadVapidPublicKey();
		if ('serviceWorker' in navigator) {
			if (import.meta.env.PROD) {
				void navigator.serviceWorker
					.register(`/sw.js?v=${encodeURIComponent(version)}`, { updateViaCache: 'none' })
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
			window.removeEventListener('hashchange', onHashChange);
			window.removeEventListener('popstate', onPopState);
			stopSyncEvents();
			notesStore.onProfileReload = null;
			uiStore.viewChangeHandler = null;
			stopViewport();
			applyEditorOpen(false);
			document.removeEventListener('visibilitychange', onForeground);
			stopReminders();
			stopReminderHistory();
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
		autoFocusBody = true;
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
		void closeOpenNote?.();
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
		autoFocusBody = false;
		applyEditorOpen(false);
	}

	function closeMobileSidebar() {
		uiStore.sidebarOpen = false;
	}

	const metaTitle = $derived.by(() => {
		switch (uiStore.view) {
			case 'kanban':
				return 'Kanban · Scraps Cache';
			case 'reminders':
				return 'Reminders · Scraps Cache';
			case 'archive':
				return 'Archive · Scraps Cache';
			case 'trash':
				return 'Trash · Scraps Cache';
			case 'label': {
				const label = notesStore.labels.find((l) => l.id === uiStore.activeLabelId);
				return label ? `${label.name} · Scraps Cache` : 'Label · Scraps Cache';
			}
			default:
				return 'Scraps Cache';
		}
	});

	const metaDescription = $derived.by(() => {
		switch (uiStore.view) {
			case 'kanban':
				return 'Organize and manage your notes visually in customizable Kanban columns.';
			case 'reminders':
				return 'Keep track of scheduled alerts, deadlines, and reminders in Scraps Cache.';
			case 'archive':
				return 'Browse archived notes stored securely offline with optional encryption.';
			case 'trash':
				return 'Review and restore deleted notes, or permanently empty trash.';
			case 'label': {
				const label = notesStore.labels.find((l) => l.id === uiStore.activeLabelId);
				return label
					? `Notes tagged with #${label.name} in Scraps Cache.`
					: 'Labeled notes in Scraps Cache.';
			}
			default:
				return 'Offline-first notes with optional end-to-end encrypted multi-device sync. Private by design, fast, and self-hostable.';
		}
	});
</script>

<svelte:head>
	<title>{metaTitle}</title>
	<meta name="description" content={metaDescription} />
	<meta property="og:title" content={metaTitle} />
	<meta property="og:description" content={metaDescription} />
	<meta name="twitter:title" content={metaTitle} />
	<meta name="twitter:description" content={metaDescription} />
	<meta name="theme-color" content={uiStore.effectiveDark ? '#1a1a1a' : '#ffffff'} />
</svelte:head>

<svelte:window onpaste={handleGalleryPaste} />

<div class="app-viewport">
	<div class={cx('app-shell', styles.shell)}>
		{#if mobile.current}
			<Drawer.Root
				open={uiStore.sidebarOpen}
				onOpenChange={(details) => {
					uiStore.sidebarOpen = details.open;
				}}
				preventScroll={false}
				lazyMount
				unmountOnExit
			>
				<Drawer.Backdrop
					data-sidebar-backdrop
					aria-label="Close sidebar"
					class={styles.backdrop}
					onclick={closeMobileSidebar}
				/>
				<Drawer.Positioner class={styles.drawerPositioner}>
					<Drawer.Content
						draggable={false}
						class={styles.drawer}
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
				<div class={styles.sidebar}>
					<Sidebar />
				</div>
			{/if}
		{/if}

		<div class={styles.column}>
			<Topbar />
			<div class={cx('app-canvas', styles.canvas)}>
				<main
					bind:this={feedEl}
					class={cx('app-feed scrollable', styles.feed)}
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
							autofocusBody={autoFocusBody}
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
{#if mobile.current && uiStore.sidebarOpen}
	<div class={styles.drawerSafeArea} aria-hidden="true"></div>
{/if}
<div class="app-overlay" data-app-overlay></div>
{#if noteLinkProblem}
	<NoteLinkNotice message={noteLinkProblem} onClose={() => (noteLinkProblem = null)} />
{/if}
{@render children()}
