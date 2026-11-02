import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { sideColumn, type SideColumn } from '#lib/sideColumn.svelte.js';

/** A rect iOS has reserved in the web view, in CSS pixels; the camera island, the status cluster. */
export type ReservedRegion = {
	x: number;
	y: number;
	width: number;
	height: number;
	active: boolean;
};

type ReservedRegionsPlugin = {
	get(): Promise<{ regions: ReservedRegion[] }>;
	addListener(
		event: 'reservedRegions',
		listener: (data: { regions: ReservedRegion[] }) => void
	): Promise<PluginListenerHandle>;
};

/** The app shell's plugin (ScrapsBridgeViewController.swift); absent on a web build. */
const ReservedRegions = registerPlugin<ReservedRegionsPlugin>('ReservedRegions');

/** Room kept between the system's drawings and the rail. */
const GAP_PX = 8;

/**
 * What iOS draws in a side column: how far down from the top, how far up from the
 * bottom, and where across the column it centres its drawings (the camera's
 * centre, which the island and the clock share), as an offset from the column's
 * own middle.
 */
export type ColumnOccupancy = { top: number | null; bottom: number | null; shift: number | null };

/**
 * The bands iOS occupies in a side column, from the active occlusion regions
 * that reach into it: the island and the status cluster sit at the column's
 * top, or at its bottom when the folded phone is turned the other way. Null
 * for a band nothing reaches, as an iOS before 27.1 reports for both.
 */
export function columnOccupancy(
	regions: readonly ReservedRegion[],
	column: SideColumn,
	page: { width: number; height: number },
	columnWidth: number
): ColumnOccupancy {
	const none: ColumnOccupancy = { top: null, bottom: null, shift: null };
	if (!column || columnWidth <= 0) return none;
	let top: number | null = null;
	let bottom: number | null = null;
	// The narrowest region is the camera; iOS centres the island and the clock on it.
	let narrowest: ReservedRegion | null = null;
	for (const region of regions) {
		if (!region.active || region.height <= 0) continue;
		const reaches =
			column === 'right'
				? region.x + region.width > page.width - columnWidth
				: region.x < columnWidth;
		if (!reaches) continue;
		const middle = region.y + region.height / 2;
		if (middle < page.height / 2) top = Math.max(top ?? 0, region.y + region.height);
		else bottom = Math.max(bottom ?? 0, page.height - region.y);
		if (region.width < columnWidth && (!narrowest || region.width < narrowest.width))
			narrowest = region;
	}
	const columnMiddle = column === 'right' ? page.width - columnWidth / 2 : columnWidth / 2;
	const shift = narrowest ? narrowest.x + narrowest.width / 2 - columnMiddle : null;
	return { top, bottom, shift };
}

/**
 * Keep `--app-rail-top`, `--app-rail-bottom` and `--app-rail-shift` at what iOS
 * reports: the stack then keeps clear of the island and the status cluster as
 * they are now, a Live Activity included, centres on the camera as they do, and
 * follows a fold or a turn. A band iOS leaves free is free down to a margin.
 * Until the shell has answered, as on the web or an iOS before 27.1, the
 * stylesheet's own values stay.
 */
export function attachReservedRegions(): () => void {
	const root = document.documentElement;
	let regions: ReservedRegion[] = [];
	let reported = false;
	const clear = () => {
		root.style.removeProperty('--app-rail-top');
		root.style.removeProperty('--app-rail-bottom');
		root.style.removeProperty('--app-rail-shift');
	};
	const apply = () => {
		if (!reported) return;
		const side = sideColumn.side;
		if (!side) {
			clear();
			return;
		}
		const inset =
			Number.parseFloat(getComputedStyle(root).getPropertyValue(`--app-inset-${side}`)) || 0;
		const { top, bottom, shift } = columnOccupancy(
			regions,
			side,
			{ width: window.innerWidth, height: window.innerHeight },
			inset
		);
		root.style.setProperty('--app-rail-top', `${Math.ceil(top ?? 0) + GAP_PX}px`);
		root.style.setProperty('--app-rail-bottom', `${Math.ceil(bottom ?? 0) + GAP_PX}px`);
		if (shift === null) root.style.removeProperty('--app-rail-shift');
		else root.style.setProperty('--app-rail-shift', `${Math.round(shift)}px`);
	};
	void ReservedRegions.get()
		.then((result) => {
			regions = result.regions;
			reported = true;
			apply();
		})
		.catch(() => undefined);
	const listening = ReservedRegions.addListener('reservedRegions', (data) => {
		regions = data.regions;
		reported = true;
		apply();
	}).catch(() => null);
	// The column can change sides or go without new regions; the insets arrive by resize.
	window.addEventListener('resize', apply);
	return () => {
		window.removeEventListener('resize', apply);
		void listening.then((handle) => handle?.remove());
		clear();
	};
}
