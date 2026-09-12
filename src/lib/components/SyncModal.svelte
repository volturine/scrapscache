<script lang="ts">
	import WorkspaceRow from './WorkspaceRow.svelte';
	import TurnstileWidget from './TurnstileWidget.svelte';
	import { env } from '$env/dynamic/public';
	import { onDestroy, onMount } from 'svelte';
	import QRCode from 'qrcode';
	import { Clipboard } from '@ark-ui/svelte/clipboard';
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { Format } from '@ark-ui/svelte/format';
	import { Progress } from '@ark-ui/svelte/progress';
	import { createPairingUrl, formatPairingCode, normalizePairingCode } from '$lib/syncPairing';
	import { syncStore, type StartedDeviceLink } from '$lib/stores/sync.svelte';
	import { profileCoordinator } from '$lib/stores/profiles.svelte';
	import { notesStore } from '$lib/stores/notes.svelte';
	import { buildProfileNotesExport } from '$lib/profiles';
	import { estimateProfileBytes, LOCAL_PROFILE_ID } from '$lib/db/idb';
	import { downloadJSON } from '$lib/utils';
	import { Cloud, CloudOff, Download, RefreshCw, Trash2, X } from '@lucide/svelte';
	import { portalToAppFloat } from '$lib/appViewport';

	let { onClose, initialPairingCode = '' }: { onClose: () => void; initialPairingCode?: string } =
		$props();
	let mode = $state<'menu' | 'register' | 'link' | 'waiting' | 'pairing' | 'confirm'>('menu');
	let code = $state('');
	let error = $state('');
	let info = $state('');
	type Operation =
		| 'create'
		| 'connect'
		| 'export'
		| 'pair'
		| 'rename'
		| 'sync'
		| 'switch'
		| 'unlink'
		| 'delete'
		| 'force-sync'
		| 'replace-key';
	let operation = $state<Operation | null>(null);
	let copyFlash = $state(false);
	let qrDataUrl = $state('');
	let copyFlashTimer: ReturnType<typeof setTimeout> | null = null;
	let waiting = $state<StartedDeviceLink | null>(null);
	let now = $state(Date.now());
	let timer: ReturnType<typeof setTimeout> | null = null;
	let confirmation = $state<'delete' | 'force' | null>(null);
	let newName = $state('');
	// Account creation, including recovery that may recreate the account, needs a Turnstile token
	// when this deployment configures a sitekey. Each surface owns its own single-use widget.
	const turnstileSitekey = env.PUBLIC_TURNSTILE_SITEKEY?.trim() ?? '';
	let registerCheck = $state<TurnstileWidget>();
	let registerToken = $state('');
	let forceCheck = $state<TurnstileWidget>();
	let forceToken = $state('');
	// The row that currently owns Escape, so the dialog leaves the key alone.
	let rowHoldingEscape = $state<string | null>(null);

	const authenticationFailed = $derived(/authentication/i.test(syncStore.lastError ?? ''));
	let syncError = $derived(syncStore.lastError ?? '');

	// A running sync must finish before a dataset handover can start.
	// Background pulls and outbox retries are intentionally silent. They still
	// block a dataset handover, but only a sync started from this modal owns its
	// visible "Syncing" state.
	const syncing = $derived(operation === 'sync' || operation === 'force-sync');
	const busy = $derived(operation !== null || notesStore.syncing || profileCoordinator.switching);
	const handoverBlocked = $derived(notesStore.syncing || profileCoordinator.switching);

	// Approximate on-device footprint per saved key. Measured when the modal
	// opens and after any operation that can change what is stored, rather than
	// reactively, so opening the modal costs one pass instead of one per sync.
	let sizes = $state<Record<string, number>>({});
	let sizeGeneration = 0;
	async function refreshSizes() {
		const generation = ++sizeGeneration;
		const ids = [LOCAL_PROFILE_ID, ...syncStore.profiles.map((profile) => profile.id)];
		const entries = await Promise.all(
			ids.map(async (id) => [id, await estimateProfileBytes(id).catch(() => 0)] as const)
		);
		if (generation === sizeGeneration) sizes = Object.fromEntries(entries);
	}
	void refreshSizes();

	async function runOperation<T>(
		kind: Operation,
		fallback: string,
		run: () => Promise<T>
	): Promise<T | undefined> {
		if (kind === 'pair' ? operation !== null || profileCoordinator.switching : busy)
			return undefined;
		operation = kind;
		try {
			return await run();
		} catch (err) {
			error = friendlyError(err instanceof Error ? err.message : null, fallback);
			return undefined;
		} finally {
			if (operation === kind) operation = null;
			// Exporting and renaming are the only operations that cannot move bytes.
			if (kind !== 'export' && kind !== 'rename') void refreshSizes();
		}
	}

	async function exportProfile(id: string) {
		error = '';
		await runOperation('export', 'Could not export that sync key\u2019s notes.', async () => {
			const name =
				id === LOCAL_PROFILE_ID
					? 'anonymous-workspace'
					: (syncStore.profiles.find((profile) => profile.id === id)?.name ?? 'profile');
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

	onMount(() => {
		if (!initialPairingCode) return;
		code = formatPairingCode(initialPairingCode);
		mode = 'link';
		void beginLink();
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
		if (turnstileSitekey && !registerToken) return;
		error = '';
		info = '';
		const name = newName;
		const token = registerToken || undefined;
		const result = await runOperation('create', 'Could not create sync', () =>
			profileCoordinator.create(name, token)
		);
		registerCheck?.reset();
		if (!result) return;
		if (!result.success) {
			error = friendlyError(result.error, 'Could not create sync');
			return;
		}
		newName = '';
		mode = 'menu';
		if (result.error)
			error = friendlyError(result.error, 'Created, but the first sync did not finish');
	}

	async function forceResync() {
		if (turnstileSitekey && !forceToken) return;
		error = '';
		info = '';
		const token = forceToken || undefined;
		const result = await runOperation('force-sync', 'Could not force a full resync', () =>
			profileCoordinator.forceResync(token)
		);
		forceCheck?.reset();
		if (!result) return;
		if (!result.success) {
			error = friendlyError(result.error, 'Could not force a full resync');
			return;
		}
		mode = 'menu';
		info = 'This device’s notes are now the latest cloud version.';
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
			mode = active.role === 'existing' ? 'menu' : 'link';
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
				mode = 'menu';
				info = 'Key sent. This device can go offline.';
				error = '';
				return;
			}
			mode = 'pairing';
			const adopted = await runOperation('pair', 'Could not set up the received sync key', () =>
				profileCoordinator.receiveLinkedKey(result.receivedSyncKey ?? '')
			);
			if (!adopted) {
				mode = syncStore.isLoggedIn ? 'menu' : 'link';
				if (!error) error = 'Could not finish connecting. Try again.';
				return;
			}
			if (adopted.error || !result.receivedSyncKey) {
				mode = syncStore.isLoggedIn ? 'menu' : 'link';
				error = friendlyError(
					adopted.error ?? 'Invalid encrypted sync key',
					'Could not set up the received sync key'
				);
				return;
			}
			mode = 'menu';
			info = 'Paired and synced.';
			error = '';
			return;
		}
		if (result.expired || !result.success) {
			stopWaiting();
			waiting = null;
			mode = active.role === 'existing' ? 'menu' : 'link';
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
		void generatePairingQr(result.link);
		void pollLink(result.link);
	}

	async function generatePairingQr(active: StartedDeviceLink) {
		try {
			const svg = await QRCode.toString(createPairingUrl(window.location.href, active.syncCode), {
				type: 'svg',
				width: 220,
				margin: 1,
				errorCorrectionLevel: 'M'
			});
			if (waiting?.id === active.id)
				qrDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
		} catch {
			// The copyable URL and manual code remain available if QR rendering fails.
		}
	}

	function pairingShareUrl(): string {
		return waiting ? createPairingUrl(window.location.href, waiting.syncCode) : '';
	}

	async function renameProfile(id: string, next: string): Promise<boolean> {
		error = '';
		info = '';
		const renamed = await runOperation('rename', 'Could not rename that workspace', () =>
			syncStore.renameProfile(id, next)
		);
		if (renamed) return true;
		if (!error) error = 'Could not rename that workspace';
		return false;
	}

	async function switchProfile(id: string) {
		error = '';
		info = '';
		const result = await runOperation('switch', 'Could not switch workspace', () =>
			profileCoordinator.switchTo(id)
		);
		if (!result) return;
		if (!result.success) {
			error = friendlyError(result.error, 'Could not switch workspace');
			return;
		}
		onClose();
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

	async function unlinkProfile(id: string): Promise<boolean> {
		error = '';
		info = '';
		const result = await runOperation('unlink', 'Could not unlink workspace', () =>
			profileCoordinator.unlinkSaved(id)
		);
		if (!result) {
			if (!error) error = 'Could not unlink workspace';
			return false;
		}
		if (!result.success) {
			error = friendlyError(result.error, 'Could not unlink workspace');
			return false;
		}
		info = 'Notes moved to Anonymous workspace. Cloud data is unchanged.';
		return true;
	}

	function onCopyStatus(details: { copied: boolean }) {
		if (!details.copied) return;
		copyFlash = true;
		if (copyFlashTimer !== null) clearTimeout(copyFlashTimer);
		copyFlashTimer = setTimeout(() => {
			copyFlash = false;
			copyFlashTimer = null;
		}, 2000);
	}

	async function deleteCloudData() {
		if (confirmation !== 'delete') return;
		error = '';
		const result = await runOperation('delete', 'Could not delete synced data', () =>
			profileCoordinator.unlink(true)
		);
		if (!result) return;
		if (!result.success) {
			error = friendlyError(result.error, 'Could not delete synced data');
			return;
		}
		confirmation = null;
		mode = 'menu';
		info = 'Cloud data deleted. Your notes are now in Anonymous workspace.';
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

<Dialog.Root
	open
	onOpenChange={(details) => !details.open && close()}
	preventScroll={false}
	closeOnEscape={rowHoldingEscape === null}
>
	<div {@attach portalToAppFloat} class="fixed inset-0 z-50" role="presentation">
		<Dialog.Backdrop class="absolute inset-0 bg-black/40" />
		<Dialog.Positioner class="absolute inset-0 flex items-center justify-center p-4">
			<Dialog.Content
				class="scrapscache-dialog relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto p-5"
			>
				<div class="mb-4 flex items-center justify-between">
					<Dialog.Title
						class="flex items-center gap-2 text-lg font-medium text-[var(--scrapscache-text)]"
					>
						<Cloud class="h-5 w-5" aria-hidden="true" />
						{mode === 'menu'
							? 'Workspaces'
							: mode === 'register'
								? 'New workspace'
								: mode === 'confirm'
									? confirmation === 'force'
										? 'Replace cloud notes?'
										: 'Delete cloud data?'
									: 'Connect device'}
					</Dialog.Title>
					<Dialog.CloseTrigger
						type="button"
						disabled={busy}
						class="icon-btn h-8 w-8"
						aria-label="Close"
					>
						<X class="h-4 w-4" aria-hidden="true" />
					</Dialog.CloseTrigger>
				</div>

				{#if mode === 'menu'}
					<div class="space-y-4">
						<div class="workspace-list" aria-label="Workspaces on this device">
							<button
								type="button"
								class="workspace-row"
								class:active={syncStore.activePid === LOCAL_PROFILE_ID}
								disabled={busy}
								aria-label={syncStore.activePid === LOCAL_PROFILE_ID
									? 'Anonymous workspace is active'
									: 'Switch to Anonymous workspace'}
								onclick={() =>
									syncStore.activePid !== LOCAL_PROFILE_ID && void switchProfile(LOCAL_PROFILE_ID)}
							>
								<CloudOff size={18} aria-hidden="true" />
								<span class="min-w-0 flex-1 text-left"
									><span class="block truncate">Anonymous workspace</span><span
										class="workspace-caption"
										>Only on this device{sizeLabel(LOCAL_PROFILE_ID)
											? ' · ' + sizeLabel(LOCAL_PROFILE_ID)
											: ''}</span
									></span
								>
							</button>
							{#each syncStore.profiles as profile (profile.id)}
								{@const active = profile.id === syncStore.activeProfile?.id}
								<WorkspaceRow
									name={profile.name}
									caption={`${active ? 'Current workspace' : 'Synced workspace'}${
										sizeLabel(profile.id) ? ' · ' + sizeLabel(profile.id) : ''
									}`}
									{active}
									disabled={busy}
									onselect={() => {
										if (!active) void switchProfile(profile.id);
									}}
									onrename={(next) => renameProfile(profile.id, next)}
									onunlink={() => unlinkProfile(profile.id)}
									onbusychange={(holdsEscape) => {
										if (holdsEscape) rowHoldingEscape = profile.id;
										else if (rowHoldingEscape === profile.id) rowHoldingEscape = null;
									}}
								>
									{#snippet icon()}<Cloud size={18} aria-hidden="true" />{/snippet}
								</WorkspaceRow>
							{/each}
						</div>

						<div class={syncStore.account ? 'flex gap-4 text-sm' : ''}>
							<button
								type="button"
								disabled={busy}
								class={syncStore.account
									? 'text-[var(--scrapscache-primary)]'
									: 'scrapscache-button scrapscache-button-primary w-full px-3 py-2.5 text-sm font-medium'}
								onclick={() => {
									mode = 'register';
									error = '';
									info = '';
									newName = '';
								}}>+ New workspace</button
							>
						</div>
						{#if syncStore.account}
							<div class="border-t border-[var(--scrapscache-border)] pt-4">
								<div class="flex gap-2">
									<button
										type="button"
										onclick={() => {
											if (authenticationFailed) {
												confirmation = 'force';
												mode = 'confirm';
												error = '';
											} else void syncNow();
										}}
										disabled={busy}
										class="scrapscache-button scrapscache-button-primary flex flex-1 items-center justify-center gap-2 px-3 py-2.5 text-sm"
										><RefreshCw
											size={16}
											class={syncing ? 'animate-spin' : ''}
											aria-hidden="true"
										/>{operation === 'sync'
											? 'Syncing…'
											: authenticationFailed
												? 'Force resync'
												: 'Sync now'}</button
									>
									<button
										type="button"
										onclick={() => void startExistingConnection()}
										disabled={busy}
										class="scrapscache-button scrapscache-button-secondary flex-1 px-3 py-2.5 text-sm"
										>Connect device</button
									>
								</div>
								{#if syncStore.progress}
									{@const progress = syncStore.progress}
									{@const percent = progressPercent(progress.loadedBytes, progress.totalBytes)}
									<p class="mt-2 text-xs text-[var(--scrapscache-text-muted)]" role="status">
										{progress.phase === 'upload' ? 'Uploading' : 'Downloading'} · <Format.Byte
											value={progress.loadedBytes}
										/>
									</p>
									<Progress.Root value={progress.totalBytes ? percent : null} class="mt-2 w-full"
										><Progress.Track
											class="scrapscache-progress-track h-1 overflow-hidden rounded-full"
											><Progress.Range
												class="scrapscache-progress-value h-full"
												style={`width: ${progress.totalBytes ? percent : 100}%`}
											/></Progress.Track
										></Progress.Root
									>
								{:else if syncing}<p class="mt-2 text-xs" role="status">Syncing…</p>{/if}
							</div>
						{/if}
						{#if handoverBlocked}<p class="text-xs text-[var(--scrapscache-text-muted)]">
								Wait for sync to finish before changing workspaces.
							</p>{/if}
						{#if error || syncError}<p
								class="text-sm text-[var(--scrapscache-danger)]"
								role="alert"
							>
								{error || syncError}
							</p>{/if}
						{#if info}<p class="text-sm text-[var(--scrapscache-text-muted)]" role="status">
								{info}
							</p>{/if}
						<details class="border-t border-[var(--scrapscache-border)] pt-3">
							<summary class="cursor-pointer text-sm text-[var(--scrapscache-text-muted)]"
								>Manage workspace</summary
							>
							<div class="mt-2 space-y-1">
								<button
									class="manage-row"
									disabled={busy}
									onclick={() => void exportProfile(syncStore.activePid)}
									><Download size={16} aria-hidden="true" /><span>Export notes</span></button
								>
								{#if syncStore.account}
									<button
										class="manage-row"
										disabled={busy}
										onclick={() => {
											confirmation = 'force';
											mode = 'confirm';
											error = '';
										}}
										><RefreshCw
											size={16}
											class={operation === 'force-sync' ? 'animate-spin' : ''}
											aria-hidden="true"
										/><span
											>{operation === 'force-sync' ? 'Resyncing…' : 'Force resync'}<small
												>Replace cloud notes with this device’s version</small
											></span
										></button
									>
									<button
										class="manage-row text-[var(--scrapscache-danger)]"
										disabled={busy}
										onclick={() => {
											confirmation = 'delete';
											mode = 'confirm';
											error = '';
										}}
										><Trash2 size={16} aria-hidden="true" /><span
											>Delete cloud data<small
												>Keep this device’s notes in Anonymous workspace</small
											></span
										></button
									>
								{/if}
							</div>
						</details>
					</div>
				{:else if mode === 'confirm'}
					<div class="space-y-4">
						<p class="text-sm leading-relaxed text-[var(--scrapscache-text-muted)]">
							{#if confirmation === 'force'}
								This device’s notes will replace the cloud version using the same sync key. Notes
								only in the cloud will be removed. Other devices will receive these notes as the
								latest version.
							{:else}
								Permanently delete “{syncStore.activeProfile?.name}” from the cloud and stop syncing
								it on all devices. This device’s notes will be appended to Anonymous workspace.
								Existing anonymous notes are kept.
							{/if}
						</p>
						{#if confirmation === 'force' && turnstileSitekey}
							<TurnstileWidget
								bind:this={forceCheck}
								bind:token={forceToken}
								sitekey={turnstileSitekey}
								action="register"
							/>
						{/if}
						{#if error}<p class="text-sm text-[var(--scrapscache-danger)]" role="alert">
								{error}
							</p>{/if}
						<div class="flex gap-2">
							<button
								type="button"
								class="scrapscache-button scrapscache-button-secondary flex-1 px-3 py-2"
								disabled={busy}
								onclick={() => {
									mode = 'menu';
									confirmation = null;
									error = '';
								}}>Cancel</button
							>
							<button
								type="button"
								class="scrapscache-button flex-1 px-3 py-2 {confirmation === 'delete'
									? 'scrapscache-button-destructive-solid'
									: 'scrapscache-button-primary'}"
								disabled={busy ||
									(confirmation === 'force' && Boolean(turnstileSitekey) && !forceToken)}
								onclick={() =>
									confirmation === 'force' ? void forceResync() : void deleteCloudData()}
								>{busy
									? 'Working…'
									: confirmation === 'force'
										? 'Replace cloud notes'
										: 'Delete cloud data'}</button
							>
						</div>
					</div>
				{:else if mode === 'register'}
					<div class="space-y-4">
						<p class="text-sm leading-relaxed text-[var(--scrapscache-text-muted)]">
							{syncStore.account
								? 'It starts empty. Your existing workspaces stay unchanged.'
								: 'Your current anonymous notes will be copied into it.'}
						</p>
						<div class="space-y-2">
							<input
								bind:value={newName}
								placeholder="Workspace name (optional)"
								maxlength="60"
								class="scrapscache-input w-full px-3 py-2.5 text-sm"
								aria-label="Sync key name"
								onkeydown={(event) => event.key === 'Enter' && void create()}
							/>
							{#if turnstileSitekey}
								<TurnstileWidget
									bind:this={registerCheck}
									bind:token={registerToken}
									sitekey={turnstileSitekey}
									action="register"
								/>
							{/if}
							{#if error}<p class="text-sm text-[var(--scrapscache-danger)]">{error}</p>{/if}
							<button
								type="button"
								onclick={() => void create()}
								disabled={busy || (Boolean(turnstileSitekey) && !registerToken)}
								class="scrapscache-button scrapscache-button-primary w-full px-3 py-2.5 text-sm font-medium"
								>{operation === 'create' ? 'Creating…' : 'Create workspace'}</button
							>
						</div>
						<div class="flex items-center gap-3" aria-hidden="true">
							<span class="h-px flex-1 bg-[var(--scrapscache-border)]"></span>
							<span
								class="text-[11px] uppercase tracking-wider text-[var(--scrapscache-text-muted)]"
								>or</span
							>
							<span class="h-px flex-1 bg-[var(--scrapscache-border)]"></span>
						</div>
						<button
							type="button"
							disabled={busy}
							class="scrapscache-button scrapscache-button-secondary w-full px-3 py-2.5 text-sm"
							onclick={() => {
								mode = 'link';
								error = '';
								info = '';
							}}>Join existing</button
						>
						<button
							type="button"
							onclick={() => (mode = 'menu')}
							disabled={busy}
							class="w-full text-xs text-[var(--scrapscache-text-muted)] touch-manipulation"
							>← Back to workspaces</button
						>
					</div>
				{:else if mode === 'link'}
					<div class="space-y-3">
						<p class="text-sm text-[var(--scrapscache-text-muted)]">
							On your other device open Sync and choose Connect device. Enter the one-time code
							shown there.
						</p>
						<input
							type="text"
							value={code}
							oninput={handleCodeInput}
							autocomplete="one-time-code"
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
				{:else if mode === 'pairing'}
					<p class="text-sm text-[var(--scrapscache-text)]" role="status">
						Connected. Syncing workspace…
					</p>
				{:else if mode === 'waiting'}
					<div class="space-y-5">
						{#if waiting?.role === 'existing'}
							<div>
								<p class="text-xs font-medium tracking-wide text-[var(--scrapscache-text-muted)]">
									On the new device
								</p>
								<p class="mt-1 text-sm text-[var(--scrapscache-text)]">
									Scan the QR code, open the link, or type the one-time code
								</p>
							</div>
							{#if qrDataUrl}
								<div class="flex justify-center">
									<img
										src={qrDataUrl}
										alt="Pair this device"
										class="h-[220px] w-[220px] rounded-lg bg-white p-2"
									/>
								</div>
							{/if}
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
							<Clipboard.Root value={pairingShareUrl()} onStatusChange={onCopyStatus}>
								<Clipboard.Trigger
									type="button"
									aria-label="Copy pairing link"
									class="scrapscache-button w-full px-3 py-2.5 text-sm font-medium {copyFlash
										? 'border-[var(--scrapscache-success)] bg-[var(--scrapscache-success)] text-[var(--scrapscache-success-foreground)]'
										: 'scrapscache-button-secondary'}"
								>
									{copyFlash ? 'Copied' : 'Copy pairing link'}
								</Clipboard.Trigger>
							</Clipboard.Root>
						{:else}
							<div>
								<p class="text-xs font-medium tracking-wide text-[var(--scrapscache-text-muted)]">
									On the other device
								</p>
								<p class="mt-1 text-sm text-[var(--scrapscache-text)]">
									Open Sync and choose Connect device
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
								mode = syncStore.isLoggedIn ? 'menu' : 'link';
							}}
							class="w-full text-sm text-[var(--scrapscache-text-muted)] touch-manipulation"
							>Cancel</button
						>
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>

<style>
	.workspace-list {
		display: grid;
		gap: 4px;
	}
	.workspace-row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		border-radius: 10px;
		padding: 12px;
		font-size: 14px;
	}
	.workspace-row:hover,
	.manage-row:hover {
		background: var(--scrapscache-interactive-hover);
	}
	.workspace-row.active {
		background: var(--scrapscache-interactive-hover);
	}
	.workspace-row.active::before {
		content: '';
		position: absolute;
		top: 10px;
		bottom: 10px;
		left: 0;
		width: 3px;
		border-radius: 0 3px 3px 0;
		background: var(--scrapscache-accent);
	}
	.workspace-caption,
	.manage-row small {
		display: block;
		margin-top: 2px;
		color: var(--scrapscache-text-muted);
		font-size: 12px;
		font-weight: 400;
	}
	.manage-row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		border-radius: 8px;
		padding: 10px 8px;
		text-align: left;
		font-size: 14px;
	}
	button:disabled {
		opacity: 0.55;
	}
</style>
