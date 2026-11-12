// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	/** The iPhone app's default server, set per app at build time (vite.config.ts). */
	const __DEFAULT_SERVER_ORIGIN__: string;
	/** The hosted servers' Turnstile challenge origins, which the iPhone app may frame (vite.config.ts). */
	const __APP_CHALLENGE_ORIGINS__: string[];
}

export {};
