import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	AUTOMATIC,
	COLOURS,
	NOTES,
	OWN_ICON,
	alternateName,
	choiceFromAlternate,
	coloursFor,
	describeChoice,
	masterName,
	withTile,
	type AppIconChoice
} from './appIcon.js';
import { iconArt } from '#lib/appIconArt.js';

const masters = readdirSync('design/app-icon')
	.filter((file) => /^(dark|light)-/.test(file))
	.map((file) => file.replace(/\.svg$/, ''))
	.sort();

/** Every icon the page can choose, Automatic aside. */
const choices: AppIconChoice[] = (['dark', 'light'] as const).flatMap((tile) =>
	NOTES.flatMap(({ value: notes }) =>
		coloursFor(tile).map(({ value: colour }) => ({ tile, notes, colour }))
	)
);

/** The alternate icons: every choice but the app's own, and Automatic. */
const alternates = [AUTOMATIC, ...choices]
	.map((choice) => alternateName(choice))
	.filter((name) => name !== null)
	.sort();

describe('app icon choices', () => {
	it('are the masters drawn in design/app-icon, one for one', () => {
		expect(choices.map((choice) => masterName(choice)).sort()).toEqual(masters);
		for (const master of masters) expect(iconArt(master)).toBeTruthy();
	});

	it('are the alternate icons the App target lists for iOS, named after each app’s own', () => {
		const project = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
		const lists = [
			...project.matchAll(/ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "([^"]*)";/g)
		];
		expect(lists).toHaveLength(2);
		expect(alternates).toHaveLength(choices.length);
		const names = alternates.map((name) => `$(APP_ICON_NAME)-${name}`);
		for (const [, list] of lists) expect(list.split(' ')).toEqual(names);
	});

	it('have an icon set for the app and a banded one for the dev app, and no others', () => {
		const dev = readFileSync('ios/App/Dev.xcconfig', 'utf8');
		expect(dev).toMatch(/^APP_ICON_NAME = AppIcon-Dev$/m);
		const sets = readdirSync('ios/App/App/Assets.xcassets')
			.filter((entry) => entry.endsWith('.appiconset'))
			.map((entry) => entry.replace(/\.appiconset$/, ''))
			.sort();
		const expected = ['AppIcon', 'AppIcon-Dev'].flatMap((app) => [
			app,
			...alternates.map((name) => `${app}-${name}`)
		]);
		expect(sets).toEqual(expected.sort());
		for (const set of sets) {
			expect(existsSync(`ios/App/App/Assets.xcassets/${set}.appiconset/Contents.json`), set).toBe(
				true
			);
		}
	});

	it('make the dark amber icon the app’s own, in light and dark mode, as the App Store shows it', () => {
		const images = (set: string) =>
			(
				JSON.parse(
					readFileSync(`ios/App/App/Assets.xcassets/${set}.appiconset/Contents.json`, 'utf8')
				) as { images: { filename: string; appearances?: { value: string }[] }[] }
			).images;
		const bytes = (set: string, appearance?: string) => {
			const image = images(set).find((entry) => entry.appearances?.[0]?.value === appearance);
			return readFileSync(`ios/App/App/Assets.xcassets/${set}.appiconset/${image?.filename}`);
		};
		expect(alternateName(OWN_ICON)).toBeNull();
		expect(masterName(OWN_ICON)).toBe('dark-tilted-amber');
		for (const app of ['AppIcon', 'AppIcon-Dev']) {
			expect(bytes(app).equals(bytes(app, 'dark')), app).toBe(true);
			// Automatic is the pair: its own light icon, and the default in dark mode.
			expect(bytes(`${app}-automatic`, 'dark').equals(bytes(app)), app).toBe(true);
			expect(bytes(`${app}-automatic`).equals(bytes(app)), app).toBe(false);
		}
		for (const app of ['AppIcon', 'AppIcon-Dev']) {
			expect(bytes(`${app}-automatic`).equals(bytes(`${app}-light-tilted-peach`)), app).toBe(true);
		}
	});

	it('read back from the alternate iOS reports', () => {
		for (const choice of [AUTOMATIC, ...choices]) {
			expect(choiceFromAlternate(alternateName(choice))).toEqual(choice);
		}
		expect(masterName(AUTOMATIC)).toBeNull();
		expect(alternateName(AUTOMATIC)).toBe('automatic');
		expect(choiceFromAlternate(null)).toEqual(OWN_ICON);
		expect(choiceFromAlternate(undefined)).toEqual(OWN_ICON);
		// One this version does not draw is the app's own icon, as iOS shows it.
		expect(choiceFromAlternate('light-tilted-amber')).toEqual(OWN_ICON);
		expect(choiceFromAlternate('dark-folded-sky')).toEqual(OWN_ICON);
		// An earlier build's alternate for the icon that is now the app's own.
		expect(choiceFromAlternate('dark-tilted-amber')).toEqual(OWN_ICON);
	});

	it('show swatches in the colours of the masters', () => {
		const fill = (svg: string, id: string) =>
			new RegExp(`id="${id}"[^>]*fill="(#[0-9a-f]{6})"`).exec(svg)?.[1];
		for (const colour of COLOURS) {
			const svg = readFileSync(`design/app-icon/dark-tilted-${colour.value}.svg`, 'utf8');
			expect({ front: fill(svg, 'paper'), back: fill(svg, 'back-note') }).toEqual({
				front: colour.front,
				back: colour.back
			});
		}
	});

	it('leave Automatic for the tile default, and keep the notes and colour between tiles', () => {
		expect(withTile(AUTOMATIC, 'dark')).toEqual({ tile: 'dark', notes: 'tilted', colour: 'amber' });
		expect(withTile(AUTOMATIC, 'light')).toEqual({
			tile: 'light',
			notes: 'tilted',
			colour: 'peach'
		});
		const mint: AppIconChoice = { tile: 'dark', notes: 'stacked', colour: 'mint' };
		expect(withTile(mint, 'light')).toEqual({ ...mint, tile: 'light' });
		expect(withTile(mint, 'automatic')).toEqual(AUTOMATIC);
	});

	it('trade amber for peach on a light tile, which has no amber', () => {
		expect(coloursFor('light').map((colour) => colour.value)).not.toContain('amber');
		expect(withTile({ tile: 'dark', notes: 'stacked', colour: 'amber' }, 'light')).toEqual({
			tile: 'light',
			notes: 'stacked',
			colour: 'peach'
		});
	});

	it('are described by colour, notes and tile', () => {
		expect(describeChoice(AUTOMATIC)).toBe('Automatic');
		expect(describeChoice({ tile: 'dark', notes: 'stacked', colour: 'mint' })).toBe(
			'Mint · Stacked · Dark'
		);
	});
});
