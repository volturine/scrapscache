<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { ArrowLeft, ShieldCheck, Sparkles, AlertCircle } from '@lucide/svelte';
	import { cx } from 'styled-system/css';
	import { iconSizeMd, iconSizeSm, mcpAuthorizeStyles as styles } from '$panda/styles';
	import { button } from 'styled-system/recipes';
	import { syncStore, type McpWorkspaceStatus } from '#lib/stores/sync.svelte.js';
	import { encryptHandshakePayload } from '#lib/mcpHandshake.js';
	import { isLocalWorkspace, mcpWorkspaceGrant } from '#lib/profiles.js';

	type AuthorizeParams = {
		valid: boolean;
		sessionId: string;
		mcpPublicKey: string;
		mcpCallback: string;
		clientName: string;
		callbackOrigin: string;
	};

	function isLoopbackHost(hostname: string): boolean {
		return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
	}

	function parseParams(url: {
		searchParams: { get(name: string): string | null };
	}): AuthorizeParams {
		const sessionId = url.searchParams.get('session_id') || '';
		const mcpPublicKey = url.searchParams.get('mcp_public_key') || '';
		const mcpCallback = url.searchParams.get('mcp_callback') || '';
		const clientName = (url.searchParams.get('client_name') || 'AI Client').trim();

		let callbackOrigin = '';
		let validCallback = false;
		try {
			const parsed = new URL(mcpCallback);
			callbackOrigin = parsed.origin;
			validCallback =
				(parsed.protocol === 'https:' ||
					(parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))) &&
				parsed.pathname.includes('/oauth/callback');
		} catch {
			validCallback = false;
		}

		const valid =
			Boolean(sessionId) && Boolean(mcpPublicKey) && mcpPublicKey.length >= 40 && validCallback;

		return {
			valid,
			sessionId,
			mcpPublicKey,
			mcpCallback,
			clientName: clientName.slice(0, 60),
			callbackOrigin
		};
	}

	let params = $derived(parseParams(page.url));
	let busy = $state(false);
	let error = $state('');
	let selectedWorkspaceId = $state<string | null>(null);
	let checkingWorkspaces = $state(true);
	let mcpStatuses = $state<Record<string, McpWorkspaceStatus>>({});

	onMount(() => {
		if (!params.valid) {
			checkingWorkspaces = false;
			return;
		}

		let cancelled = false;
		void syncStore
			.getMcpWorkspaceStatuses()
			.then((statuses) => {
				if (cancelled) return;
				mcpStatuses = statuses;
				const ready = syncStore.profiles.filter(
					(profile) => statuses[profile.id]?.state === 'ready'
				);
				selectedWorkspaceId = ready.length === 1 ? ready[0].id : null;
				checkingWorkspaces = false;
			})
			.catch(() => {
				if (cancelled) return;
				const statuses: Record<string, McpWorkspaceStatus> = {};
				for (const profile of syncStore.profiles) {
					statuses[profile.id] = profile.syncKey ? { state: 'unavailable' } : { state: 'local' };
				}
				mcpStatuses = statuses;
				selectedWorkspaceId = null;
				checkingWorkspaces = false;
			});

		return () => {
			cancelled = true;
		};
	});

	let synced = $derived(
		syncStore.profiles.filter((profile) => mcpStatuses[profile.id]?.state === 'ready')
	);
	let notReady = $derived(
		checkingWorkspaces
			? []
			: syncStore.profiles.filter(
					(profile) => profile.syncKey && mcpStatuses[profile.id]?.state !== 'ready'
				)
	);
	let localOnly = $derived(syncStore.profiles.filter((profile) => isLocalWorkspace(profile)));
	let selected = $derived(synced.find((workspace) => workspace.id === selectedWorkspaceId) ?? null);

	function statusCaption(status: McpWorkspaceStatus | undefined): string {
		if (status?.state === 'unavailable') return 'Cloud sync account is unavailable';
		return 'Not available to MCP';
	}

	async function approve() {
		if (!params.valid || checkingWorkspaces || !selected || busy) return;
		const grantWorkspaces = mcpWorkspaceGrant([selected]);
		busy = true;
		error = '';

		try {
			const grant = encryptHandshakePayload({
				mcpPublicKey: params.mcpPublicKey,
				workspaces: grantWorkspaces
			});

			const redirectUrl = new URL(params.mcpCallback);
			redirectUrl.hash = new URLSearchParams({
				session_id: params.sessionId,
				client_public_key: grant.clientPublicKey,
				ciphertext: grant.ciphertext,
				nonce: grant.nonce
			}).toString();

			window.location.replace(redirectUrl.toString());
		} catch (err) {
			busy = false;
			error = err instanceof Error ? err.message : 'Could not complete authorization handshake.';
		}
	}

	function deny() {
		if (!params.valid || busy) {
			window.location.assign('/');
			return;
		}
		const redirectUrl = new URL(params.mcpCallback);
		redirectUrl.hash = new URLSearchParams({
			session_id: params.sessionId,
			error: 'access_denied',
			error_description: 'The user denied the authorization request'
		}).toString();
		window.location.replace(redirectUrl.toString());
	}
</script>

<svelte:head>
	<title>Authorize {params.clientName} · Scraps Cache</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class={styles.shell}>
	<div class={styles.frame}>
		<a href={resolve('')} class={styles.back}>
			<ArrowLeft class={iconSizeSm} aria-hidden="true" />
			Back to Scraps Cache
		</a>

		<section class={styles.card}>
			<div class={styles.header}>
				<div class={styles.shield}>
					<ShieldCheck class={iconSizeMd} aria-hidden="true" />
				</div>
				<p class={styles.eyebrow}>MCP AI Authorization</p>
				<h1 class={styles.title}>Connect {params.clientName} to your notes?</h1>
			</div>

			<div class={styles.body}>
				{#snippet workspaceChoices()}
					{#each notReady as workspace (workspace.id)}
						<label class={styles.unavailableOption}>
							<input class={styles.radio} type="radio" disabled />
							<span class={styles.optionText}>
								<span class={styles.optionName}>{workspace.name}</span>
								<span class={styles.optionCaption}>{statusCaption(mcpStatuses[workspace.id])}</span>
							</span>
						</label>
					{/each}
					{#each synced as workspace (workspace.id)}
						<label class={styles.option}>
							<input
								class={styles.radio}
								type="radio"
								name="mcp-workspace"
								value={workspace.id}
								checked={selected?.id === workspace.id}
								aria-describedby="mcp-workspace-hint"
								onchange={() => (selectedWorkspaceId = workspace.id)}
							/>
							<span class={styles.optionText}>
								<span class={styles.optionName}>{workspace.name}</span>
								<span class={styles.optionCaption}>
									{workspace.id === syncStore.activeId ? 'Open on this device' : 'Synced'}
								</span>
							</span>
						</label>
					{/each}
					{#each localOnly as workspace (workspace.id)}
						<label class={styles.unavailableOption}>
							<input class={styles.radio} type="radio" disabled />
							<span class={styles.optionText}>
								<span class={styles.optionName}>{workspace.name}</span>
								<span class={styles.optionCaption}>On this device only</span>
							</span>
						</label>
					{/each}
				{/snippet}

				{#if !params.valid}
					<div class={styles.notice({ tone: 'danger' })}>
						<AlertCircle class={styles.noticeIcon} aria-hidden="true" />
						<p>This authorization handshake request is invalid or missing required parameters.</p>
					</div>
				{:else if checkingWorkspaces}
					<div class={styles.notice({ tone: 'warning' })}>
						<div>
							<p class={styles.optionName}>Checking synced workspaces…</p>
							<p class={styles.fine}>
								Scraps Cache is verifying that each synced workspace is reachable.
							</p>
						</div>
					</div>
				{:else if synced.length === 0}
					<div class={styles.notice({ tone: 'warning' })}>
						<div>
							<p class={styles.optionName}>
								{notReady.length > 0
									? 'No reachable synced workspace is available for MCP.'
									: 'No synced workspace on this device.'}
							</p>
							<p class={styles.fine}>
								{notReady.length > 0
									? `Repair the unavailable cloud account, then refresh this page to connect ${params.clientName}.`
									: `Set up sync for a workspace in Scraps Cache, then refresh this page to connect ${params.clientName}.`}
								A workspace that stays on this device cannot be granted.
							</p>
						</div>
					</div>
					{#if notReady.length > 0 || localOnly.length > 0}
						<fieldset class={styles.workspaces} aria-labelledby="mcp-workspace-label">
							<span id="mcp-workspace-label" class={styles.legend}>Workspace status</span>
							<p id="mcp-workspace-hint" class={styles.fine}>
								Only synced workspaces with a reachable cloud account can be selected.
							</p>
							<div class={styles.workspaceList}>{@render workspaceChoices()}</div>
						</fieldset>
					{/if}
				{:else}
					{#if notReady.length > 0}
						<div class={styles.notice({ tone: 'warning' })}>
							<div>
								<p class={styles.optionName}>Some workspaces are unavailable for MCP.</p>
								<p class={styles.fine}>
									Only synced workspaces with a reachable cloud account can be selected. The
									unavailable workspaces below are disabled.
								</p>
							</div>
						</div>
					{/if}
					<div class={styles.origin}>
						<div class={styles.originLabel}>
							<Sparkles class={iconSizeSm} aria-hidden="true" />
							<span>MCP Server Origin</span>
						</div>
						<div class={styles.originUrl}>{params.callbackOrigin}</div>
					</div>

					<fieldset class={styles.workspaces} aria-labelledby="mcp-workspace-label">
						<span id="mcp-workspace-label" class={styles.legend}>Workspace for this connection</span
						>
						<p id="mcp-workspace-hint" class={styles.fine}>
							Choose one synced workspace. To connect another workspace, create a separate MCP
							connection.
						</p>
						<div class={styles.workspaceList}>
							{@render workspaceChoices()}
						</div>
					</fieldset>

					<div class={styles.copy}>
						{#if selected}
							<p>
								<strong>{params.clientName}</strong> will be granted access to notes in
								<strong>{selected.name}</strong> through your self-hosted MCP server.
							</p>
						{:else}
							<p>Select one workspace before allowing access.</p>
						{/if}
						<p class={styles.fine}>
							Your notes remain end-to-end encrypted in your cloud sync. The MCP server decrypts
							requested note records only in ephemeral memory when your AI assistant requests them.
						</p>
					</div>
				{/if}

				{#if error}
					<div class={styles.notice({ tone: 'danger' })} role="alert">{error}</div>
				{/if}

				<div class={styles.actions}>
					<button
						type="button"
						class={cx(button({ variant: 'secondary', size: 'md' }), styles.action)}
						onclick={deny}
						disabled={busy}
					>
						Cancel
					</button>
					<button
						type="button"
						class={cx(button({ variant: 'primary', size: 'md' }), styles.action)}
						onclick={() => void approve()}
						disabled={busy || checkingWorkspaces || !params.valid || !selected}
					>
						{busy ? 'Connecting…' : 'Allow access'}
					</button>
				</div>
			</div>
		</section>
	</div>
</div>
