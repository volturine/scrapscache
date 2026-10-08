import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Browser smoke tests against the production build (`npm run build` first).
 * The relay runs on throwaway file-backed databases, so no sqld is needed,
 * and Turnstile stays off because none of its variables are set.
 */
const port = 4173;
const dbDir = mkdtempSync(join(tmpdir(), 'scrapscache-e2e-'));

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
					SCRAPSCACHE_ORIGIN: `http://127.0.0.1:${port}`,
					SCRAPSCACHE_RELAY_DB_URL: `file:${join(dbDir, 'relay.db')}`,
					SCRAPSCACHE_OPS_DB_URL: `file:${join(dbDir, 'ops.db')}`
				}
			}
});
