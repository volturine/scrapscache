import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke tests against the production build (`npm run build` first).
 * The server needs the two local sqld processes from docs/development.md
 * (SCRAPSCACHE_RELAY_DB_URL and SCRAPSCACHE_OPS_DB_URL pass through), and
 * Turnstile stays off because none of its variables are set.
 */
const port = 4173;

/** Set PLAYWRIGHT_BASE_URL to run the suite against a deployment instead of a local build. */
const remote = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	timeout: 60_000,
	use: {
		baseURL: remote || `http://127.0.0.1:${port}`,
		trace: 'retain-on-failure',
		launchOptions: {
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
		}
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: remote
		? undefined
		: {
				command: 'node build',
				url: `http://127.0.0.1:${port}/health/ready`,
				reuseExistingServer: false,
				timeout: 30_000,
				env: {
					PORT: String(port),
					HOST: '127.0.0.1',
					SCRAPSCACHE_ORIGIN: `http://127.0.0.1:${port}`
				}
			}
});
