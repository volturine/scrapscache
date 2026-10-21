import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * The operator dashboard, built apart from the notes app: a static page that only
 * talks to the admin API. Cloudflare serves it from its own Worker
 * (cf/wrangler.admin.jsonc); the Node server serves it at /admin/. Relative asset
 * URLs let the one build work under either path.
 *
 * `npm run dev:admin` serves it with the admin API proxied to the app's dev server
 * at SCRAPSCACHE_ADMIN_API_ORIGIN.
 */
export default defineConfig({
	root: fromRoot('./src/admin'),
	base: './',
	plugins: [
		svelte({
			compilerOptions: { runes: true },
			preprocess: vitePreprocess()
		}),
		viteStaticCopy({
			targets: [{ src: fromRoot('./static/favicon.png'), dest: '.', rename: { stripBase: true } }]
		})
	],
	css: { postcss: fromRoot('.') },
	resolve: {
		alias: {
			'styled-system': fromRoot('./styled-system'),
			$panda: fromRoot('./panda')
		}
	},
	build: {
		outDir: fromRoot('./build/admin'),
		emptyOutDir: true,
		// Fonts stay same-origin files, as font-src 'self' requires.
		assetsInlineLimit: (filePath) => (/\.(?:woff2?|ttf|otf)$/i.test(filePath) ? false : undefined)
	},
	server: {
		proxy: Object.fromEntries(
			['/api/admin', '/metrics'].map((path) => [
				path,
				{ target: process.env.SCRAPSCACHE_ADMIN_API_ORIGIN ?? 'http://localhost:5173' }
			])
		)
	}
});
