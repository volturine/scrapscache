<script lang="ts">
	// The iPhone app's first question: which server it syncs with. Asked at launch
	// until it is answered, here or under Settings › Server. "Decide later" keeps
	// the hosted service for this launch and asks again at the next.
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { portalToAppOverlay } from '#lib/appViewport.js';
	import {
		DEFAULT_SERVER_ORIGIN,
		normalizeServerOrigin,
		serverSetting
	} from '#lib/serverOrigin.svelte.js';
	import { syncStore } from '#lib/stores/sync.svelte.js';
	import { serverPromptStyles as styles } from '$panda/styles';
	import { cx } from 'styled-system/css';
	import { button, dialog, input } from 'styled-system/recipes';

	let { onClose }: { onClose: () => void } = $props();

	const d = dialog({ size: 'sm', presentation: 'appOverlay' });
	const id = $props.id();
	const hostedHost = new URL(DEFAULT_SERVER_ORIGIN).host;

	let choice = $state<'hosted' | 'own'>(serverSetting.isDefault ? 'hosted' : 'own');
	let draft = $state(serverSetting.isDefault ? '' : serverSetting.origin);
	const origin = $derived(
		choice === 'hosted' ? DEFAULT_SERVER_ORIGIN : normalizeServerOrigin(draft)
	);

	/**
	 * A typed-in server is read for its readiness as the address settles: a Scraps
	 * Cache server answers with its `ready` flag, whatever its value. The answer
	 * informs; an address that is an https origin can be used either way, since an
	 * older server, or one behind something that strips the header the app needs,
	 * may well be the right one.
	 */
	type Probe = { origin: string; state: 'checking' | 'ok' | 'off' };
	let probe = $state<Probe | null>(null);
	let settle: ReturnType<typeof setTimeout> | null = null;
	let inFlight: AbortController | null = null;

	$effect(() => {
		const target = choice === 'own' ? origin : null;
		if (settle) clearTimeout(settle);
		inFlight?.abort();
		if (!target) {
			probe = null;
			return;
		}
		probe = { origin: target, state: 'checking' };
		settle = setTimeout(() => void check(target), 500);
		return () => {
			if (settle) clearTimeout(settle);
		};
	});

	async function check(target: string) {
		const controller = new AbortController();
		inFlight = controller;
		const giveUp = setTimeout(() => controller.abort(), 6000);
		let answered = false;
		try {
			const response = await fetch(`${target}/health/ready`, {
				signal: controller.signal,
				cache: 'no-store'
			});
			const data: unknown = await response.json().catch(() => null);
			answered = typeof (data as { ready?: unknown } | null)?.ready === 'boolean';
		} catch {
			answered = false;
		}
		clearTimeout(giveUp);
		if (controller.signal.aborted || probe?.origin !== target) return;
		probe = { origin: target, state: answered ? 'ok' : 'off' };
	}

	function confirm() {
		if (!origin) return;
		const previous = serverSetting.origin;
		if (!serverSetting.set(origin)) return;
		if (serverSetting.origin !== previous) syncStore.serverChanged();
		onClose();
	}
</script>

<Dialog.Root open onOpenChange={(details) => !details.open && onClose()} preventScroll={false}>
	<div {@attach portalToAppOverlay} class={d.portal} role="presentation">
		<Dialog.Backdrop class={d.backdrop} />
		<Dialog.Positioner class={d.positioner}>
			<Dialog.Content class={d.panel}>
				<div class={d.header}>
					<Dialog.Title class={d.title}>Where should your notes sync?</Dialog.Title>
				</div>
				<div class={d.body}>
					<Dialog.Description class={d.description}>
						Notes live on this phone either way. Pick the server this app talks to when you turn
						sync on. You can change it any time under Settings › Server.
					</Dialog.Description>
					<div class={styles.choices} role="radiogroup" aria-label="Server">
						<label class={styles.option}>
							<input
								type="radio"
								name="{id}-server"
								value="hosted"
								class={styles.radio}
								bind:group={choice}
							/>
							<span class={styles.optionText}>
								<span class={styles.optionName}>Scraps Cache</span>
								<span class={styles.optionCaption}>{hostedHost}, the hosted service.</span>
							</span>
						</label>
						<label class={styles.option}>
							<input
								type="radio"
								name="{id}-server"
								value="own"
								class={styles.radio}
								bind:group={choice}
							/>
							<span class={styles.optionText}>
								<span class={styles.optionName}>My own server</span>
								<span class={styles.optionCaption}
									>A self-hosted Scraps Cache relay, over https.</span
								>
								{#if choice === 'own'}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										class={cx(input(), styles.field)}
										type="url"
										inputmode="url"
										autocapitalize="off"
										autocomplete="off"
										spellcheck="false"
										placeholder="https://notes.example.org"
										aria-label="Server address"
										aria-invalid={draft.trim() !== '' && !origin ? true : undefined}
										autofocus
										bind:value={draft}
									/>
									{#if draft.trim() !== '' && !origin}
										<span class={cx(styles.status, styles.statusBad)} role="alert">
											Enter an https address, such as https://notes.example.org.
										</span>
									{:else if probe?.state === 'checking'}
										<span class={styles.status} role="status">Checking…</span>
									{:else if probe?.state === 'ok'}
										<span class={cx(styles.status, styles.statusOk)} role="status">
											✓ Scraps Cache is answering there.
										</span>
									{:else if probe?.state === 'off'}
										<span class={cx(styles.status, styles.statusWarn)} role="status">
											No Scraps Cache server answered there. You can still use it.
										</span>
									{/if}
								{/if}
							</span>
						</label>
					</div>
					<div class={styles.actions}>
						<button type="button" class={styles.later} onclick={onClose}>Decide later</button>
						<button
							type="button"
							class={button({ variant: 'primary', size: 'md' })}
							disabled={!origin}
							onclick={confirm}
						>
							{choice === 'hosted' ? 'Use Scraps Cache' : 'Use this server'}
						</button>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</div>
</Dialog.Root>
