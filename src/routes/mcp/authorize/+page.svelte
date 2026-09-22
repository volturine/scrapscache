<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { ArrowLeft, ShieldCheck, Sparkles, AlertCircle } from '@lucide/svelte';
	import { css, cx } from 'styled-system/css';
	import { button } from 'styled-system/recipes';
	import { syncStore, type McpWorkspaceStatus } from '$lib/stores/sync.svelte';
	import { encryptHandshakePayload } from '$lib/mcpHandshake';
	import { isLocalWorkspace, mcpWorkspaceGrant } from '$lib/profiles';

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

	function parseParams(url: URL): AuthorizeParams {
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

	const shell = css({
		position: 'fixed',
		inset: 0,
		zIndex: 100,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		overflowY: 'auto',
		bg: 'scrapscache.bg',
		color: 'scrapscache.text',
		px: 'lg',
		py: '3xl'
	});
	const frame = css({ w: 'full', maxW: '28rem' });
	const back = css({
		display: 'inline-flex',
		alignItems: 'center',
		gap: 'sm',
		mb: 'lg',
		textStyle: 'body',
		color: 'scrapscache.textMuted',
		_hoverable: { color: 'scrapscache.text' }
	});
	const card = css({
		overflow: 'hidden',
		rounded: 'dialog',
		borderWidth: 'hairline',
		borderColor: 'scrapscache.border',
		bg: 'scrapscache.surface',
		boxShadow: 'popover'
	});
	const header = css({
		borderBottomWidth: 'hairline',
		borderColor: 'scrapscache.border',
		px: 'xl',
		py: 'xl'
	});
	const shield = css({
		display: 'grid',
		placeItems: 'center',
		w: '2.75rem',
		h: '2.75rem',
		mb: 'md',
		rounded: 'control',
		bg: 'scrapscache.accent',
		color: 'scrapscache.accentForeground'
	});
	const eyebrow = css({
		mb: '2xs',
		textStyle: 'micro',
		fontWeight: 'heading',
		letterSpacing: 'eyebrow',
		textTransform: 'uppercase',
		color: 'scrapscache.accent'
	});
	const title = css({ textStyle: 'display', letterSpacing: '-0.02em' });
	const body = css({
		display: 'flex',
		flexDirection: 'column',
		gap: 'lg',
		px: 'xl',
		py: 'xl'
	});
	const origin = css({
		rounded: 'control',
		borderWidth: 'hairline',
		borderColor: 'scrapscache.border',
		bg: 'scrapscache.surfaceSubtle',
		p: 'md'
	});
	const originLabel = css({
		display: 'flex',
		alignItems: 'center',
		gap: 'xs',
		mb: '2xs',
		textStyle: 'captionStrong',
		color: 'scrapscache.text'
	});
	const originUrl = css({
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
		textStyle: 'caption',
		color: 'scrapscache.textMuted'
	});
	const copy = css({
		display: 'flex',
		flexDirection: 'column',
		gap: 'sm',
		textStyle: 'bodyMuted',
		'& strong': { color: 'scrapscache.text', fontWeight: 'heading' }
	});
	const fine = css({ textStyle: 'caption' });
	const iconSm = css({ w: '1rem', h: '1rem', flexShrink: 0 });
	const iconMd = css({ w: '1.5rem', h: '1.5rem' });
	const noticeDanger = css({
		display: 'flex',
		alignItems: 'flex-start',
		gap: 'sm',
		rounded: 'control',
		borderWidth: 'hairline',
		borderColor: 'scrapscache.danger',
		bg: 'scrapscache.dangerSubtle',
		p: 'md',
		textStyle: 'body',
		color: 'scrapscache.text'
	});
	const noticeWarning = css({
		display: 'flex',
		alignItems: 'flex-start',
		gap: 'sm',
		rounded: 'control',
		borderWidth: 'hairline',
		borderColor: 'scrapscache.warning',
		bg: 'scrapscache.warningSubtle',
		p: 'md',
		textStyle: 'body',
		color: 'scrapscache.text'
	});
	const workspaces = css({
		display: 'flex',
		flexDirection: 'column',
		gap: 'sm',
		m: 0,
		minW: 0,
		p: 0,
		border: 'none'
	});
	const workspaceToolbar = css({
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: 'sm'
	});
	const workspaceList = css({
		display: 'flex',
		flexDirection: 'column',
		gap: 'sm',
		maxHeight: 'min(16rem, 45dvh)',
		overflowY: 'auto',
		overscrollBehavior: 'contain',
		rounded: 'control',
		borderWidth: 'hairline',
		borderColor: 'scrapscache.border',
		p: 'sm'
	});
	const legend = css({
		textStyle: 'captionStrong',
		letterSpacing: 'eyebrow',
		textTransform: 'uppercase',
		color: 'scrapscache.text'
	});
	const option = css({
		display: 'flex',
		alignItems: 'flex-start',
		gap: 'sm',
		rounded: 'control',
		borderWidth: 'hairline',
		borderColor: 'scrapscache.border',
		bg: 'scrapscache.bg',
		px: 'md',
		py: 'md',
		cursor: 'pointer',
		_hoverable: { bg: 'scrapscache.interactiveHover' },
		'&:has(input:checked)': {
			borderColor: 'scrapscache.accent',
			bg: 'scrapscache.accentSubtle'
		},
		'&:has(input:focus-visible)': {
			outline: '2px solid',
			outlineColor: 'scrapscache.focus',
			outlineOffset: '2px'
		}
	});
	const radio = css({ mt: '3xs', accentColor: 'scrapscache.accent' });
	const optionText = css({ display: 'flex', flexDirection: 'column', gap: '3xs', minW: 0 });
	const optionName = css({ textStyle: 'bodyStrong' });
	const optionCaption = css({ textStyle: 'caption' });
	const localRow = css({
		display: 'flex',
		alignItems: 'flex-start',
		gap: 'sm',
		rounded: 'control',
		borderWidth: 'hairline',
		borderColor: 'scrapscache.border',
		px: 'md',
		py: 'md',
		opacity: 0.72
	});
	const actions = css({ display: 'flex', gap: 'md' });
	const action = css({ flex: '1' });

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

<div class={shell}>
	<div class={frame}>
		<a href={resolve('/')} class={back}>
			<ArrowLeft class={iconSm} aria-hidden="true" />
			Back to Scraps Cache
		</a>

		<section class={card}>
			<div class={header}>
				<div class={shield}>
					<ShieldCheck class={iconMd} aria-hidden="true" />
				</div>
				<p class={eyebrow}>MCP AI Authorization</p>
				<h1 class={title}>Connect {params.clientName} to your notes?</h1>
			</div>

			<div class={body}>
				{#snippet workspaceChoices()}
					{#each notReady as workspace (workspace.id)}
						<label class={localRow}>
							<input class={radio} type="radio" disabled />
							<span class={optionText}>
								<span class={optionName}>{workspace.name}</span>
								<span class={optionCaption}>{statusCaption(mcpStatuses[workspace.id])}</span>
							</span>
						</label>
					{/each}
					{#each synced as workspace (workspace.id)}
						<label class={option}>
							<input
								class={radio}
								type="radio"
								name="mcp-workspace"
								value={workspace.id}
								checked={selected?.id === workspace.id}
								aria-describedby="mcp-workspace-hint"
								onchange={() => (selectedWorkspaceId = workspace.id)}
							/>
							<span class={optionText}>
								<span class={optionName}>{workspace.name}</span>
								<span class={optionCaption}>
									{workspace.id === syncStore.activeId ? 'Open on this device' : 'Synced'}
								</span>
							</span>
						</label>
					{/each}
					{#each localOnly as workspace (workspace.id)}
						<label class={localRow}>
							<input class={radio} type="radio" disabled />
							<span class={optionText}>
								<span class={optionName}>{workspace.name}</span>
								<span class={optionCaption}>On this device only</span>
							</span>
						</label>
					{/each}
				{/snippet}

				{#if !params.valid}
					<div class={noticeDanger}>
						<AlertCircle class={iconSm} aria-hidden="true" />
						<p>This authorization handshake request is invalid or missing required parameters.</p>
					</div>
				{:else if checkingWorkspaces}
					<div class={noticeWarning}>
						<div>
							<p class={optionName}>Checking synced workspaces…</p>
							<p class={fine}>Scraps Cache is verifying that each synced workspace is reachable.</p>
						</div>
					</div>
				{:else if synced.length === 0}
					<div class={noticeWarning}>
						<div>
							<p class={optionName}>
								{notReady.length > 0
									? 'No reachable synced workspace is available for MCP.'
									: 'No synced workspace on this device.'}
							</p>
							<p class={fine}>
								{notReady.length > 0
									? `Repair the unavailable cloud account, then refresh this page to connect ${params.clientName}.`
									: `Set up sync for a workspace in Scraps Cache, then refresh this page to connect ${params.clientName}.`}
								A workspace that stays on this device cannot be granted.
							</p>
						</div>
					</div>
					{#if notReady.length > 0 || localOnly.length > 0}
						<fieldset class={workspaces} aria-labelledby="mcp-workspace-label">
							<div class={workspaceToolbar}>
								<span id="mcp-workspace-label" class={legend}>Workspace status</span>
							</div>
							<p id="mcp-workspace-hint" class={fine}>
								Only synced workspaces with a reachable cloud account can be selected.
							</p>
							<div class={workspaceList}>{@render workspaceChoices()}</div>
						</fieldset>
					{/if}
				{:else}
					{#if notReady.length > 0}
						<div class={noticeWarning}>
							<div>
								<p class={optionName}>Some workspaces are unavailable for MCP.</p>
								<p class={fine}>
									Only synced workspaces with a reachable cloud account can be selected. The
									unavailable workspaces below are disabled.
								</p>
							</div>
						</div>
					{/if}
					<div class={origin}>
						<div class={originLabel}>
							<Sparkles class={iconSm} aria-hidden="true" />
							<span>MCP Server Origin</span>
						</div>
						<div class={originUrl}>{params.callbackOrigin}</div>
					</div>

					<fieldset class={workspaces} aria-labelledby="mcp-workspace-label">
						<div class={workspaceToolbar}>
							<span id="mcp-workspace-label" class={legend}>Workspace for this connection</span>
						</div>
						<p id="mcp-workspace-hint" class={fine}>
							Choose one synced workspace. To connect another workspace, create a separate MCP
							connection.
						</p>
						<div class={workspaceList}>
							{@render workspaceChoices()}
						</div>
					</fieldset>

					<div class={copy}>
						{#if selected}
							<p>
								<strong>{params.clientName}</strong> will be granted access to notes in
								<strong>{selected.name}</strong> through your self-hosted MCP server.
							</p>
						{:else}
							<p>Select one workspace before allowing access.</p>
						{/if}
						<p class={fine}>
							Your notes remain end-to-end encrypted in your cloud sync. The MCP server decrypts
							requested note records only in ephemeral memory when your AI assistant requests them.
						</p>
					</div>
				{/if}

				{#if error}
					<div class={noticeDanger} role="alert">{error}</div>
				{/if}

				<div class={actions}>
					<button
						type="button"
						class={cx(button({ variant: 'secondary', size: 'md' }), action)}
						onclick={deny}
						disabled={busy}
					>
						Cancel
					</button>
					<button
						type="button"
						class={cx(button({ variant: 'primary', size: 'md' }), action)}
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
