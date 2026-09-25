<script lang="ts">
	import ChoiceCard from './ChoiceCard.svelte';
	import { progressMeter, syncStyles as styles } from '$panda/styles';
	import { css, cx } from 'styled-system/css';
	import { button, dialog, iconButton, input, text } from 'styled-system/recipes';
	import { hstack, vstack } from 'styled-system/patterns';
	import WorkspaceRow from './WorkspaceRow.svelte';
	import TurnstileWidget from './TurnstileWidget.svelte';
	import PairingQrScanner from './PairingQrScanner.svelte';
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
	import { buildProfileNotesExport, isLocalWorkspace } from '$lib/profiles';
	import { estimateProfileBytes } from '$lib/db/idb';
	import { downloadJSON } from '$lib/utils';
	import {
		Cloud,
		CloudOff,
		FolderPlus,
		MonitorSmartphone,
		RefreshCw,
		ScanQrCode,
		Trash2,
		X
	} from '@lucide/svelte';
	import { portalToAppOverlay } from '$lib/appViewport';

	let { onClose, initialPairingCode = '' }: { onClose: () => void; initialPairingCode?: string } =
		$props();
	let mode = $state<'menu' | 'new' | 'register' | 'link' | 'waiting' | 'pairing' | 'confirm'>(
		'menu'
	);
	let code = $state('');
	let scanningQr = $state(false);
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
	let confirmation = $state<'delete' | 'force' | 'remove' | 'new-key' | null>(null);
	let confirmTarget = $state<string | null>(null);
	let expandedId = $state<string | null>(null);
	let newName = $state('');
	let promoteSource = $state<string | null>(null);
	// Account creation, including recovery that may recreate the account, needs a Turnstile token
	// when this deployment configures a challenge origin. Each surface owns its own single-use widget.
	const turnstileOrigin = env.PUBLIC_TURNSTILE_ORIGIN?.trim() ?? '';
	let registerCheck = $state<TurnstileWidget>();
	let registerToken = $state('');
	let confirmCheck = $state<TurnstileWidget>();
	let confirmToken = $state('');
	// The row that currently owns Escape, so the dialog leaves the key alone.
	let rowHoldingEscape = $state<string | null>(null);

	const authenticationFailed = $derived(/authentication/i.test(syncStore.lastError ?? ''));
	let syncError = $derived(syncStore.lastError ?? '');
	const confirmProfile = $derived(
		syncStore.profiles.find((profile) => profile.id === confirmTarget) ?? syncStore.activeProfile
	);

	// A running sync must finish before a dataset handover can start.
	// Background pulls and outbox retries are intentionally silent. They still
	// block a dataset handover, but only a sync started from this modal owns its
	// visible "Syncing" state.
	const syncing = $derived(operation === 'sync' || operation === 'force-sync');
	const busy = $derived(
		operation !== null || notesStore.syncing || notesStore.importing || profileCoordinator.switching
	);
	const rowOwnsEscape = $derived(rowHoldingEscape !== null || expandedId !== null);

	// Approximate on-device footprint per saved key. Measured when the modal
	// opens and after any operation that can change what is stored, rather than
	// reactively, so opening the modal costs one pass instead of one per sync.
	let sizes = $state<Record<string, number>>({});
	let sizeGeneration = 0;
	async function refreshSizes() {
		const generation = ++sizeGeneration;
		const ids = syncStore.profiles.map((profile) => profile.id);
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
			const name = syncStore.profiles.find((profile) => profile.id === id)?.name ?? 'workspace';
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

	async function createLocalWorkspace() {
		error = '';
		info = '';
		const result = await runOperation('create', 'Could not create workspace', () =>
			profileCoordinator.createLocal()
		);
		if (!result) return;
		if (!result.success) {
			error = friendlyError(result.error, 'Could not create workspace');
			return;
		}
		mode = 'menu';
		info = 'Created a local workspace on this device.';
	}

	async function create() {
		if (turnstileOrigin && !registerToken) return;
		error = '';
		info = '';
		const name = newName;
		const token = registerToken || undefined;
		const source = promoteSource;
		if (!source) return;
		const result = await runOperation('create', 'Could not create sync', () =>
			profileCoordinator.startSync(source, name, token)
		);
		registerCheck?.reset();
		if (!result) return;
		if (!result.success) {
			error = friendlyError(result.error, 'Could not create sync');
			return;
		}
		newName = '';
		promoteSource = null;
		mode = 'menu';
	}

	async function forceResync() {
		if (turnstileOrigin && !confirmToken) return;
		error = '';
		info = '';
		const token = confirmToken || undefined;
		const result = await runOperation('force-sync', 'Could not force a full resync', () =>
			profileCoordinator.forceResync(token, confirmTarget)
		);
		confirmCheck?.reset();
		if (!result) return;
		if (!result.success) {
			error = friendlyError(result.error, 'Could not force a full resync');
			return;
		}
		confirmation = null;
		confirmTarget = null;
		mode = 'menu';
		info = 'This device’s notes are now the latest cloud version.';
	}

	async function replaceRetiredKey() {
		if (!confirmTarget || (turnstileOrigin && !confirmToken)) return;
		error = '';
		info = '';
		const token = confirmToken || undefined;
		const target = confirmTarget;
		const result = await runOperation('replace-key', 'Could not create a new sync key', () =>
			profileCoordinator.replaceRetiredKey(target, token)
		);
		confirmCheck?.reset();
		if (!result) return;
		if (!result.success) {
			error = friendlyError(result.error, 'Could not create a new sync key');
			return;
		}
		confirmation = null;
		confirmTarget = null;
		mode = 'menu';
		info = 'This workspace has a new sync key. Pair your other devices again with a new code.';
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

	function startPromote(sourcePid: string) {
		promoteSource = sourcePid;
		mode = 'register';
		error = '';
		info = '';
		newName = '';
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
			// The handshake found the key retired: go straight to replacing it.
			if (syncStore.keyRetired) return confirm('new-key', syncStore.activePid);
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
			profileCoordinator.unlink(id)
		);
		if (!result) {
			if (!error) error = 'Could not unlink workspace';
			return false;
		}
		if (!result.success) {
			error = friendlyError(result.error, 'Could not unlink workspace');
			return false;
		}
		info = 'Unlinked. Its notes stay on this device as a private workspace.';
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

	async function removeWorkspace() {
		if (confirmation !== 'remove' || !confirmTarget) return;
		error = '';
		const target = confirmTarget;
		const result = await runOperation('delete', 'Could not delete workspace', () =>
			profileCoordinator.remove(target)
		);
		if (!result) return;
		if (!result.success) {
			error = friendlyError(result.error, 'Could not delete workspace');
			return;
		}
		confirmation = null;
		confirmTarget = null;
		expandedId = null;
		mode = 'menu';
		info = 'Workspace deleted from this device.';
	}

	async function deleteCloudData() {
		if (confirmation !== 'delete' || !confirmTarget) return;
		error = '';
		const target = confirmTarget;
		const result = await runOperation('delete', 'Could not delete synced data', () =>
			profileCoordinator.unlink(target, true)
		);
		if (!result) return;
		if (!result.success) {
			error = friendlyError(result.error, 'Could not delete synced data');
			return;
		}
		confirmation = null;
		confirmTarget = null;
		mode = 'menu';
		info = 'Cloud data deleted. Its notes stay on this device as a private workspace.';
	}

	function confirm(kind: 'delete' | 'force' | 'remove' | 'new-key', id: string) {
		confirmation = kind;
		confirmTarget = id;
		mode = 'confirm';
		error = '';
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

	function handleScannedCode(scanned: string) {
		scanningQr = false;
		code = formatPairingCode(scanned);
		error = '';
		void beginLink();
	}

	function close() {
		if (operation !== null || profileCoordinator.switching) return;
		stopWaiting();
		onClose();
	}

	function onWindowKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented || busy || rowOwnsEscape) return;
		event.preventDefault();
		close();
	}
	const d = dialog({ presentation: 'centeredOverlay' });
	const meter = progressMeter.compact;
	const syncMuted = text({ style: 'bodyMuted' });
	const syncMutedBody = cx(text({ style: 'bodyMuted' }), css({ lineHeight: 'relaxed' }));
	const syncMutedLead = cx(text({ style: 'captionStrong' }), css({ letterSpacing: 'wide' }));
	const syncDanger = text({ tone: 'danger' });
	const syncBackLink = cx(
		text({ style: 'caption' }),
		css({ w: 'full', touchAction: 'manipulation', cursor: 'pointer', textAlign: 'center' })
	);
</script>

<svelte:window onkeydown={onWindowKeyDown} />

<Dialog.Root
	open
	onOpenChange={(details) => !details.open && close()}
	preventScroll={false}
	closeOnEscape={false}
	closeOnInteractOutside={false}
>
	<div {@attach portalToAppOverlay} class={d.portal} role="presentation">
		<Dialog.Backdrop class={d.backdrop} onclick={() => close()} />
		<Dialog.Positioner
			class={d.positioner}
			onclick={(event) => {
				if (event.target === event.currentTarget) close();
			}}
		>
			<Dialog.Content class={d.panel}>
				<div class={d.header}>
					<Dialog.Title class={d.title}>
						<Cloud size={20} aria-hidden="true" />
						{mode === 'menu'
							? 'Workspaces'
							: mode === 'new'
								? 'New workspace'
								: mode === 'link'
									? 'Join synced workspace'
									: mode === 'register'
										? 'Sync workspace'
										: mode === 'confirm'
											? confirmation === 'force'
												? 'Replace cloud notes?'
												: confirmation === 'new-key'
													? 'Create a new sync key?'
													: confirmation === 'remove'
														? 'Delete workspace?'
														: 'Delete cloud data?'
											: 'Connect device'}
					</Dialog.Title>
					<button
						type="button"
						disabled={busy}
						class={iconButton({ variant: 'ghost', size: 'compact' })}
						aria-label="Close"
						onclick={() => close()}
					>
						<X size={16} aria-hidden="true" />
					</button>
				</div>

				{#if mode === 'menu'}
					<div class={vstack({ gap: 'lg', alignItems: 'stretch' })}>
						<div
							class={css({ display: 'grid', gap: '2xs' })}
							aria-label="Workspaces on this device"
						>
							{#each syncStore.profiles as profile (profile.id)}
								{@const active = profile.id === syncStore.activePid}
								{@const synced = !isLocalWorkspace(profile)}
								<WorkspaceRow
									name={profile.name}
									caption={`${synced ? 'Synced' : 'Only on this device'}${
										sizeLabel(profile.id) ? ' · ' + sizeLabel(profile.id) : ''
									}`}
									{active}
									disabled={busy}
									expanded={expandedId === profile.id}
									onselect={() => {
										if (!active) void switchProfile(profile.id);
									}}
									onexport={() => void exportProfile(profile.id)}
									onexpand={() => {
										expandedId = expandedId === profile.id ? null : profile.id;
									}}
									onrename={(next) => renameProfile(profile.id, next)}
									onunlink={synced ? () => unlinkProfile(profile.id) : undefined}
									onbusychange={(holdsEscape) => {
										if (holdsEscape) rowHoldingEscape = profile.id;
										else if (rowHoldingEscape === profile.id) rowHoldingEscape = null;
									}}
								>
									{#snippet icon()}
										{#if synced}<Cloud size={18} aria-hidden="true" />{:else}<CloudOff
												size={18}
												aria-hidden="true"
											/>{/if}
									{/snippet}
									{#snippet actions()}
										{#if synced}
											<button
												type="button"
												class={styles.manageRow}
												disabled={busy}
												onclick={() => confirm('force', profile.id)}
												><RefreshCw
													size={16}
													class={operation === 'force-sync' && confirmTarget === profile.id
														? styles.spinner
														: ''}
													aria-hidden="true"
												/><span
													>{operation === 'force-sync' && confirmTarget === profile.id
														? 'Resyncing…'
														: 'Force resync'}<small
														>Replace cloud notes with this device’s version</small
													></span
												></button
											>
										{:else}
											<button
												type="button"
												class={styles.manageRow}
												disabled={busy}
												onclick={() => startPromote(profile.id)}
												><Cloud size={16} aria-hidden="true" /><span
													>Sync this workspace<small>Keep these notes and start cloud sync</small
													></span
												></button
											>
										{/if}
									{/snippet}
									{#snippet danger()}
										{#if synced}
											<button
												type="button"
												class={cx(styles.manageRow, syncDanger)}
												disabled={busy}
												onclick={() => confirm('delete', profile.id)}
												><CloudOff size={16} aria-hidden="true" /><span
													>Delete cloud data<small>Stop syncing everywhere. Notes stay here.</small
													></span
												></button
											>
										{/if}
										<button
											type="button"
											class={cx(styles.manageRow, syncDanger)}
											disabled={busy}
											onclick={() => confirm('remove', profile.id)}
											><Trash2 size={16} aria-hidden="true" /><span
												>Delete workspace<small
													>{synced
														? 'Remove it from this device. Cloud notes stay.'
														: 'Remove it and its notes from this device'}</small
												></span
											></button
										>
									{/snippet}
								</WorkspaceRow>
							{/each}
						</div>

						<div class={syncStore.account ? hstack({ gap: 'lg', fontSize: 'body' }) : undefined}>
							<button
								type="button"
								disabled={busy}
								class={cx(
									button({ variant: 'quiet', size: 'sm' }),
									css({ color: 'scrapscache.accent' })
								)}
								onclick={() => {
									mode = 'new';
									error = '';
									info = '';
								}}>+ New workspace</button
							>
						</div>
						{#if syncStore.account}
							<div
								class={css({
									borderTopWidth: 'hairline',
									borderColor: 'scrapscache.border',
									pt: 'lg'
								})}
							>
								<div
									class={css({
										display: 'flex',
										flexDirection: { base: 'column', sm: 'row' },
										gap: 'sm'
									})}
								>
									<button
										type="button"
										onclick={() => {
											if (syncStore.keyRetired) confirm('new-key', syncStore.activePid);
											else if (authenticationFailed) confirm('force', syncStore.activePid);
											else void syncNow();
										}}
										disabled={busy}
										class={cx(button({ variant: 'primary', size: 'md' }), styles.growButton)}
										><RefreshCw
											size={16}
											class={syncing ? styles.spinner : ''}
											aria-hidden="true"
										/>{operation === 'sync'
											? 'Syncing…'
											: syncStore.keyRetired
												? 'Create new sync key'
												: authenticationFailed
													? 'Force resync'
													: 'Sync now'}</button
									>
									{#if !authenticationFailed}
										<button
											type="button"
											onclick={() => void startExistingConnection()}
											disabled={busy}
											class={cx(button({ variant: 'secondary', size: 'md' }), styles.growButton)}
											>Connect device</button
										>
									{/if}
								</div>
								{#if syncStore.progress}
									{@const progress = syncStore.progress}
									{@const percent = progressPercent(progress.loadedBytes, progress.totalBytes)}
									<p class={cx(text({ style: 'caption' }), css({ mt: 'sm' }))} role="status">
										{progress.phase === 'upload' ? 'Uploading' : 'Downloading'} · <Format.Byte
											value={progress.loadedBytes}
										/>
									</p>
									<Progress.Root
										value={progress.totalBytes ? percent : null}
										class={css({ mt: 'sm', w: 'full' })}
										><Progress.Track class={meter.track}
											><Progress.Range
												class={meter.bar}
												style={`width: ${progress.totalBytes ? percent : 100}%`}
											/></Progress.Track
										></Progress.Root
									>
								{/if}
							</div>
						{/if}
						{#if error || syncError}<p class={syncDanger} role="alert">
								{error || syncError}
							</p>{/if}
						{#if info}<p class={syncMuted} role="status">
								{info}
							</p>{/if}
					</div>
				{:else if mode === 'confirm'}
					<div class={vstack({ gap: 'lg', alignItems: 'stretch' })}>
						<p class={syncMutedBody}>
							{#if confirmation === 'force'}
								This device’s notes will replace the cloud version using the same sync key. Notes
								only in the cloud will be removed. Other devices will receive these notes as the
								latest version.
							{:else if confirmation === 'new-key'}
								This workspace’s sync key was deleted from the cloud, so it can no longer sync. A
								new key keeps the notes on this device and uploads them to a new cloud account.
								Other devices have to be paired again with a new code.
							{:else if confirmation === 'remove'}
								Permanently delete “{confirmProfile?.name}” and its notes from this device.
								{#if confirmProfile && !isLocalWorkspace(confirmProfile)}
									Its cloud copy and other devices are not changed.
								{/if}
							{:else}
								Permanently delete “{confirmProfile?.name}” from the cloud and stop syncing it on
								all devices. This device keeps its notes as a private workspace.
							{/if}
						</p>
						{#if (confirmation === 'force' || confirmation === 'new-key') && turnstileOrigin}
							<TurnstileWidget
								bind:this={confirmCheck}
								bind:token={confirmToken}
								origin={turnstileOrigin}
								action="register"
							/>
						{/if}
						{#if error}<p class={syncDanger} role="alert">
								{error}
							</p>{/if}
						<div
							class={css({
								display: 'flex',
								flexDirection: { base: 'column', sm: 'row' },
								gap: 'sm'
							})}
						>
							<button
								type="button"
								class={cx(button({ variant: 'secondary', size: 'sm' }), styles.growButton)}
								disabled={busy}
								onclick={() => {
									mode = 'menu';
									confirmation = null;
									confirmTarget = null;
									error = '';
								}}>Cancel</button
							>
							<button
								type="button"
								class={cx(
									button({
										variant: confirmation === 'delete' ? 'destructive' : 'primary',
										size: 'sm'
									}),
									styles.growButton
								)}
								disabled={busy ||
									((confirmation === 'force' || confirmation === 'new-key') &&
										Boolean(turnstileOrigin) &&
										!confirmToken)}
								onclick={() =>
									confirmation === 'force'
										? void forceResync()
										: confirmation === 'new-key'
											? void replaceRetiredKey()
											: confirmation === 'remove'
												? void removeWorkspace()
												: void deleteCloudData()}
								>{busy
									? 'Working…'
									: confirmation === 'force'
										? 'Replace cloud notes'
										: confirmation === 'new-key'
											? 'Create new key'
											: confirmation === 'remove'
												? 'Delete workspace'
												: 'Delete cloud data'}</button
							>
						</div>
					</div>
				{:else if mode === 'register'}
					<div class={vstack({ gap: 'lg', alignItems: 'stretch' })}>
						<p class={syncMutedBody}>
							{syncStore.account
								? 'It starts empty. Your existing workspaces stay unchanged.'
								: 'Your current anonymous notes will be copied into it.'}
						</p>
						<div class={vstack({ gap: 'sm', alignItems: 'stretch' })}>
							<input
								bind:value={newName}
								placeholder="Workspace name (optional)"
								maxlength="60"
								class={input({ variant: 'outline', size: 'md' })}
								aria-label="Sync key name"
								aria-invalid={Boolean(error)}
								onkeydown={(event) => event.key === 'Enter' && void create()}
							/>
							{#if turnstileOrigin}
								<TurnstileWidget
									bind:this={registerCheck}
									bind:token={registerToken}
									origin={turnstileOrigin}
									action="register"
								/>
							{/if}
							{#if error}<p class={syncDanger}>{error}</p>{/if}
							<button
								type="button"
								onclick={() => void create()}
								disabled={busy || (Boolean(turnstileOrigin) && !registerToken)}
								class={cx(button({ variant: 'primary', size: 'md' }), styles.fullButton)}
								>{operation === 'create' ? 'Starting sync…' : 'Start sync'}</button
							>
						</div>
						<div class={hstack({ gap: 'md', alignItems: 'center' })} aria-hidden="true">
							<span class={styles.dividerLine}></span>
							<span
								class={css({
									fontSize: 'caption',
									fontWeight: 'heading',
									textTransform: 'uppercase',
									letterSpacing: 'status',
									color: 'scrapscache.textMuted'
								})}
							>
								or
							</span>
							<span class={styles.dividerLine}></span>
						</div>
						<button
							type="button"
							disabled={busy}
							class={syncBackLink}
							onclick={() => {
								mode = 'menu';
								promoteSource = null;
							}}>← Back to workspaces</button
						>
					</div>
				{:else if mode === 'new'}
					<div class={vstack({ gap: 'lg', alignItems: 'stretch' })}>
						<div class={css({ display: 'grid', gap: 'sm' })}>
							<ChoiceCard
								title="Create workspace"
								caption="Start an empty private workspace on this device. You can sync it later."
								disabled={busy}
								onclick={() => void createLocalWorkspace()}
							>
								{#snippet icon()}<FolderPlus size={18} />{/snippet}
							</ChoiceCard>
							<ChoiceCard
								title="Join a synced workspace"
								caption="Enter a one-time code from another device to sync its workspace here."
								disabled={busy}
								onclick={() => {
									mode = 'link';
									error = '';
								}}
							>
								{#snippet icon()}<MonitorSmartphone size={18} />{/snippet}
							</ChoiceCard>
						</div>
						{#if error}<p class={syncDanger} role="alert">
								{error}
							</p>{/if}
						<button
							type="button"
							onclick={() => (mode = 'menu')}
							disabled={busy}
							class={syncBackLink}>← Back to workspaces</button
						>
					</div>
				{:else if mode === 'link'}
					<div class={vstack({ gap: 'md', alignItems: 'stretch' })}>
						<p class={syncMuted}>
							On your other device open Sync and choose Connect device. Scan the QR code or enter
							the one-time code shown there.
						</p>
						{#if scanningQr}
							<PairingQrScanner onCode={handleScannedCode} />
						{/if}
						<button
							type="button"
							onclick={() => (scanningQr = !scanningQr)}
							disabled={busy}
							class={cx(button({ variant: 'secondary', size: 'md' }), styles.fullButton)}
						>
							<ScanQrCode size={16} aria-hidden="true" />
							{scanningQr ? 'Stop scanning' : 'Scan QR code'}
						</button>
						<input
							type="text"
							value={code}
							oninput={handleCodeInput}
							autocomplete="one-time-code"
							placeholder="XXXX-XXXX-XXXX-XXXX"
							maxlength="19"
							spellcheck="false"
							aria-invalid={Boolean(error)}
							class={cx(input({ variant: 'outline', size: 'md' }), styles.pairingInput)}
							onkeydown={(event) => event.key === 'Enter' && void beginLink()}
						/>{#if error}<p class={syncDanger}>{error}</p>{/if}<button
							type="button"
							onclick={() => void beginLink()}
							disabled={busy}
							class={cx(button({ variant: 'primary', size: 'md' }), styles.fullButton)}
							>{operation === 'connect' ? 'Starting…' : 'Start connection'}</button
						><button
							type="button"
							onclick={() => {
								scanningQr = false;
								mode = 'new';
							}}
							disabled={busy}
							class={syncBackLink}>← Back</button
						>
					</div>
				{:else if mode === 'pairing'}
					<p role="status">Connected. Syncing workspace…</p>
				{:else if mode === 'waiting'}
					<div class={vstack({ gap: 'xl', alignItems: 'stretch' })}>
						{#if waiting?.role === 'existing'}
							<div>
								<p class={syncMutedLead}>On the new device</p>
								<p class={styles.bodySpacing}>
									Scan the QR code, open the link, or type the one-time code
								</p>
							</div>
							{#if qrDataUrl}
								<div class={hstack({ justify: 'center' })}>
									<img src={qrDataUrl} alt="Pair this device" class={styles.qrCode} />
								</div>
							{/if}
							<div class={styles.pairingCode} aria-label="One-time pairing code">
								<div class={hstack({ justify: 'center', gap: '2xs' })}>
									{#each pairingGroups(waiting.syncCode) as group, index (index)}
										{#if index > 0}
											<span
												class={css({ px: '3xs', color: 'scrapscache.textMuted' })}
												aria-hidden="true">·</span
											>
										{/if}
										<span class={styles.digits}>{group}</span>
									{/each}
								</div>
							</div>
							<Clipboard.Root value={pairingShareUrl()} onStatusChange={onCopyStatus}>
								<Clipboard.Trigger
									type="button"
									aria-label="Copy pairing link"
									class={cx(
										button({ variant: 'secondary', size: 'md' }),
										styles.fullButton,
										copyFlash ? styles.copySuccess : ''
									)}
								>
									{copyFlash ? 'Copied' : 'Copy pairing link'}
								</Clipboard.Trigger>
							</Clipboard.Root>
						{:else}
							<div>
								<p class={syncMutedLead}>On the other device</p>
								<p class={styles.bodySpacing}>Open Sync and choose Connect device</p>
							</div>
						{/if}
						<div class={vstack({ gap: 'xs', alignItems: 'stretch' })}>
							<div
								class={hstack({
									justify: 'space-between',
									fontSize: 'label',
									color: 'scrapscache.textMuted'
								})}
							>
								<span>Expires in</span>
								<span class={styles.timerText}>{secondsLeft()}s</span>
							</div>
							<div class={meter.track}>
								<div class={meter.bar} style={`width: ${expiryRatio() * 100}%`}></div>
							</div>
						</div>
						<button
							type="button"
							onclick={() => {
								stopWaiting();
								waiting = null;
								mode = syncStore.isLoggedIn ? 'menu' : 'link';
							}}
							class={cx(
								text({ style: 'bodyMuted' }),
								css({
									w: 'full',
									touchAction: 'manipulation',
									cursor: 'pointer',
									textAlign: 'center'
								})
							)}>Cancel</button
						>
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
