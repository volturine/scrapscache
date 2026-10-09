import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	isMissingModuleError,
	loadLazyModule,
	reloadOnceForMissingModule,
	STALE_MODULE_MESSAGE,
	STALE_MODULE_RELOAD_COOLDOWN_MS,
	STALE_MODULE_RELOAD_KEY
} from './staleModuleReload';

const missing = new Error(
	'Failed to fetch dynamically imported module: https://scrapscache.com/_app/immutable/chunks/BtqWIj7_.js'
);

describe('staleModuleReload', () => {
	afterEach(() => {
		sessionStorage.removeItem(STALE_MODULE_RELOAD_KEY);
		vi.restoreAllMocks();
	});

	it('detects the browser missing-module fetch error', () => {
		expect(isMissingModuleError(missing)).toBe(true);
		expect(isMissingModuleError(new Error('Could not open this canvas.'))).toBe(false);
		expect(isMissingModuleError('Failed to fetch dynamically imported module')).toBe(false);
	});

	it('detects the Firefox and Safari wordings too', () => {
		expect(
			isMissingModuleError(
				new TypeError('error loading dynamically imported module: https://x/a.js')
			)
		).toBe(true);
		expect(isMissingModuleError(new TypeError('Importing a module script failed.'))).toBe(true);
	});

	it('reloads once for a missing hashed chunk', () => {
		const reload = vi.fn();
		expect(reloadOnceForMissingModule(missing, 1_000, reload)).toBe(true);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(sessionStorage.getItem(STALE_MODULE_RELOAD_KEY)).toBe('1000');
	});

	it('does not reload for other errors', () => {
		const reload = vi.fn();
		expect(
			reloadOnceForMissingModule(new Error('Could not open this canvas.'), 1_000, reload)
		).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});

	it('does not loop if the new document still cannot fetch the module', () => {
		const reload = vi.fn();
		expect(reloadOnceForMissingModule(missing, 1_000, reload)).toBe(true);
		expect(
			reloadOnceForMissingModule(missing, 1_000 + STALE_MODULE_RELOAD_COOLDOWN_MS - 1, reload)
		).toBe(false);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('allows another reload after the cooldown', () => {
		const reload = vi.fn();
		expect(reloadOnceForMissingModule(missing, 1_000, reload)).toBe(true);
		expect(
			reloadOnceForMissingModule(missing, 1_000 + STALE_MODULE_RELOAD_COOLDOWN_MS, reload)
		).toBe(true);
		expect(reload).toHaveBeenCalledTimes(2);
	});

	describe('loadLazyModule', () => {
		it('returns the module', async () => {
			await expect(loadLazyModule(async () => ({ ok: true }))).resolves.toEqual({ ok: true });
		});

		it('reloads once for a missing chunk and reports it in plain words', async () => {
			const reload = vi.fn();
			await expect(loadLazyModule(() => Promise.reject(missing), reload)).rejects.toThrow(
				STALE_MODULE_MESSAGE
			);
			expect(reload).toHaveBeenCalledTimes(1);
			// Still the same message when the reload cooldown refuses a second reload.
			await expect(loadLazyModule(() => Promise.reject(missing), reload)).rejects.toThrow(
				STALE_MODULE_MESSAGE
			);
			expect(reload).toHaveBeenCalledTimes(1);
		});

		it('passes other failures through unchanged', async () => {
			const reload = vi.fn();
			await expect(loadLazyModule(() => Promise.reject(new Error('boom')), reload)).rejects.toThrow(
				'boom'
			);
			expect(reload).not.toHaveBeenCalled();
		});
	});
});
