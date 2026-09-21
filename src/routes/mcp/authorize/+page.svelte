<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { ArrowLeft, ShieldCheck, Sparkles, AlertCircle } from '@lucide/svelte';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { encryptHandshakePayload } from '$lib/mcpHandshake';

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

	let params = $derived(parseParams(page.url));
	let busy = $state(false);
	let error = $state('');

	async function approve() {
		const account = syncStore.account;
		if (!params.valid || !account?.syncKey || busy) return;
		busy = true;
		error = '';

		try {
			const grant = encryptHandshakePayload({
				mcpPublicKey: params.mcpPublicKey,
				syncKey: account.syncKey
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

<div
	class="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[var(--scrapscache-bg)] px-4 py-10 text-[var(--scrapscache-text)]"
>
	<div class="w-full max-w-md">
		<a
			href={resolve('/')}
			class="mb-6 inline-flex items-center gap-2 text-sm text-[var(--scrapscache-text-muted)] hover:text-[var(--scrapscache-text)]"
		>
			<ArrowLeft class="h-4 w-4" />
			Back to Scraps Cache
		</a>

		<section
			class="overflow-hidden rounded-2xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] shadow-xl"
		>
			<div class="border-b border-[var(--scrapscache-border)] px-6 py-6">
				<div
					class="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white"
				>
					<ShieldCheck class="h-6 w-6" />
				</div>
				<p class="mb-1 text-xs font-semibold uppercase tracking-wider text-blue-600">
					MCP AI Authorization
				</p>
				<h1 class="text-2xl font-semibold tracking-tight">
					Connect {params.clientName} to your notes?
				</h1>
			</div>

			<div class="space-y-5 px-6 py-6">
				{#if !params.valid}
					<div
						class="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800"
					>
						<AlertCircle class="h-4 w-4 shrink-0 mt-0.5" />
						<div>
							This authorization handshake request is invalid or missing required parameters.
						</div>
					</div>
				{:else if !syncStore.account?.syncKey}
					<div class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
						<p class="font-medium">No encrypted sync found on this device.</p>
						<p class="mt-1">
							Please set up or link your sync vault in Scraps Cache first, then refresh this page to
							connect {params.clientName}.
						</p>
					</div>
				{:else}
					<div class="space-y-3 text-sm leading-relaxed text-[var(--scrapscache-text-muted)]">
						<div
							class="rounded-lg border border-[var(--scrapscache-border)] bg-[var(--scrapscache-interactive-hover)] p-3 text-xs"
						>
							<div
								class="font-medium text-[var(--scrapscache-text)] flex items-center gap-1.5 mb-1"
							>
								<Sparkles class="h-3.5 w-3.5 text-amber-500" />
								<span>MCP Server Origin</span>
							</div>
							<div class="font-mono text-[11px] truncate text-[var(--scrapscache-text-muted)]">
								{params.callbackOrigin}
							</div>
						</div>

						<p>
							<strong>{params.clientName}</strong> will be granted access to search, read, and update
							your Scraps Cache notes through your self-hosted MCP server.
						</p>
						<p class="text-xs">
							Your notes remain end-to-end encrypted in your cloud sync. The MCP server decrypts
							requested note records only in ephemeral memory when your AI assistant requests them.
						</p>
					</div>
				{/if}

				{#if error}
					<div class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
						{error}
					</div>
				{/if}

				<div class="flex gap-3">
					<button
						type="button"
						onclick={deny}
						disabled={busy}
						class="flex-1 rounded-lg border border-[var(--scrapscache-border)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--scrapscache-interactive-hover)] disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onclick={() => void approve()}
						disabled={busy || !params.valid || !syncStore.account?.syncKey}
						class="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{busy ? 'Connecting…' : 'Allow access'}
					</button>
				</div>
			</div>
		</section>
	</div>
</div>
