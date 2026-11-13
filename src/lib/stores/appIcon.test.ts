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
		expect(icon.isShowing(mint)).toBe(true);
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

	it('applies the master a choice names, and the app’s own icon for Automatic', async () => {
		const icon = await store();
		await icon.load();
		await icon.apply(mint);
		expect(plugin.set).toHaveBeenLastCalledWith({ master: 'dark-stacked-mint' });
		expect(icon.choice).toEqual(mint);
		await icon.apply(AUTOMATIC);
		expect(plugin.set).toHaveBeenLastCalledWith({ master: null });
		expect(icon.choice).toEqual(AUTOMATIC);
	});

	it('does not set the icon iOS already shows', async () => {
		plugin.get.mockResolvedValue({ supported: true, master: 'dark-stacked-mint' });
		const icon = await store();
		await icon.load();
		await icon.apply(mint);
		expect(plugin.set).not.toHaveBeenCalled();
	});

	it('applies one change at a time', async () => {
		let finish!: () => void;
		plugin.set.mockReturnValueOnce(new Promise<void>((done) => (finish = done)));
		const icon = await store();
		await icon.load();
		const running = icon.apply(mint);
		expect(icon.applying).toBe(true);
		await icon.apply(sky);
		finish();
		await running;
		expect(plugin.set.mock.calls).toEqual([[{ master: 'dark-stacked-mint' }]]);
		expect(icon.applying).toBe(false);
	});

	it('keeps the icon iOS shows when it refuses, and says so until the next try', async () => {
		plugin.get.mockResolvedValue({ supported: true, master: 'dark-stacked-mint' });
		plugin.set.mockRejectedValueOnce(new Error('refused'));
		const icon = await store();
		await icon.load();
		await icon.apply(sky);
		expect(icon.choice).toEqual(mint);
		expect(icon.error).toBe('The icon did not change. Try again.');

		await icon.apply(sky);
		expect(icon.choice).toEqual(sky);
		expect(icon.error).toBe('');
	});
});
