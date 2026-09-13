<script lang="ts" module>
	type Turnstile = {
		render(container: HTMLElement, options: Record<string, unknown>): string;
		reset(widgetId: string): void;
		remove(widgetId: string): void;
	};

	let loading: Promise<Turnstile> | null = null;

	function loadTurnstile(): Promise<Turnstile> {
		loading ??= new Promise<Turnstile>((resolve, reject) => {
			const script = document.createElement('script');
			script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
			script.async = true;
			script.onload = () => {
				const turnstile = (window as { turnstile?: Turnstile }).turnstile;
				if (turnstile) resolve(turnstile);
				else reject(new Error('Turnstile did not initialize'));
			};
			script.onerror = () => {
				script.remove();
				loading = null;
				reject(new Error('Turnstile could not load'));
			};
			document.head.append(script);
		});
		return loading;
	}
</script>

<script lang="ts">
	let {
		sitekey,
		action,
		token = $bindable('')
	}: { sitekey: string; action: string; token?: string } = $props();

	let failed = $state(false);
	let turnstile: Turnstile | null = null;
	let widgetId: string | null = null;

	/** Tokens are single-use: call after every request that carried one. */
	export function reset() {
		token = '';
		if (turnstile && widgetId) turnstile.reset(widgetId);
	}

	function mount(container: HTMLElement) {
		let removed = false;
		loadTurnstile().then(
			(loaded) => {
				if (removed) return;
				turnstile = loaded;
				widgetId = loaded.render(container, {
					sitekey,
					action,
					theme: 'auto',
					size: 'flexible',
					callback: (value: string) => (token = value),
					'expired-callback': () => (token = ''),
					'error-callback': () => {
						token = '';
					}
				});
			},
			() => {
				if (!removed) failed = true;
			}
		);
		return () => {
			removed = true;
			if (turnstile && widgetId) turnstile.remove(widgetId);
			widgetId = null;
		};
	}
</script>

<div {@attach mount} class="min-h-[65px] w-full"></div>
{#if failed}
	<p class="text-center text-sm text-[var(--scrapscache-danger)]" role="alert">
		Human verification could not load. Check your connection and reopen this dialog.
	</p>
{/if}
