import adapterNode from '@sveltejs/adapter-node';
import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { execSync } from 'node:child_process';

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

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Self-hosted Node builds are the default; DEPLOY_TARGET=cloudflare builds the Workers bundle.
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
				'font-src': ['self'],
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
	}
};

export default config;
