import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	AUTOMATIC,
	COLOURS,
	NOTES,
	choiceFromMaster,
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
		const names = choices.map((choice) => `$(APP_ICON_NAME)-${masterName(choice)}`).sort();
		for (const [, list] of lists) expect(list.split(' ')).toEqual(names);
	});

	it('have an icon set for the app and a banded one for the dev app', () => {
		const dev = readFileSync('ios/App/Dev.xcconfig', 'utf8');
		expect(dev).toMatch(/^APP_ICON_NAME = AppIcon-Dev$/m);
		for (const choice of choices) {
			for (const app of ['AppIcon', 'AppIcon-Dev']) {
				const set = `ios/App/App/Assets.xcassets/${app}-${masterName(choice)}.appiconset`;
				expect(existsSync(`${set}/Contents.json`), set).toBe(true);
			}
		}
	});

	it('read back from the master iOS reports', () => {
		for (const choice of choices) {
			expect(choiceFromMaster(masterName(choice))).toEqual(choice);
		}
		expect(masterName(AUTOMATIC)).toBeNull();
		expect(choiceFromMaster(null)).toEqual(AUTOMATIC);
		expect(choiceFromMaster(undefined)).toEqual(AUTOMATIC);
		// One this version does not draw is the app's own icon, as iOS shows it.
		expect(choiceFromMaster('light-tilted-amber')).toEqual(AUTOMATIC);
		expect(choiceFromMaster('dark-folded-sky')).toEqual(AUTOMATIC);
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
