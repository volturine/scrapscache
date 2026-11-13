import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOMATIC } from '#lib/native/appIcon.js';

const native = vi.hoisted(() => ({ app: true }));
const plugin = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('#lib/native.js', () => ({ isNativeApp: () => native.app }));
vi.mock('#lib/native/appIcon.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/native/appIcon.js')>()),
	AppIcon: plugin
}));

/** A fresh store per test: it is a module singleton. */
async function store() {
	vi.resetModules();
	return (await import('./appIcon.svelte.js')).appIconStore;
}

function deferred() {
	let resolve!: () => void;
	let reject!: (cause: Error) => void;
	const promise = new Promise<void>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

const mint = { tile: 'dark', notes: 'stacked', colour: 'mint' } as const;
const sky = { tile: 'light', notes: 'tilted', colour: 'sky' } as const;

beforeEach(() => {
	native.app = true;
	plugin.get.mockReset().mockResolvedValue({ supported: true });
	plugin.set.mockReset().mockResolvedValue(undefined);
});

describe('appIconStore', () => {
	it('stays unsupported on the web, without asking a plugin that is not there', async () => {
		native.app = false;
		const icon = await store();
		await icon.load();
		expect(icon.supported).toBe(false);
		expect(plugin.get).not.toHaveBeenCalled();
	});

	it('reads the icon iOS shows, once', async () => {
		plugin.get.mockResolvedValue({ supported: true, master: 'dark-stacked-mint' });
		const icon = await store();
		await Promise.all([icon.load(), icon.load()]);
		expect(icon.supported).toBe(true);
		expect(icon.choice).toEqual(mint);
		expect(plugin.get).toHaveBeenCalledOnce();
	});

	it('tries the read again after one fails', async () => {
		plugin.get.mockRejectedValueOnce(new Error('bridge'));
		const icon = await store();
		await icon.load();
		expect(icon.supported).toBe(false);
		await icon.load();
		expect(icon.supported).toBe(true);
	});

	it('sets the master a choice names, and the app’s own icon for Automatic', async () => {
		const icon = await store();
		await icon.load();
		await icon.choose(mint);
		expect(plugin.set).toHaveBeenLastCalledWith({ master: 'dark-stacked-mint' });
		await icon.choose(AUTOMATIC);
		expect(plugin.set).toHaveBeenLastCalledWith({ master: null });
		expect(icon.choice).toEqual(AUTOMATIC);
	});

	it('collapses taps made while iOS is busy into the last', async () => {
		const first = deferred();
		plugin.set.mockReturnValueOnce(first.promise);
		const icon = await store();
		await icon.load();
		const running = icon.choose(mint);
		void icon.choose(sky);
		void icon.choose({ ...sky, colour: 'pink' });
		expect(icon.choice).toEqual({ ...sky, colour: 'pink' });
		first.resolve();
		await running;
		expect(plugin.set.mock.calls).toEqual([
			[{ master: 'dark-stacked-mint' }],
			[{ master: 'light-tilted-pink' }]
		]);
	});

	it('does not set the icon iOS already shows', async () => {
		plugin.get.mockResolvedValue({ supported: true, master: 'dark-stacked-mint' });
		const icon = await store();
		await icon.load();
		await icon.choose(mint);
		expect(plugin.set).not.toHaveBeenCalled();
	});

	it('goes back to the icon iOS shows when it refuses, and says so', async () => {
		plugin.get.mockResolvedValue({ supported: true, master: 'dark-stacked-mint' });
		plugin.set.mockRejectedValueOnce(new Error('refused'));
		const icon = await store();
		await icon.load();
		await icon.choose(sky);
		expect(icon.choice).toEqual(mint);
		expect(icon.error).toBe('The icon did not change. Try again.');

		await icon.choose(sky);
		expect(icon.choice).toEqual(sky);
		expect(icon.error).toBe('');
	});

	it('moves on to a newer choice when an older one is refused', async () => {
		const first = deferred();
		plugin.set.mockReturnValueOnce(first.promise);
		const icon = await store();
		await icon.load();
		const running = icon.choose(mint);
		void icon.choose(sky);
		first.reject(new Error('busy'));
		await running;
		expect(plugin.set).toHaveBeenLastCalledWith({ master: 'light-tilted-sky' });
		expect(icon.choice).toEqual(sky);
		expect(icon.error).toBe('');
	});
});
