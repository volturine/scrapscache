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

/** What iOS draws in a side column: how far down from the top, and how far up from the bottom. */
export type ColumnOccupancy = { top: number | null; bottom: number | null };

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
	const none: ColumnOccupancy = { top: null, bottom: null };
	if (!column || columnWidth <= 0) return none;
	let top: number | null = null;
	let bottom: number | null = null;
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
	}
	return { top, bottom };
}

/**
 * Keep `--app-rail-top` and `--app-rail-bottom` at what iOS reports: the rail
 * then keeps clear of the island and the status cluster as they are now, a Live
 * Activity included, and follows a fold or a turn. A band iOS leaves free is
 * free down to a margin. Until the shell has answered, as on the web or an iOS
 * before 27.1, the stylesheet's own values stay.
 */
export function attachReservedRegions(): () => void {
	const root = document.documentElement;
	let regions: ReservedRegion[] = [];
	let reported = false;
	const clear = () => {
		root.style.removeProperty('--app-rail-top');
		root.style.removeProperty('--app-rail-bottom');
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
		const { top, bottom } = columnOccupancy(
			regions,
			side,
			{ width: window.innerWidth, height: window.innerHeight },
			inset
		);
		root.style.setProperty('--app-rail-top', `${Math.ceil(top ?? 0) + GAP_PX}px`);
		root.style.setProperty('--app-rail-bottom', `${Math.ceil(bottom ?? 0) + GAP_PX}px`);
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
