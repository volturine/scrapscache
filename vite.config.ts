import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import adapterNode from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { viteStaticCopy } from 'vite-plugin-static-copy';

/**
 * Cloudflare Workers builds route server-side modules through Cloudflare-specific
 * implementations (D1, Queues, Workers runtime env) instead of the Node/SQLite ones.
 * The mapping is kept here so the rest of the application imports from the same
 * paths in both environments.
 */
const cloudflareModules = new Map([
	['#lib/server/db.js', './src/lib/server/cloudflare/db.ts'],
	['#lib/server/syncStore.js', './src/lib/server/cloudflare/syncStore.ts'],
	['#lib/server/pairingSessions.js', './src/lib/server/cloudflare/pairingSessions.ts'],
	['#lib/server/wakeTimer.js', './src/lib/server/cloudflare/wakeTimer.ts'],
	['#lib/server/telemetryQuery.js', './src/lib/server/cloudflare/telemetryQuery.ts'],
	['#lib/server/metrics.js', './src/lib/server/cloudflare/metrics.ts'],
	['#lib/syncEventsTransport.js', './src/lib/cloudflare/syncEventsTransport.ts']
]);

const cloudflareResolvedModules = new Map(
	Array.from(cloudflareModules.entries()).map(([source, target]) => [
		fileURLToPath(
			new URL(source.replace('#lib', './src/lib').replace(/\.js$/, '.ts'), import.meta.url)
		),
		fileURLToPath(new URL(target, import.meta.url))
	])
);

const cloudflarePlatform: Plugin = {
	name: 'cloudflare-platform',
	enforce: 'pre',
	resolveId(source: string) {
		if (process.env.DEPLOY_TARGET !== 'cloudflare') return null;
		const target = cloudflareModules.get(source);
		if (target) return fileURLToPath(new URL(target, import.meta.url));
		return null;
	},
	load(id: string) {
		if (process.env.DEPLOY_TARGET !== 'cloudflare') return null;
		const target = cloudflareResolvedModules.get(id);
		return target ? `export * from ${JSON.stringify(target)};` : null;
	}
};

/**
 * The commit a build came from. SvelteKit otherwise stamps each build with the
 * current time, which lands inside a chunk and changes every hash that depends on
 * it, so two builds of the same commit could never be compared. Using the commit
 * makes the client bundle reproducible and names what is deployed.
 */
function buildVersion() {
	if (process.env.SCRAPSCACHE_BUILD_VERSION) return process.env.SCRAPSCACHE_BUILD_VERSION;

	try {
		return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		// Container builds have no .git. A fixed value keeps them deterministic;
		// the published image carries its own provenance.
		return 'unversioned';
	}
}

export default defineConfig({
	plugins: [
		cloudflarePlatform,
		sveltekit({
			// Every component in this app uses runes. Dependencies keep their own mode,
			// so a package still written in legacy syntax compiles as it ships.
			dynamicCompileOptions: ({ filename }) =>
				filename.includes('/node_modules/') ? undefined : { runes: true },
			preprocess: vitePreprocess(),
			adapter:
				process.env.DEPLOY_TARGET === 'cloudflare'
					? adapterCloudflare({ config: 'cf/wrangler.svelte.jsonc' })
					: adapterNode(),
			version: { name: buildVersion() },
			csp: {
				mode: 'nonce',
				directives: {
					'default-src': ['self'],
					// No third-party script, ever: anything that runs here can read the sync
					// keys. Turnstile runs on its own origin, framed; see src/routes/turnstile.
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'connect-src': ['self'],
					'img-src': ['self', 'data:', 'blob:'],
					'media-src': ['self', 'data:', 'blob:'],
					// Excalidraw lists its esm.sh copy after ours as a fallback for every font
					// (/fonts, see viteStaticCopy below), and Chrome logs a violation for each
					// blocked fallback when a canvas opens, even though ours loads. Fonts
					// cannot run code; the path keeps the allowance to Excalidraw's package.
					'font-src': ['self', 'https://esm.sh/@excalidraw/'],
					// Chrome's PDF viewer treats an iframe PDF as a plugin, so blob
					// frames need both frame-src and object-src. Third-party frames
					// stay blocked; the Turnstile challenge origin is added at request time
					// from configuration, because it differs per deployment.
					'frame-src': ['self', 'blob:'],
					'object-src': ['self', 'blob:'],
					'base-uri': ['none'],
					'form-action': ['self'],
					'frame-ancestors': ['none']
				}
			}
		}),

		// Excalidraw fetches its fonts from EXCALIDRAW_ASSET_PATH ('/') first and
		// its esm.sh copy only as a fallback. Serve the installed package's own copy,
		// so canvases work offline and the fonts match the version in the lockfile.
		// Runs in every command (build and dev) so the client bundle is never
		// stranded on external network calls.
		viteStaticCopy({
			targets: [
				{
					src: 'node_modules/@excalidraw/excalidraw/dist/prod/fonts/**/*.woff2',
					dest: 'fonts',
					// Drop node_modules/@excalidraw/excalidraw/dist/prod/fonts, keep the family folder.
					rename: { stripBase: 6 }
				}
			]
		})
	],
	build: {
		// Keep imported fonts as same-origin files to match font-src 'self'.
		assetsInlineLimit: (filePath) => (/\.(?:woff2?|ttf|otf)$/i.test(filePath) ? false : undefined)
	},
	server: {
		watch: {
			// Don't reload the page when the sync server writes to sync-data/.
			ignored: ['**/sync-data/**']
		}
	},
	resolve: {
		// Excalidraw's index.css export only matches development/production.
		conditions: ['browser', 'development|production'],
		alias: [
			{
				find: 'styled-system',
				replacement: fileURLToPath(new URL('./styled-system', import.meta.url))
			},
			{
				find: '$panda',
				replacement: fileURLToPath(new URL('./panda', import.meta.url))
			}
		]
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}', 'recipes/**/*.{test,spec}.{js,ts}'],
		environment: 'jsdom',
		globals: true,
		setupFiles: ['src/tests/setup.ts'],
		alias: {
			// The Workers runtime module exists only inside workerd; the Cloudflare
			// modules under test read their bindings through mocks instead.
			'cloudflare:workers': fileURLToPath(
				new URL('./src/tests/cloudflareWorkers.ts', import.meta.url)
			)
		}
	}
});
