import { registerPlugin } from '@capacitor/core';

/**
 * The iPhone app's icon, chosen in Settings > App icon. Automatic is the app's
 * own pair, which iOS switches with light and dark mode; any other choice is one
 * of the alternate icons drawn from the masters in design/app-icon, named
 * `<tile>-<notes>-<colour>` (scripts/app-icons.mjs). The shell turns a master
 * into the alternate of its own app, with the DEV band in the dev app.
 */
export type IconTile = 'automatic' | 'dark' | 'light';
export type IconNotes = 'tilted' | 'stacked';
export type IconColour = 'amber' | 'sky' | 'mint' | 'pink' | 'peach';

export type AppIconChoice = { tile: IconTile; notes: IconNotes; colour: IconColour };

export const AUTOMATIC: AppIconChoice = { tile: 'automatic', notes: 'tilted', colour: 'amber' };

export const TILES: { value: IconTile; label: string }[] = [
	{ value: 'automatic', label: 'Automatic' },
	{ value: 'dark', label: 'Dark' },
	{ value: 'light', label: 'Light' }
];

export const NOTES: { value: IconNotes; label: string }[] = [
	{ value: 'tilted', label: 'Tilted' },
	{ value: 'stacked', label: 'Stacked' }
];

/**
 * Each colour is a front note over a back note. These are the masters' paper
 * and back-note fills, drawn as the colour's swatch (appIcon.test.ts holds them
 * to the masters). Amber is cream over amber and comes on dark tiles only.
 */
export const COLOURS: { value: IconColour; label: string; front: string; back: string }[] = [
	{ value: 'amber', label: 'Amber', front: '#f4efe6', back: '#f5c95b' },
	{ value: 'sky', label: 'Sky', front: '#9ed7f3', back: '#899de6' },
	{ value: 'mint', label: 'Mint', front: '#a6dcbe', back: '#31b5c2' },
	{ value: 'pink', label: 'Pink', front: '#f4bbd0', back: '#b190d9' },
	{ value: 'peach', label: 'Peach', front: '#f1c4a0', back: '#de867b' }
];

/** The colours a tile comes in. */
export function coloursFor(tile: IconTile): typeof COLOURS {
	return tile === 'light' ? COLOURS.filter((colour) => colour.value !== 'amber') : COLOURS;
}

/** The icon Automatic shows for a tile: tilted notes, amber on dark and peach on light. */
const DEFAULT_COLOUR: Record<Exclude<IconTile, 'automatic'>, IconColour> = {
	dark: 'amber',
	light: 'peach'
};

/**
 * The choice after picking a tile. Leaving Automatic starts from that tile's
 * default icon; otherwise the notes and colour stay, except that light tiles
 * have no amber, which becomes peach.
 */
export function withTile(choice: AppIconChoice, tile: IconTile): AppIconChoice {
	if (tile === 'automatic') return AUTOMATIC;
	if (choice.tile === 'automatic') return { tile, notes: 'tilted', colour: DEFAULT_COLOUR[tile] };
	const available = coloursFor(tile).some((colour) => colour.value === choice.colour);
	return { ...choice, tile, colour: available ? choice.colour : DEFAULT_COLOUR[tile] };
}

/** The master a choice is drawn from, or null for Automatic. */
export function masterName(choice: AppIconChoice): string | null {
	return choice.tile === 'automatic' ? null : `${choice.tile}-${choice.notes}-${choice.colour}`;
}

/**
 * The choice a master stands for. No master is the app's own icon, and so is
 * one this version does not draw, which iOS falls back to.
 */
export function choiceFromMaster(master: string | null | undefined): AppIconChoice {
	const match = /^(dark|light)-(tilted|stacked)-(\w+)$/.exec(master ?? '');
	if (!match) return AUTOMATIC;
	const tile = match[1] as 'dark' | 'light';
	const notes = match[2] as IconNotes;
	const colour = coloursFor(tile).find((entry) => entry.value === match[3]);
	return colour ? { tile, notes, colour: colour.value } : AUTOMATIC;
}

/** "Automatic", or the colour, notes and tile: "Mint · Stacked · Dark". */
export function describeChoice(choice: AppIconChoice): string {
	if (choice.tile === 'automatic') return 'Automatic';
	const label = <T extends string>(list: { value: T; label: string }[], value: T) =>
		list.find((entry) => entry.value === value)?.label ?? value;
	return [
		label(COLOURS, choice.colour),
		label(NOTES, choice.notes),
		label(TILES, choice.tile)
	].join(' · ');
}

type AppIconPlugin = {
	/** `master` is the alternate icon showing; none for the app's own. */
	get(): Promise<{ supported: boolean; master?: string }>;
	/** Null puts the app's own icon back. iOS confirms the change with an alert of its own. */
	set(options: { master: string | null }): Promise<void>;
};

/** The app shell's plugin (ScrapsBridgeViewController.swift); absent on a web build. */
export const AppIcon = registerPlugin<AppIconPlugin>('AppIcon');
