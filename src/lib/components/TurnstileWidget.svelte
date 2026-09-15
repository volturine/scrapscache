<script lang="ts">
	import { TURNSTILE_MESSAGE } from '$lib/turnstileMessage';
	import { css, cx } from 'styled-system/css';
	import { text } from 'styled-system/recipes';

	/**
	 * Turnstile, kept out of this origin. Its script is third-party code, and
	 * anything running here can read the sync keys and decrypted notes, so the
	 * widget runs on a separate challenge origin inside this frame and the only
	 * thing that crosses back is a token.
	 */
	let {
		origin,
		action,
		token = $bindable('')
	}: { origin: string; action: string; token?: string } = $props();

	const MAX_TOKEN_LENGTH = 2048;

	let frame = $state<HTMLIFrameElement>();
	let generation = $state(0);

	/** Tokens are single-use: call after every request that carried one. A fresh
	 * frame is a fresh challenge. */
	export function reset() {
		token = '';
		generation += 1;
	}

	const challengeOrigin = $derived.by(() => {
		try {
			return new URL(origin).origin;
		} catch {
			return null;
		}
	});
	// Framing the challenge from this same origin would run Turnstile's script with
	// full access to this origin, which is the whole thing this avoids.
	const isolated = $derived(challengeOrigin !== null && challengeOrigin !== location.origin);
	const src = $derived(`${challengeOrigin}/turnstile?action=${encodeURIComponent(action)}`);

	function receive(event: MessageEvent) {
		// Both checks matter: the origin says who sent it, the source says it was this
		// frame rather than another one from the same origin.
		if (!isolated || event.origin !== challengeOrigin || event.source !== frame?.contentWindow)
			return;
		const data = event.data as { type?: unknown; token?: unknown } | null;
		if (data?.type !== TURNSTILE_MESSAGE || typeof data.token !== 'string') return;
		token = data.token.length <= MAX_TOKEN_LENGTH ? data.token : '';
	}
</script>

<svelte:window onmessage={receive} />

{#if isolated}
	{#key generation}
		<iframe
			bind:this={frame}
			{src}
			title="Human verification"
			class={css({ display: 'block', h: '65px', w: 'full', border: '0' })}
			sandbox="allow-scripts allow-same-origin allow-popups"
			referrerpolicy="no-referrer"
		></iframe>
	{/key}
{:else}
	<p class={cx(css({ textAlign: 'center' }), text({ tone: 'danger' }))} role="alert">
		Human verification is not configured correctly on this server.
	</p>
{/if}
