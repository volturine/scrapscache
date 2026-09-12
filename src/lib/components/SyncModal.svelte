<script lang="ts">
	import { cx, sva } from 'styled-system/css';
	import { button, dialog, iconButton, input } from 'styled-system/recipes';
	import { hstack, vstack } from 'styled-system/patterns';
	import WorkspaceRow from './WorkspaceRow.svelte';
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
		mode = 'menu';
		if (result.error)
			error = friendlyError(result.error, 'Created, but the first sync did not finish');
	}

	async function forceResync() {
		error = '';
		info = '';
		const result = await runOperation('force-sync', 'Could not force a full resync', () =>
			profileCoordinator.forceResync()
		);
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

	const d = dialog({ size: 'md' });

	const modalShell = sva({
		slots: ['backdrop', 'positioner', 'panel', 'header', 'title'],
		base: {
			backdrop: { position: 'absolute', bg: 'black/40', backdropFilter: 'none' },
			positioner: {
				position: 'absolute',
				inset: 0,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				p: '1rem'
			},
			panel: { maxH: 'calc(100dvh - 2rem)', overflowY: 'auto', p: '1.25rem' },
			header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
			title: { display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 'medium' }
		}
	});
	const modal = modalShell();
	const shell = {
		backdrop: cx(d.backdrop, modal.backdrop),
		positioner: modal.positioner,
		panel: cx(d.panel, modal.panel),
		header: cx(d.header, modal.header),
		title: cx(d.title, modal.title)
	};

	const modalUi = sva({
		slots: [
			'workspaceList',
			'workspaceRow',
			'workspaceCaption',
			'manageRow',
			'muted',
			'mutedBody',
			'mutedXs',
			'mutedLead',
			'statusHint',
			'danger',
			'text',
			'meterTrack',
			'meterFill',
			'dividerLine',
			'dividerLabel',
			'digitsHyphen',
			'digits',
			'pairingInput',
			'backLink',
			'cancelLink',
			'fullButton',
			'growButton',
			'spinner',
			'portal',
			'workspaceText',
			'truncate',
			'accentButton',
			'syncSection',
			'progress',
			'manageDetails',
			'manageSummary',
			'bodySpacing',
			'qrCode',
			'pairingCode',
			'copySuccess',
			'timer'
		],
		base: {
			workspaceList: { display: 'grid', gap: '4px' },
			workspaceRow: {
				position: 'relative',
				display: 'flex',
				alignItems: 'center',
				gap: '12px',
				w: 'full',
				rounded: '10px',
				p: '12px',
				fontSize: '14px',
				_hoverable: { bg: 'scrapscache.interactiveHover' },
				_disabled: { opacity: 0.55 },
				'&.active': { bg: 'scrapscache.interactiveHover' },
				'&.active::before': {
					content: '""',
					position: 'absolute',
					top: '10px',
					bottom: '10px',
					left: 0,
					w: '3px',
					borderRadius: '0 3px 3px 0',
					bg: 'scrapscache.accent'
				}
			},
			workspaceCaption: {
				display: 'block',
				mt: '2px',
				color: 'scrapscache.textMuted',
				fontSize: '12px',
				fontWeight: '400'
			},
			manageRow: {
				display: 'flex',
				alignItems: 'center',
				gap: '12px',
				w: 'full',
				rounded: '8px',
				padding: '10px 8px',
				textAlign: 'left',
				fontSize: '14px',
				_hoverable: { bg: 'scrapscache.interactiveHover' },
				_disabled: { opacity: 0.55 },
				'& small': {
					display: 'block',
					mt: '2px',
					color: 'scrapscache.textMuted',
					fontSize: '12px',
					fontWeight: '400'
				}
			},
			muted: { fontSize: 'sm', color: 'scrapscache.textMuted' },
			mutedBody: { fontSize: 'sm', color: 'scrapscache.textMuted', lineHeight: 'relaxed' },
			mutedXs: { fontSize: 'xs', color: 'scrapscache.textMuted' },
			mutedLead: {
				fontSize: 'xs',
				color: 'scrapscache.textMuted',
				fontWeight: 'medium',
				letterSpacing: 'wide'
			},
			statusHint: { mt: '0.5rem', fontSize: 'xs', color: 'scrapscache.textMuted' },
			danger: { fontSize: 'sm', color: 'scrapscache.danger' },
			text: { fontSize: 'sm', color: 'scrapscache.text' },
			meterTrack: {
				h: '0.25rem',
				overflow: 'hidden',
				rounded: 'full',
				bg: 'scrapscache.interactiveActive'
			},
			meterFill: {
				h: 'full',
				rounded: 'full',
				bg: 'scrapscache.accent',
				transition: 'width 1000ms linear'
			},
			dividerLine: { h: '1px', flex: '1', bg: 'scrapscache.border' },
			dividerLabel: {
				fontSize: '11px',
				textTransform: 'uppercase',
				letterSpacing: 'wider',
				color: 'scrapscache.textMuted'
			},
			digitsHyphen: { px: '0.125rem', color: 'scrapscache.textMuted' },
			digits: {
				fontFamily: 'mono',
				fontSize: '1.35rem',
				fontWeight: 'semibold',
				letterSpacing: '0.14em',
				color: 'scrapscache.text'
			},
			pairingInput: {
				w: 'full',
				rounded: 'md',
				textAlign: 'center',
				fontSize: 'lg',
				fontWeight: 'bold',
				letterSpacing: 'wider'
			},
			backLink: {
				w: 'full',
				fontSize: 'xs',
				color: 'scrapscache.textMuted',
				touchAction: 'manipulation',
				cursor: 'pointer',
				textAlign: 'center'
			},
			cancelLink: {
				w: 'full',
				fontSize: 'sm',
				color: 'scrapscache.textMuted',
				touchAction: 'manipulation',
				cursor: 'pointer',
				textAlign: 'center'
			},
			fullButton: { w: 'full' },
			growButton: { flex: '1' },
			spinner: { animation: 'spin' },
			portal: { position: 'fixed', inset: 0, zIndex: 50 },
			workspaceText: { minW: 0, flex: '1', textAlign: 'left' },
			truncate: { truncate: true },
			accentButton: { color: 'scrapscache.accent' },
			syncSection: { borderTopWidth: '1px', borderColor: 'scrapscache.border', pt: '1rem' },
			progress: { mt: '0.5rem', w: 'full' },
			manageDetails: { borderTopWidth: '1px', borderColor: 'scrapscache.border', pt: '0.75rem' },
			manageSummary: { cursor: 'pointer', fontSize: 'sm', color: 'scrapscache.textMuted' },
			bodySpacing: { mt: '0.25rem' },
			qrCode: { h: '220px', w: '220px', rounded: 'lg', bg: 'white', p: '0.5rem' },
			pairingCode: {
				rounded: 'xl',
				borderWidth: '1px',
				borderColor: 'scrapscache.border',
				bg: 'scrapscache.bg',
				px: '0.5rem',
				py: '1.25rem'
			},
			copySuccess: {
				borderColor: 'scrapscache.success',
				bg: 'scrapscache.success',
				color: 'scrapscache.successForeground'
			},
			timer: { fontVariantNumeric: 'tabular-nums', color: 'scrapscache.text' }
		}
	});
	const ui = modalUi();
	const pairingInputClass = cx(input({ variant: 'outline', size: 'md' }), ui.pairingInput);
	const fullButton = ui.fullButton;
	const growButton = ui.growButton;
	const spinner = ui.spinner;
</script>

<Dialog.Root
	open
	onOpenChange={(details) => !details.open && close()}
	preventScroll={false}
	closeOnEscape={rowHoldingEscape === null}
>
	<div {@attach portalToAppFloat} class={ui.portal} role="presentation">
		<Dialog.Backdrop class={shell.backdrop} />
		<Dialog.Positioner class={shell.positioner}>
			<Dialog.Content class={shell.panel}>
				<div class={shell.header}>
					<Dialog.Title class={shell.title}>
						<Cloud size={20} aria-hidden="true" />
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
						class={iconButton({ variant: 'ghost', size: 'compact' })}
						aria-label="Close"
					>
						<X size={16} aria-hidden="true" />
					</Dialog.CloseTrigger>
				</div>

				{#if mode === 'menu'}
					<div class={vstack({ gap: '1rem', alignItems: 'stretch' })}>
						<div class={ui.workspaceList} aria-label="Workspaces on this device">
							<button
								type="button"
								class={cx(ui.workspaceRow, syncStore.activePid === LOCAL_PROFILE_ID && 'active')}
								class:active={syncStore.activePid === LOCAL_PROFILE_ID}
								disabled={busy}
								aria-label={syncStore.activePid === LOCAL_PROFILE_ID
									? 'Anonymous workspace is active'
									: 'Switch to Anonymous workspace'}
								onclick={() =>
									syncStore.activePid !== LOCAL_PROFILE_ID && void switchProfile(LOCAL_PROFILE_ID)}
							>
								<CloudOff size={18} aria-hidden="true" />
								<span class={ui.workspaceText}
									><span class={ui.truncate}>Anonymous workspace</span><span
										class={ui.workspaceCaption}
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

						<div class={syncStore.account ? hstack({ gap: '1rem', fontSize: 'sm' }) : undefined}>
							<button
								type="button"
								disabled={busy}
								class={syncStore.account
									? cx(button({ variant: 'quiet', size: 'sm' }), ui.accentButton)
									: cx(button({ variant: 'primary', size: 'md' }), fullButton)}
								onclick={() => {
									mode = 'register';
									error = '';
									info = '';
									newName = '';
								}}>+ New workspace</button
							>
						</div>
						{#if syncStore.account}
							<div class={ui.syncSection}>
								<div class={hstack({ gap: '0.5rem' })}>
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
										class={cx(button({ variant: 'primary', size: 'md' }), growButton)}
										><RefreshCw
											size={16}
											class={syncing ? spinner : ''}
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
										class={cx(button({ variant: 'secondary', size: 'md' }), growButton)}
										>Connect device</button
									>
								</div>
								{#if syncStore.progress}
									{@const progress = syncStore.progress}
									{@const percent = progressPercent(progress.loadedBytes, progress.totalBytes)}
									<p class={ui.statusHint} role="status">
										{progress.phase === 'upload' ? 'Uploading' : 'Downloading'} · <Format.Byte
											value={progress.loadedBytes}
										/>
									</p>
									<Progress.Root value={progress.totalBytes ? percent : null} class={ui.progress}
										><Progress.Track class={ui.meterTrack}
											><Progress.Range
												class={ui.meterFill}
												style={`width: ${progress.totalBytes ? percent : 100}%`}
											/></Progress.Track
										></Progress.Root
									>
								{:else if syncing}<p class={ui.statusHint} role="status">Syncing…</p>{/if}
							</div>
						{/if}
						{#if handoverBlocked}<p class={ui.mutedXs}>
								Wait for sync to finish before changing workspaces.
							</p>{/if}
						{#if error || syncError}<p class={ui.danger} role="alert">
								{error || syncError}
							</p>{/if}
						{#if info}<p class={ui.muted} role="status">
								{info}
							</p>{/if}
						<details class={ui.manageDetails}>
							<summary class={ui.manageSummary}>Manage workspace</summary>
							<div class={vstack({ gap: '0.25rem', alignItems: 'stretch', mt: '0.5rem' })}>
								<button
									class={ui.manageRow}
									disabled={busy}
									onclick={() => void exportProfile(syncStore.activePid)}
									><Download size={16} aria-hidden="true" /><span>Export notes</span></button
								>
								{#if syncStore.account}
									<button
										class={ui.manageRow}
										disabled={busy}
										onclick={() => {
											confirmation = 'force';
											mode = 'confirm';
											error = '';
										}}
										><RefreshCw
											size={16}
											class={operation === 'force-sync' ? spinner : ''}
											aria-hidden="true"
										/><span
											>{operation === 'force-sync' ? 'Resyncing…' : 'Force resync'}<small
												>Replace cloud notes with this device’s version</small
											></span
										></button
									>
									<button
										class={cx(ui.manageRow, ui.danger)}
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
					<div class={vstack({ gap: '1rem', alignItems: 'stretch' })}>
						<p class={ui.mutedBody}>
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
						{#if error}<p class={ui.danger} role="alert">
								{error}
							</p>{/if}
						<div class={hstack({ gap: '0.5rem' })}>
							<button
								type="button"
								class={cx(button({ variant: 'secondary', size: 'sm' }), growButton)}
								disabled={busy}
								onclick={() => {
									mode = 'menu';
									confirmation = null;
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
									growButton
								)}
								disabled={busy}
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
					<div class={vstack({ gap: '1rem', alignItems: 'stretch' })}>
						<p class={ui.mutedBody}>
							{syncStore.account
								? 'It starts empty. Your existing workspaces stay unchanged.'
								: 'Your current anonymous notes will be copied into it.'}
						</p>
						<div class={vstack({ gap: '0.5rem', alignItems: 'stretch' })}>
							<input
								bind:value={newName}
								placeholder="Workspace name (optional)"
								maxlength="60"
								class={input({ variant: 'outline', size: 'md' })}
								aria-label="Sync key name"
								onkeydown={(event) => event.key === 'Enter' && void create()}
							/>
							{#if error}<p class={ui.danger}>{error}</p>{/if}
							<button
								type="button"
								onclick={() => void create()}
								disabled={busy}
								class={cx(button({ variant: 'primary', size: 'md' }), fullButton)}
								>{operation === 'create' ? 'Creating…' : 'Create workspace'}</button
							>
						</div>
						<div class={hstack({ gap: '0.75rem', alignItems: 'center' })} aria-hidden="true">
							<span class={ui.dividerLine}></span>
							<span class={ui.dividerLabel}>or</span>
							<span class={ui.dividerLine}></span>
						</div>
						<button
							type="button"
							disabled={busy}
							class={cx(button({ variant: 'secondary', size: 'md' }), fullButton)}
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
							class={ui.backLink}>← Back to workspaces</button
						>
					</div>
				{:else if mode === 'link'}
					<div class={vstack({ gap: '0.75rem', alignItems: 'stretch' })}>
						<p class={ui.muted}>
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
							class={pairingInputClass}
							onkeydown={(event) => event.key === 'Enter' && void beginLink()}
						/>{#if error}<p class={ui.danger}>{error}</p>{/if}<button
							type="button"
							onclick={() => void beginLink()}
							disabled={busy}
							class={cx(button({ variant: 'primary', size: 'md' }), fullButton)}
							>{operation === 'connect' ? 'Starting…' : 'Start connection'}</button
						><button
							type="button"
							onclick={() => (mode = 'menu')}
							disabled={busy}
							class={ui.backLink}>← Back</button
						>
					</div>
				{:else if mode === 'pairing'}
					<p class={ui.text} role="status">Connected. Syncing workspace…</p>
				{:else if mode === 'waiting'}
					<div class={vstack({ gap: '1.25rem', alignItems: 'stretch' })}>
						{#if waiting?.role === 'existing'}
							<div>
								<p class={ui.mutedLead}>On the new device</p>
								<p class={cx(ui.text, ui.bodySpacing)}>
									Scan the QR code, open the link, or type the one-time code
								</p>
							</div>
							{#if qrDataUrl}
								<div class={hstack({ justify: 'center' })}>
									<img src={qrDataUrl} alt="Pair this device" class={ui.qrCode} />
								</div>
							{/if}
							<div class={ui.pairingCode} aria-label="One-time pairing code">
								<div class={hstack({ justify: 'center', gap: '0.25rem' })}>
									{#each pairingGroups(waiting.syncCode) as group, index (index)}
										{#if index > 0}
											<span class={ui.digitsHyphen} aria-hidden="true">·</span>
										{/if}
										<span class={ui.digits}>{group}</span>
									{/each}
								</div>
							</div>
							<Clipboard.Root value={pairingShareUrl()} onStatusChange={onCopyStatus}>
								<Clipboard.Trigger
									type="button"
									aria-label="Copy pairing link"
									class={cx(
										button({ variant: 'secondary', size: 'md' }),
										fullButton,
										copyFlash ? ui.copySuccess : ''
									)}
								>
									{copyFlash ? 'Copied' : 'Copy pairing link'}
								</Clipboard.Trigger>
							</Clipboard.Root>
						{:else}
							<div>
								<p class={ui.mutedLead}>On the other device</p>
								<p class={cx(ui.text, ui.bodySpacing)}>Open Sync and choose Connect device</p>
							</div>
						{/if}
						<div class={vstack({ gap: '0.375rem', alignItems: 'stretch' })}>
							<div
								class={hstack({
									justify: 'space-between',
									fontSize: 'xs',
									color: 'scrapscache.textMuted'
								})}
							>
								<span>Expires in</span>
								<span class={ui.timer}>{secondsLeft()}s</span>
							</div>
							<div class={ui.meterTrack}>
								<div class={ui.meterFill} style={`width: ${expiryRatio() * 100}%`}></div>
							</div>
						</div>
						<button
							type="button"
							onclick={() => {
								stopWaiting();
								waiting = null;
								mode = syncStore.isLoggedIn ? 'menu' : 'link';
							}}
							class={ui.cancelLink}>Cancel</button
						>
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
