#!/usr/bin/env node
// Draw every app icon, the iOS launch image and the link preview from the SVG
// masters in design/app-icon. Run it after editing a master (in Affinity or by
// hand): `npm run icons`. It renders in Playwright's Chromium, so install that
// once with `npx playwright install chromium`.
//
// The masters are named <mode>-<shape>-<palette>.svg. Two of them are the
// defaults: the dark tilted notes in cream and amber, used everywhere on the
// web and for iOS dark mode, and the light tilted notes in peach and coral,
// used for iOS light mode. Every master is also an iOS alternate icon, named
// AppIcon-<master>, which the App target lists in
// ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES; this script stops if that list
// and the masters disagree.

import { chromium } from '@playwright/test';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { crc32, deflateSync } from 'node:zlib';

const SOURCE = 'design/app-icon';
const CATALOG = 'ios/App/App/Assets.xcassets';
const PROJECT = 'ios/App/App.xcodeproj/project.pbxproj';
const DARK = 'dark-tilted-amber';
const LIGHT = 'light-tilted-peach';
const TINTED = 'tinted-tilted';
const DEV_BAND = 'dev-band';
// The web icons get the corner Apple's home screen uses, so a tab, a bookmark
// and an installed web app show the same rounded tile.
const CORNER = 0.2237;

const svg = (name) => readFile(`${SOURCE}/${name}.svg`, 'utf8');
const masters = (await readdir(SOURCE))
	.filter((file) => /^(dark|light)-/.test(file))
	.map((file) => file.replace(/\.svg$/, ''))
	.sort();

await checkAlternateNames(masters.map((name) => `AppIcon-${name}`));

const browser = await chromium.launch();
const page = await browser.newPage();

// Draws SVG layers onto a square canvas in the page and returns its pixels,
// so the PNG can be written with or without an alpha channel.
async function render(layers, size, { corner = 0, canvas = size } = {}) {
	const base64 = await page.evaluate(
		async ({ layers, size, corner, canvas }) => {
			const surface = new OffscreenCanvas(canvas, canvas);
			const context = surface.getContext('2d');
			const offset = (canvas - size) / 2;
			if (corner) {
				context.beginPath();
				context.roundRect(offset, offset, size, size, size * corner);
				context.clip();
			}
			for (const layer of layers) {
				const image = new Image();
				image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(layer)}`;
				await image.decode();
				context.drawImage(image, offset, offset, size, size);
			}
			const bytes = context.getImageData(0, 0, canvas, canvas).data;
			let binary = '';
			for (let i = 0; i < bytes.length; i += 0x8000) {
				binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
			}
			return btoa(binary);
		},
		{ layers, size, corner, canvas }
	);
	return { size: canvas, rgba: Buffer.from(base64, 'base64') };
}

// Apple rejects an app icon with an alpha channel, so opaque images are
// written as RGB; the rest keep their transparent corners.
function png({ size, rgba }, { alpha }) {
	const channels = alpha ? 4 : 3;
	const stride = size * channels + 1;
	const raw = Buffer.alloc(stride * size);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const from = (y * size + x) * 4;
			const to = y * stride + 1 + x * channels;
			rgba.copy(raw, to, from, from + channels);
		}
	}
	const chunk = (type, data) => {
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([length, body, crc]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header[8] = 8;
	header[9] = alpha ? 6 : 2;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

async function write(path, layers, size, { alpha = false, corner = 0, canvas } = {}) {
	await writeFile(path, png(await render(layers, size, { corner, canvas }), { alpha }));
}

const iconImage = (filename, appearance) => ({
	...(appearance && { appearances: [{ appearance: 'luminosity', value: appearance }] }),
	filename,
	idiom: 'universal',
	platform: 'ios',
	size: '1024x1024'
});

async function iconSet(name, images) {
	const dir = `${CATALOG}/${name}.appiconset`;
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	for (const { filename, layers } of images) await write(`${dir}/${filename}`, layers, 1024);
	const contents = {
		images: images.map(({ filename, appearance }) => iconImage(filename, appearance))
	};
	await writeFile(
		`${dir}/Contents.json`,
		`${JSON.stringify({ ...contents, info: { author: 'xcode', version: 1 } }, null, 2)}\n`
	);
}

async function checkAlternateNames(names) {
	const project = await readFile(PROJECT, 'utf8');
	const lists = [
		...project.matchAll(/ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "([^"]*)";/g)
	];
	const expected = names.join(' ');
	if (lists.length !== 2 || lists.some(([, list]) => list !== expected)) {
		throw new Error(
			`${PROJECT}: set ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "${expected}"; in the App target's Debug and Release`
		);
	}
}

const dark = await svg(DARK);
const light = await svg(LIGHT);
const band = await svg(DEV_BAND);

// Web: the dark default everywhere.
await write('static/favicon-32x32.png', [dark], 32, { alpha: true, corner: CORNER });
await write('static/favicon.png', [dark], 64, { alpha: true, corner: CORNER });
await write('static/icon-192.png', [dark], 192, { alpha: true, corner: CORNER });
await write('static/icon-512.png', [dark], 512, { alpha: true, corner: CORNER });
await write('static/icon-maskable-512.png', [dark], 512);
await write('static/apple-touch-icon.png', [dark], 180);

// iOS: light and dark defaults plus the greyscale tinted variant, the dev
// app's pair with its DEV band, and every master as an alternate icon.
await iconSet('AppIcon', [
	{ filename: 'AppIcon-1024.png', layers: [light] },
	{ filename: 'AppIcon-Dark-1024.png', layers: [dark], appearance: 'dark' },
	{ filename: 'AppIcon-Tinted-1024.png', layers: [await svg(TINTED)], appearance: 'tinted' }
]);
await iconSet('AppIcon-Dev', [
	{ filename: 'AppIcon-Dev-1024.png', layers: [light, band] },
	{ filename: 'AppIcon-Dev-Dark-1024.png', layers: [dark, band], appearance: 'dark' }
]);
for (const entry of await readdir(CATALOG)) {
	if (/^AppIcon-(dark|light)-.*\.appiconset$/.test(entry))
		await rm(`${CATALOG}/${entry}`, { recursive: true });
}
for (const name of masters) {
	await iconSet(`AppIcon-${name}`, [
		{ filename: `AppIcon-${name}-1024.png`, layers: [await svg(name)] }
	]);
}

// iOS launch image: the icon in the middle of a clear 2732 square, light or
// dark to match the launch background.
const splash = `${CATALOG}/Splash.imageset`;
await write(`${splash}/splash-2732x2732.png`, [light], 520, {
	alpha: true,
	corner: CORNER,
	canvas: 2732
});
await write(`${splash}/splash-dark-2732x2732.png`, [dark], 520, {
	alpha: true,
	corner: CORNER,
	canvas: 2732
});
const splashImage = (filename, appearance) => ({
	...(appearance && { appearances: [{ appearance: 'luminosity', value: appearance }] }),
	filename,
	idiom: 'universal'
});
await writeFile(
	`${splash}/Contents.json`,
	`${JSON.stringify(
		{
			images: [
				splashImage('splash-2732x2732.png'),
				splashImage('splash-dark-2732x2732.png', 'dark')
			],
			info: { author: 'xcode', version: 1 }
		},
		null,
		2
	)}\n`
);

// Link preview: the icon over the name and tagline on the app's background.
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:#1a1a1a;
	display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,system-ui,sans-serif">
	<div style="width:240px;height:240px;border-radius:${CORNER * 240}px;overflow:hidden;box-shadow:0 0 0 2px #2a2a2a">
	${dark.replace('width="1024" height="1024"', 'width="240" height="240"')}</div>
	<div style="margin-top:40px;color:#e8eaed;font-size:68px;font-weight:800;letter-spacing:-1px">Scraps Cache</div>
	<div style="margin-top:14px;color:#9aa0a6;font-size:28px">Private, offline-first notes with encrypted sync</div>
	</body></html>`);
await page.screenshot({ path: 'static/og-preview.png' });

await browser.close();
console.log(
	`Drew ${masters.length} alternate icons, the defaults, the dev icons, the launch image and the link preview.`
);
