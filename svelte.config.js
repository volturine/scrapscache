import adapterNode from '@sveltejs/adapter-node';
import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Self-hosted Node builds are the default; DEPLOY_TARGET=cloudflare builds the Workers bundle.
		adapter:
			process.env.DEPLOY_TARGET === 'cloudflare'
				? adapterCloudflare({ config: 'cf/wrangler.svelte.jsonc' })
				: adapterNode(),
		csp: {
			mode: 'nonce',
			directives: {
				'default-src': ['self'],
				// Turnstile's script and challenge frame are the only third-party origins.
				'script-src': ['self', 'https://challenges.cloudflare.com'],
				'style-src': ['self', 'unsafe-inline'],
				'connect-src': ['self'],
				'img-src': ['self', 'data:', 'blob:'],
				'media-src': ['self', 'data:', 'blob:'],
				'font-src': ['self'],
				// Chrome's PDF viewer treats an iframe PDF as a plugin, so blob
				// frames need both frame-src and object-src. Third-party frames
				// stay blocked apart from the Turnstile challenge.
				'frame-src': ['self', 'blob:', 'https://challenges.cloudflare.com'],
				'object-src': ['self', 'blob:'],
				'base-uri': ['none'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
