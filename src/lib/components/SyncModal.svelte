<script lang="ts">
	import { onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { formatPairingCode, normalizePairingCode } from '$lib/syncPairing';
	import { syncStore, type StartedDeviceLink } from '$lib/stores/sync.svelte';
	import { profileCoordinator } from '$lib/stores/profiles.svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { buildProfileNotesExport } from '$lib/profiles';
	import { estimateProfileBytes } from '$lib/db/idb';
	import { unregisterReminderDevice } from '$lib/reminderWake';
	import { downloadJSON } from '$lib/utils';
	import { Cloud, Download, Pencil, Trash2, X } from '@lucide/svelte';
	import { portalToAppFloat } from '$lib/appViewport';
	import { resolveSyncStatus, SyncStatus } from '$lib/syncStatus';

	const SYNC_STATUS_CLASS: Record<SyncStatus, string> = {
		[SyncStatus.Normal]:
			'border border-[var(--scrapscache-border)] text-[var(--scrapscache-text-muted)]',
		[SyncStatus.Warning]: 'scrapscache-status-warning',
		[SyncStatus.Danger]: 'scrapscache-status-danger'
	};

	let { onClose }: { onClose: () => void } = $props();
	let mode = $state<'menu' | 'register' | 'link' | 'waiting' | 'linked'>(
		syncStore.isLoggedIn ? 'linked' : 'menu'
	);
	let code = $state('');
	let error = $state('');
	let info = $state('');
	type Operation =
		| 'create'
		| 'connect'
		| 'export'
		| 'pair'
		| 'rename'
		| 'remove'
		| 'sync'
		| 'switch'
		| 'unlink'
		| 'delete';
	let operation = $state<Operation | null>(null);
	let copyFlash = $state(false);
	let copyFlashTimer: ReturnType<typeof setTimeout> | null = null;
	let waiting = $state<StartedDeviceLink | null>(null);
	let now = $state(Date.now());
	let timer: ReturnType<typeof setTimeout> | null = null;
	let deleteConfirm = $state(false);
	let newName = $state('');
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let removingId = $state<string | null>(null);

	let syncError = $derived(syncStore.lastError ?? '');
	let quotaStatus = $derived(resolveSyncStatus(syncError, syncStore.usage));

	// A running sync must finish before a dataset handover can start.
	// Background pulls and outbox retries are intentionally silent. They still
	// block a dataset handover, but only a sync started from this modal owns its
	// visible "Syncing" state.
	const syncing = $derived(operation === 'sync');
	const busy = $derived(operation !== null || notesStore.syncing || profileCoordinator.switching);
	const handoverBlocked = $derived(notesStore.syncing || profileCoordinator.switching);

	// Approximate on-device footprint per saved key. Recomputed after each
	// completed sync so the number never goes stale mid-session.
	let sizes = $state<Record<string, number>>({});
	$effect(() => {
		void syncStore.lastSync;
		const ids = syncStore.profiles.map((profile) => profile.id);
		let cancelled = false;
		void Promise.all(
			ids.map(async (id) => {
				return [id, await estimateProfileBytes(id).catch(() => 0)] as const;
			})
		).then((entries) => {
			if (!cancelled) sizes = Object.fromEntries(entries);
		});
		return () => {
			cancelled = true;
		};
	});

	async function runOperation<T>(
		kind: Operation,
		fallback: string,
		run: () => Promise<T>
	): Promise<T | undefined> {
		if (busy) return undefined;
		operation = kind;
		try {
			return await run();
		} catch (err) {
			error = friendlyError(err instanceof Error ? err.message : null, fallback);
			return undefined;
		} finally {
			if (operation === kind) operation = null;
		}
	}

	async function exportProfile(id: string) {
		error = '';
		await runOperation('export', 'Could not export that sync key\u2019s notes.', async () => {
			const name = syncStore.profiles.find((profile) => profile.id === id)?.name ?? 'profile';
			const backup = await buildProfileNotesExport(id);
			if (!backup) {
				info = 'That sync key has no notes stored on this device yet.';
				return;
			}
			downloadJSON(
				backup,
				`scrapscache-${name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}-${new Date()
					.toISOString()
					.slice(0, 10)}.scrapscache-backup`
			);
		});
	}

	function sizeLabel(id: string): string {
		const bytes = sizes[id];
		if (!bytes) return '';
		return bytes < 1024 * 1024
			? `${Math.max(1, Math.round(bytes / 1024))} KB`
			: `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function stopWaiting() {
		if (timer) clearTimeout(timer);
		timer = null;
	}

	function schedulePoll(active: StartedDeviceLink) {
		stopWaiting();
		timer = setTimeout(() => {
			timer = null;
			void pollLink(active);
		}, 1500);
	}

	onDestroy(() => {
		stopWaiting();
		if (copyFlashTimer !== null) clearTimeout(copyFlashTimer);
	});

	function secondsLeft(): number {
		if (!waiting) return 0;
		return Math.max(0, Math.round((waiting.expiresAt - now) / 1000));
	}

	function expiryRatio(): number {
		return Math.max(0, Math.min(1, secondsLeft() / 60));
	}

	function pairingGroups(raw: string): string[] {
		const formatted = formatPairingCode(raw);
		return formatted ? formatted.split('-') : [];
	}

	async function create() {
		error = '';
		info = '';
		const name = newName;
		const result = await runOperation('create', 'Could not create sync', () =>
			profileCoordinator.create(name)
		);
		if (!result) return;
		if (!result.success) {
			error = friendlyError(result.error, 'Could not create sync');
			return;
		}
		newName = '';
		mode = 'linked';
		if (result.error)
			error = friendlyError(result.error, 'Created, but the first sync did not finish');
	}

	async function beginLink() {
		const normalized = normalizePairingCode(code);
		if (!normalized || normalized.length !== 16) {
			error = 'Enter the full one-time code';
			return;
		}
		error = '';
		info = '';
		const result = await runOperation('connect', 'Could not start connection', () =>
			syncStore.startDeviceLink(normalized)
		);
		if (!result) return;
		if (!result.success || !result.link) {
			error = friendlyError(result.error, 'Could not start connection');
			return;
		}
		waiting = result.link;
		now = Date.now();
		mode = 'waiting';
		void pollLink(result.link);
	}

	async function pollLink(active: StartedDeviceLink) {
		if (waiting?.id !== active.id) return;
		now = Date.now();
		let result;
		try {
			result = await syncStore.pollDeviceLink(active);
		} catch (err) {
			if (waiting?.id !== active.id) return;
			stopWaiting();
			waiting = null;
			mode = active.role === 'existing' ? 'linked' : 'link';
			error = friendlyError(
				err instanceof Error ? err.message : null,
				'Could not check the connection. Try again.'
			);
			return;
		}
		if (waiting?.id !== active.id) return;
		if (result.linked) {
			const wasExisting = active.role === 'existing';
			stopWaiting();
			waiting = null;
			if (wasExisting) {
				mode = 'linked';
				info = 'Key sent. This device can go offline.';
				error = '';
				return;
			}
			const adopted = await runOperation('pair', 'Could not set up the received sync key', () =>
				profileCoordinator.receiveLinkedKey(result.receivedSyncKey ?? '')
			);
			if (!adopted) return;
			if (adopted.error || !result.receivedSyncKey) {
				mode = syncStore.isLoggedIn ? 'linked' : 'link';
				error = friendlyError(
					adopted.error ?? 'Invalid encrypted sync key',
					'Could not set up the received sync key'
				);
				return;
			}
			mode = 'linked';
			info = 'Paired and synced.';
			error = '';
			return;
		}
		if (result.expired || !result.success) {
			stopWaiting();
			waiting = null;
			mode = active.role === 'existing' ? 'linked' : 'link';
			error = friendlyError(result.error, 'Connection timed out. Try again on both devices.');
			return;
		}
		schedulePoll(active);
	}

	async function startExistingConnection() {
		error = '';
		info = '';
		const result = await runOperation('connect', 'Could not start connection', () =>
			syncStore.startExistingDeviceLink()
		);
		if (!result) return;
		if (!result.success || !result.link) {
			error = friendlyError(result.error, 'Could not start connection');
			return;
		}
		waiting = result.link;
		now = Date.now();
		mode = 'waiting';
		void pollLink(result.link);
	}

	function startRename(id: string, current: string) {
		editingId = id;
		editName = current;
		removingId = null;
	}

	function cancelEdit() {
		editingId = null;
		editName = '';
	}

	async function saveRename() {
		const id = editingId;
		if (!id || !editName.trim()) return;
		error = '';
		const renamed = await runOperation('rename', 'Could not rename that sync key', () =>
			syncStore.renameProfile(id, editName)
		);
		if (renamed) cancelEdit();
	}

	async function switchProfile(id: string) {
		error = '';
		info = '';
		const result = await runOperation('switch', 'Could not switch sync key', () =>
			profileCoordinator.switchTo(id)
		);
		if (!result) return;
		if (!result.success) {
			error = friendlyError(result.error, 'Could not switch sync key');
			return;
		}
		onClose();
	}

	async function removeProfile(id: string) {
		error = '';
		const removed = await runOperation('remove', 'Could not remove that sync key', () =>
			syncStore.removeProfile(id)
		);
		if (removed) removingId = null;
		else if (removed === false) error = 'Could not remove that sync key.';
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
		const megabytes = bytes / 1_000_000;
		return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
	}

	function formatLimit(bytes: number): string {
		return formatBytes(bytes);
	}

	function progressPercent(loaded: number, total: number | null): number {
		if (!total || total <= 0) return 0;
		return Math.min(100, Math.round((loaded / total) * 100));
	}

	async function syncNow() {
		error = '';
		info = '';
		const success = await runOperation('sync', 'Sync failed', () =>
			notesStore.syncWithCloudManual()
		);
		if (success === undefined) return;
		if (!success) {
			error = friendlyError(syncStore.lastError, 'Sync failed');
			return;
		}
		// Partial success: text synced but quota-blocked photos or hydration
		// failures remain pending. Surface it instead of showing a clean pass.
		const warning = syncStore.lastError || notesStore.lastPersistError;
		if (warning) error = friendlyError(warning, 'Some records are still pending');
	}

	async function unlinkDevice() {
		const account = syncStore.account;
		error = '';
		await syncStore.logout();
		mode = 'menu';
		error = '';
		info = '';
		if (account) void unregisterReminderDevice(account);
	}

	async function copyCode() {
		const text = formatPairingCode(waiting?.syncCode ?? '');
		if (!text) return;
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
			} else {
				throw new Error('clipboard API unavailable');
			}
		} catch {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			try {
				document.execCommand('copy');
			} catch {
				/* best effort */
			}
			document.body.removeChild(ta);
		}
		copyFlash = true;
		if (copyFlashTimer !== null) clearTimeout(copyFlashTimer);
		copyFlashTimer = setTimeout(() => {
			copyFlash = false;
			copyFlashTimer = null;
		}, 2000);
	}

	async function deleteCloudData() {
		if (!deleteConfirm) return;
		error = '';
		const result = await runOperation('delete', 'Could not delete synced data', () =>
			syncStore.deleteCloudAccount()
		);
		if (!result) return;
		if (!result.success) {
			error = friendlyError(result.error, 'Could not delete synced data');
			return;
		}
		deleteConfirm = false;
		mode = 'menu';
		info = 'Cloud data deleted. Notes on this device were kept.';
	}

	function friendlyError(raw: string | null | undefined, fallback: string): string {
		if (!raw) return fallback;
		if (raw.includes('404')) return 'Sync code not found or expired. Check it on the other device.';
		if (raw.includes('410')) return 'Connection expired. Try again.';
		if (raw.includes('Failed to fetch') || raw.includes('NetworkError'))
			return 'Could not reach server. Check your connection.';
		return raw;
	}

	function handleCodeInput(event: Event) {
		code = formatPairingCode((event.currentTarget as HTMLInputElement).value);
	}

	function close() {
		if (busy) return;
		stopWaiting();
		onClose();
	}
</script>

<div
	{@attach portalToAppFloat}
	class="fixed inset-0 z-50 flex items-center justify-center p-4"
	transition:fade={{ duration: 150 }}
>
	<button
		type="button"
		class="absolute inset-0 bg-black/40"
		onclick={close}
		disabled={busy}
		aria-label="Close sync dialog"
	></button>
	<div
		class="scrapscache-dialog relative w-full max-w-md p-6"
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-labelledby="sync-title"
		transition:fly={{ y: 8, duration: 150 }}
	>
		<div class="mb-4 flex items-center justify-between">
			<h2
				id="sync-title"
				class="flex items-center gap-2 text-lg font-medium text-[var(--scrapscache-text)]"
			>
				<Cloud class="h-5 w-5" aria-hidden="true" />
				{#if syncStore.isLoggedIn && syncStore.activeProfile}
					<span class="max-w-[16rem] truncate">{syncStore.activeProfile.name}</span>
				{:else}
					Sync
				{/if}
			</h2>
			<button
				type="button"
				onclick={close}
				disabled={busy}
				class="icon-btn h-8 w-8"
				aria-label="Close"
			>
				<X class="h-4 w-4" aria-hidden="true" />
			</button>
		</div>

		{#if mode === 'linked' && syncStore.account}
			<div class="space-y-4">
				<p class="text-sm text-[var(--scrapscache-text-muted)]">
					This device is linked. Connect another device with a one-time code that expires in 60
					seconds.
				</p>
				{#if syncStore.progress}
					{@const progress = syncStore.progress}
					{@const percent = progressPercent(progress.loadedBytes, progress.totalBytes)}
					<div
						class="rounded-[var(--scrapscache-radius-md)] bg-[var(--scrapscache-interactive-hover)] p-3 text-sm"
					>
						<div class="mb-1 flex justify-between text-[var(--scrapscache-text-muted)]">
							<span
								>{progress.phase === 'upload'
									? 'Encrypting & uploading'
									: 'Downloading & decrypting'}</span
							>
							<span
								>{formatBytes(progress.loadedBytes)}{progress.totalBytes
									? ` / ${formatBytes(progress.totalBytes)} (${percent}%)`
									: ''}</span
							>
						</div>
						<div class="scrapscache-progress-track h-2 overflow-hidden rounded-full">
							<div
								class="scrapscache-progress-value h-full rounded-full transition-[width] duration-150"
								style={`width: ${progress.totalBytes ? percent : 100}%`}
							></div>
						</div>
					</div>
				{:else if syncing}<p class="text-sm text-[var(--scrapscache-text-muted)]">Syncing…</p>{/if}
				{#if info}<p class="text-sm text-[var(--scrapscache-text-muted)]">{info}</p>{/if}
				{#if error}
					<p class="text-sm text-[var(--scrapscache-danger)]" role="alert">{error}</p>
				{:else if syncError}
					<p class="text-sm text-[var(--scrapscache-danger)]" role="alert">{syncError}</p>
				{/if}
				<button
					type="button"
					onclick={() => void syncNow()}
					disabled={busy}
					class="scrapscache-button scrapscache-button-primary w-full px-3 py-2.5 text-sm font-medium"
					>{operation === 'sync' ? 'Syncing…' : '🔄 Sync now'}</button
				>
				<button
					type="button"
					onclick={() => void startExistingConnection()}
					disabled={busy}
					class="scrapscache-button scrapscache-button-secondary w-full px-3 py-2.5 text-sm"
					>Connect another device</button
				>
				<button
					type="button"
					onclick={() => {
						error = '';
						info = '';
						mode = 'menu';
					}}
					disabled={busy}
					class="w-full rounded-lg border border-[var(--scrapscache-border)] px-3 py-2.5 text-sm touch-manipulation"
					>Switch sync key</button
				>
				{#if syncStore.usage}
					<div
						aria-label="Sync storage usage"
						class={[
							'rounded-[var(--scrapscache-radius-md)] p-3 text-xs',
							SYNC_STATUS_CLASS[quotaStatus]
						]}
					>
						<div class="flex items-center justify-between gap-3">
							<span class="font-medium">Sync storage</span>
							<span>
								{formatBytes(syncStore.usage.storageBytes)} of
								{formatLimit(syncStore.usage.maxBytes)}
							</span>
						</div>
					</div>
				{/if}
				<button
					type="button"
					onclick={() => void unlinkDevice()}
					disabled={busy}
					class="scrapscache-button scrapscache-button-destructive w-full text-sm"
					>Unlink this device</button
				>
				{#if deleteConfirm}
					<div class="scrapscache-status-danger rounded-[var(--scrapscache-radius-md)] p-3">
						<p class="text-xs leading-relaxed">
							Delete all encrypted cloud records? Notes stored on this device will remain.
						</p>
						<div class="mt-2 flex gap-2">
							<button
								type="button"
								onclick={() => {
									deleteConfirm = false;
								}}
								disabled={busy}
								class="flex-1 rounded border border-[var(--scrapscache-border)] px-2 py-1.5 text-xs"
								>Cancel</button
							>
							<button
								type="button"
								onclick={() => void deleteCloudData()}
								disabled={busy}
								class="scrapscache-button scrapscache-button-destructive-solid flex-1 px-2 py-1.5 text-xs font-medium"
								>{operation === 'delete' ? 'Deleting…' : 'Delete cloud data'}</button
							>
						</div>
					</div>
				{:else}
					<button
						type="button"
						onclick={() => {
							deleteConfirm = true;
						}}
						disabled={busy}
						class="scrapscache-button scrapscache-button-destructive w-full text-xs"
						>Delete cloud data</button
					>
				{/if}
			</div>
		{:else if mode === 'menu'}
			<div class="space-y-3">
				{#if syncStore.profiles.length}
					<p class="text-xs font-medium tracking-wide text-[var(--scrapscache-text-muted)]">
						Saved sync keys on this device
					</p>
					<div class="space-y-1.5">
						{#each syncStore.profiles as profile (profile.id)}
							{#if editingId === profile.id}
								<div
									class="flex items-center gap-2 rounded-lg border border-[var(--scrapscache-border)] px-2 py-1.5"
								>
									<input
										class="scrapscache-input min-w-0 flex-1 px-2 py-1 text-sm"
										bind:value={editName}
										maxlength="60"
										aria-label="Sync key name"
										onkeydown={(event) => {
											if (event.key === 'Enter') void saveRename();
											if (event.key === 'Escape') cancelEdit();
										}}
									/>
									<button
										type="button"
										onclick={() => void saveRename()}
										disabled={busy}
										class="shrink-0 text-xs font-medium text-[var(--scrapscache-primary)]"
										>Save</button
									>
									<button
										type="button"
										onclick={cancelEdit}
										disabled={busy}
										class="shrink-0 text-xs text-[var(--scrapscache-text-muted)]">Cancel</button
									>
								</div>
							{:else if removingId === profile.id}
								<div
									class="scrapscache-status-danger rounded-lg border border-[var(--scrapscache-danger)] px-3 py-2"
								>
									<p class="text-xs leading-relaxed">
										Remove “{profile.name}” and its stashed notes from this device? Its synced cloud
										data stays.
									</p>
									<div class="mt-2 flex gap-2">
										<button
											type="button"
											onclick={() => {
												removingId = null;
											}}
											disabled={busy}
											class="flex-1 rounded border border-[var(--scrapscache-border)] px-2 py-1 text-xs"
											>Keep</button
										>
										<button
											type="button"
											onclick={() => {
												void removeProfile(profile.id);
											}}
											disabled={busy}
											class="scrapscache-button scrapscache-button-destructive-solid flex-1 px-2 py-1 text-xs font-medium"
											>Remove</button
										>
									</div>
								</div>
							{:else}
								{@const active = profile.id === syncStore.activeProfile?.id}
								<div
									class="relative flex items-center gap-2 rounded-lg border border-[var(--scrapscache-border)] px-3 py-2"
								>
									<button
										type="button"
										class="absolute inset-0 rounded-lg touch-manipulation disabled:cursor-not-allowed"
										disabled={busy}
										title={!active && notesStore.syncing
											? 'Wait for the current sync to finish'
											: undefined}
										aria-label={active ? `Manage ${profile.name}` : `Switch to ${profile.name}`}
										onclick={() => {
											if (active) {
												mode = 'linked';
												error = '';
												info = '';
												return;
											}
											void switchProfile(profile.id);
										}}
									></button>
									<span class="pointer-events-none relative min-w-0 flex-1">
										<span class="block truncate text-sm">{profile.name}</span>
										{#if sizeLabel(profile.id)}
											<span class="block text-xs text-[var(--scrapscache-text-muted)]"
												>{sizeLabel(profile.id)} stored locally</span
											>
										{/if}
										{#if active}
											<span class="block text-xs font-medium text-[var(--scrapscache-success)]"
												>Active — tap to manage</span
											>
										{:else}
											<span class="block text-xs text-[var(--scrapscache-text-muted)]">
												{profileCoordinator.switching ? 'Switching…' : 'Tap to switch'}
											</span>
										{/if}
									</span>
									<button
										type="button"
										onclick={() => void exportProfile(profile.id)}
										disabled={busy}
										class="icon-btn relative z-10 h-7 w-7 shrink-0"
										aria-label="Export notes of {profile.name}"
									>
										<Download class="h-3.5 w-3.5" aria-hidden="true" />
									</button>
									<button
										type="button"
										onclick={() => startRename(profile.id, profile.name)}
										disabled={busy}
										class="icon-btn relative z-10 h-7 w-7 shrink-0"
										aria-label="Rename {profile.name}"
									>
										<Pencil class="h-3.5 w-3.5" aria-hidden="true" />
									</button>
									{#if !active}
										<button
											type="button"
											onclick={() => {
												removingId = profile.id;
												cancelEdit();
											}}
											disabled={busy}
											class="icon-btn relative z-10 h-7 w-7 shrink-0"
											aria-label="Remove {profile.name}"
										>
											<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
										</button>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				{/if}
				<p class="text-sm text-[var(--scrapscache-text-muted)]">
					Create one private sync key, then connect your own devices by starting the connection on
					both within 60 seconds. Each key keeps its own notes on this device.
					{#if handoverBlocked}<span class="block">
							Switching sync keys is paused until the current sync finishes.</span
						>{/if}
				</p>
				<button
					type="button"
					disabled={busy}
					onclick={() => {
						mode = 'register';
						error = '';
						info = '';
					}}
					class="scrapscache-button scrapscache-button-primary w-full px-3 py-3 text-sm font-medium"
					>Create sync key</button
				><button
					type="button"
					onclick={() => {
						mode = 'link';
						error = '';
						info = '';
					}}
					disabled={busy}
					class="w-full rounded-lg border border-[var(--scrapscache-border)] px-3 py-3 text-sm touch-manipulation"
					>Connect to an existing sync</button
				>
				{#if error}<p class="text-sm text-[var(--scrapscache-danger)]">{error}</p>{/if}
			</div>
		{:else if mode === 'register'}
			<div class="space-y-3">
				<p class="text-sm text-[var(--scrapscache-text-muted)]">
					Creates a private account on this device. Other devices join with a one-time code, not a
					lifetime password.
				</p>
				<input
					bind:value={newName}
					placeholder="Name this sync key (optional)"
					maxlength="60"
					class="scrapscache-input w-full px-3 py-2 text-sm"
					aria-label="Sync key name"
					onkeydown={(event) => event.key === 'Enter' && void create()}
				/>
				{#if error}<p class="text-sm text-[var(--scrapscache-danger)]">{error}</p>{/if}<button
					type="button"
					onclick={() => void create()}
					disabled={busy}
					class="scrapscache-button scrapscache-button-primary w-full px-3 py-2 text-sm font-medium"
					>{operation === 'create' ? 'Creating…' : 'Create my sync key'}</button
				><button
					type="button"
					onclick={() => (mode = 'menu')}
					disabled={busy}
					class="w-full text-xs text-[var(--scrapscache-text-muted)] touch-manipulation"
					>← Back</button
				>
			</div>
		{:else if mode === 'link'}
			<div class="space-y-3">
				<p class="text-sm text-[var(--scrapscache-text-muted)]">
					On your other device open Sync and choose Connect another device. Enter the one-time code
					shown there.
				</p>
				<input
					type="text"
					value={code}
					oninput={handleCodeInput}
					placeholder="XXXX-XXXX-XXXX-XXXX"
					maxlength="19"
					spellcheck="false"
					class="scrapscache-input w-full px-3 py-2 text-center text-lg font-bold tracking-wider"
					onkeydown={(event) => event.key === 'Enter' && void beginLink()}
				/>{#if error}<p class="text-sm text-[var(--scrapscache-danger)]">{error}</p>{/if}<button
					type="button"
					onclick={() => void beginLink()}
					disabled={busy}
					class="scrapscache-button scrapscache-button-primary w-full px-3 py-2 text-sm font-medium"
					>{operation === 'connect' ? 'Starting…' : 'Start connection'}</button
				><button
					type="button"
					onclick={() => (mode = 'menu')}
					disabled={busy}
					class="w-full text-xs text-[var(--scrapscache-text-muted)] touch-manipulation"
					>← Back</button
				>
			</div>
		{:else if mode === 'waiting'}
			<div class="space-y-5">
				{#if waiting?.role === 'existing'}
					<div>
						<p class="text-xs font-medium tracking-wide text-[var(--scrapscache-text-muted)]">
							On the new device
						</p>
						<p class="mt-1 text-sm text-[var(--scrapscache-text)]">Open Sync and type this code</p>
					</div>
					<div
						class="rounded-xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-bg)] px-2 py-5"
						aria-label="One-time pairing code"
					>
						<div class="flex items-center justify-center gap-1">
							{#each pairingGroups(waiting.syncCode) as group, index (index)}
								{#if index > 0}
									<span class="px-0.5 text-[var(--scrapscache-text-muted)]" aria-hidden="true"
										>·</span
									>
								{/if}
								<span
									class="font-mono text-[1.35rem] font-semibold tracking-[0.14em] text-[var(--scrapscache-text)]"
									>{group}</span
								>
							{/each}
						</div>
					</div>
					<button
						type="button"
						onclick={() => void copyCode()}
						class="scrapscache-button w-full px-3 py-2.5 text-sm font-medium {copyFlash
							? 'border-[var(--scrapscache-success)] bg-[var(--scrapscache-success)] text-[var(--scrapscache-success-foreground)]'
							: 'scrapscache-button-secondary'}">{copyFlash ? 'Copied' : 'Copy code'}</button
					>
				{:else}
					<div>
						<p class="text-xs font-medium tracking-wide text-[var(--scrapscache-text-muted)]">
							On the other device
						</p>
						<p class="mt-1 text-sm text-[var(--scrapscache-text)]">
							Open Sync and choose Connect another device
						</p>
					</div>
				{/if}
				<div class="space-y-1.5">
					<div
						class="flex items-center justify-between text-xs text-[var(--scrapscache-text-muted)]"
					>
						<span>Expires in</span>
						<span class="tabular-nums text-[var(--scrapscache-text)]">{secondsLeft()}s</span>
					</div>
					<div class="scrapscache-progress-track h-1 overflow-hidden rounded-full">
						<div
							class="scrapscache-progress-value h-full rounded-full transition-[width] duration-1000 ease-linear"
							style={`width: ${expiryRatio() * 100}%`}
						></div>
					</div>
				</div>
				<button
					type="button"
					onclick={() => {
						stopWaiting();
						waiting = null;
						mode = syncStore.isLoggedIn ? 'linked' : 'link';
					}}
					class="w-full text-sm text-[var(--scrapscache-text-muted)] touch-manipulation"
					>Cancel</button
				>
			</div>
		{/if}
	</div>
</div>
