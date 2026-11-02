import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishSideColumn } from '#lib/sideColumn.svelte.js';

const shell = vi.hoisted(() => ({
	regions: [] as unknown[],
	answer: true,
	listener: null as null | ((data: { regions: unknown[] }) => void)
}));
vi.mock('@capacitor/core', () => ({
	registerPlugin: () => ({
		get: () =>
			shell.answer
				? Promise.resolve({ regions: shell.regions })
				: Promise.reject(new Error('not implemented')),
		addListener: (_event: string, listener: (data: { regions: unknown[] }) => void) => {
			shell.listener = listener;
			return Promise.resolve({ remove: async () => {} });
		}
	})
}));

import { attachReservedRegions, columnOccupancy, type ReservedRegion } from './reservedRegions.js';

// What the Duo simulator reported, folded and upright: the camera, and the status
// cluster's band down the column.
const camera: ReservedRegion = { x: 399.67, y: 29.33, width: 37, height: 37, active: true };
const cluster: ReservedRegion = { x: 382, y: 0, width: 84, height: 174, active: true };
const upright = { width: 466, height: 678 };
const onSide = { width: 678, height: 466 };

describe('columnOccupancy', () => {
	it('is the band iOS draws at the top of the column, camera and cluster together', () => {
		expect(columnOccupancy([camera, cluster], 'right', upright, 84)).toEqual({
			top: 174,
			bottom: null
		});
		expect(columnOccupancy([cluster, camera], 'right', upright, 84)).toEqual({
			top: 174,
			bottom: null
		});
	});

	it('follows the column to the left, and to the bottom when the phone is turned the other way', () => {
		const leftCamera = { ...camera, x: 29.33 };
		const leftCluster = { ...cluster, x: 0, height: 82 };
		expect(columnOccupancy([leftCamera, leftCluster], 'left', onSide, 84)).toEqual({
			top: 82,
			bottom: null
		});
		expect(columnOccupancy([leftCamera, leftCluster], 'right', onSide, 84)).toEqual({
			top: null,
			bottom: null
		});
		const lowCamera = { x: 611.67, y: 399.67, width: 37, height: 37, active: true };
		const lowCluster = { x: 594, y: 384, width: 84, height: 82, active: true };
		expect(columnOccupancy([lowCamera, lowCluster], 'right', onSide, 84)).toEqual({
			top: null,
			bottom: 82
		});
	});

	it('ignores inactive regions and those outside the column, and knows nothing without a column', () => {
		const fold: ReservedRegion = { x: 230, y: 0, width: 6, height: 678, active: false };
		expect(columnOccupancy([fold], 'right', upright, 84)).toEqual({ top: null, bottom: null });
		expect(columnOccupancy([{ ...cluster, x: 100, width: 100 }], 'right', upright, 84)).toEqual({
			top: null,
			bottom: null
		});
		expect(columnOccupancy([cluster], null, upright, 84)).toEqual({ top: null, bottom: null });
		expect(columnOccupancy([], 'right', upright, 84)).toEqual({ top: null, bottom: null });
	});
});

describe('attachReservedRegions', () => {
	const root = document.documentElement;
	afterEach(() => {
		vi.unstubAllGlobals();
		publishSideColumn(null);
		root.style.removeProperty('--app-inset-right');
		shell.regions = [];
		shell.answer = true;
		shell.listener = null;
	});

	it('sets both bands from what the shell reports, frees a band nothing reaches, and follows later reports', async () => {
		vi.stubGlobal('innerWidth', 466);
		vi.stubGlobal('innerHeight', 678);
		publishSideColumn('right');
		root.style.setProperty('--app-inset-right', '84px');
		shell.regions = [camera, cluster];
		const detach = attachReservedRegions();
		await Promise.resolve();
		await Promise.resolve();
		expect(root.style.getPropertyValue('--app-rail-top')).toBe('182px');
		expect(root.style.getPropertyValue('--app-rail-bottom')).toBe('8px');

		// The phone turned: the island is now at the column's bottom.
		vi.stubGlobal('innerWidth', 678);
		vi.stubGlobal('innerHeight', 466);
		shell.listener?.({
			regions: [
				{ x: 611.67, y: 399.67, width: 37, height: 37, active: true },
				{ x: 594, y: 384, width: 84, height: 82, active: true }
			]
		});
		expect(root.style.getPropertyValue('--app-rail-top')).toBe('8px');
		expect(root.style.getPropertyValue('--app-rail-bottom')).toBe('90px');
		detach();
		expect(root.style.getPropertyValue('--app-rail-top')).toBe('');
	});

	it('leaves the stylesheet alone until the shell has answered, as on the web', async () => {
		publishSideColumn('right');
		shell.answer = false;
		const detach = attachReservedRegions();
		await Promise.resolve();
		await Promise.resolve();
		window.dispatchEvent(new Event('resize'));
		expect(root.style.getPropertyValue('--app-rail-top')).toBe('');
		expect(root.style.getPropertyValue('--app-rail-bottom')).toBe('');
		detach();
	});
});
