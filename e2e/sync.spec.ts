import { expect, test, type Page } from '@playwright/test';
import { createNote, editor, noteCard, noteCardOpen, openEmptyApp, quickAction } from './app';

async function openSync(page: Page) {
	await page.getByRole('button', { name: /^Sync settings/ }).click();
	return page.getByRole('dialog');
}

// A deployed relay gates registration behind Turnstile, which no test can pass.
test.skip(
	Boolean(process.env.PLAYWRIGHT_BASE_URL && process.env.PLAYWRIGHT_LOCAL_RELAY !== '1'),
	'registration needs Turnstile on a deployment'
);

async function openNote(page: Page, title: string) {
	const openButton = noteCardOpen(page, title);
	await expect(openButton).toBeVisible();
	await openButton.focus();
	await page.keyboard.press('Enter');
	const noteEditor = editor(page);
	await expect(noteEditor).toBeVisible();
	const showPreviews = noteEditor.getByRole('button', { name: 'Show previews' });
	if (await showPreviews.count()) await showPreviews.click();
	return noteEditor;
}

async function attachPhoto(page: Page, noteEditor: ReturnType<typeof editor>, buffer: Buffer) {
	const chooser = page.waitForEvent('filechooser');
	await noteEditor.getByRole('button', { name: 'Attach', exact: true }).click();
	const picker = await chooser;
	expect(picker.isMultiple()).toBe(true);
	await picker.setFiles([{ name: 'sync-photo.png', mimeType: 'image/png', buffer }]);
	const quality = page
		.locator('[data-scope="dialog"][data-part="content"]')
		.filter({ hasText: 'Photo quality' });
	await expect(quality).toBeVisible();
	await quality.getByRole('button', { name: /^HD/ }).click();
	await expect(
		noteEditor.getByLabel('Photos').getByRole('button', { name: /^Open sync-photo\./ })
	).toBeVisible();
}

async function closeNote(noteEditor: ReturnType<typeof editor>) {
	await noteEditor.getByRole('button', { name: 'Close note' }).click();
	await expect(noteEditor).toBeHidden();
}

async function createSyntheticPhoto(page: Page): Promise<Buffer> {
	const base64 = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 256;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('2D canvas is unavailable');
		context.fillStyle = '#e11d48';
		context.fillRect(0, 0, 256, 256);
		context.fillStyle = '#2563eb';
		context.fillRect(256, 0, 256, 256);
		context.fillStyle = '#ffffff';
		context.fillRect(200, 80, 112, 96);
		return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
	});
	return Buffer.from(base64, 'base64');
}

async function syncNow(page: Page) {
	const dialog = await openSync(page);
	const sync = dialog.getByRole('button', { name: 'Sync now' });
	await sync.click();
	await expect(sync).toBeEnabled({ timeout: 30_000 });
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Close' }).click();
}

async function openFullPhoto(page: Page, noteEditor: ReturnType<typeof editor>) {
	await noteEditor
		.getByLabel('Photos')
		.getByRole('button', { name: /^Open sync-photo\./ })
		.click();
	const viewer = page.getByRole('dialog', { name: 'Photo' });
	await expect(viewer).toBeVisible();
	const image = viewer.locator('img').first();
	await expect(image).toBeVisible();
	return { viewer, image };
}

async function imageDetails(image: ReturnType<Page['locator']>) {
	return image.evaluate((element) => {
		const img = element as HTMLImageElement;
		return {
			source: img.getAttribute('src'),
			width: img.naturalWidth,
			height: img.naturalHeight
		};
	});
}

function bytesFromDataUrl(dataUrl: string | null): Buffer {
	expect(dataUrl).toMatch(/^data:image\/[^;,]+;base64,/);
	return Buffer.from(dataUrl!.slice(dataUrl!.indexOf(',') + 1), 'base64');
}

test('two devices pair with a code and converge, deletes included', async ({ browser }) => {
	const contextA = await browser.newContext();
	const contextB = await browser.newContext();
	const a = await contextA.newPage();
	const b = await contextB.newPage();

	await openEmptyApp(a);
	await createNote(a, 'Shared plan', 'Written on the first device.');

	// Device A turns its workspace into a synced one.
	let dialog = await openSync(a);
	await dialog.getByRole('button', { name: /^Expand / }).click();
	await dialog.getByRole('button', { name: /^Sync this workspace/ }).click();
	await dialog.getByRole('button', { name: 'Start sync' }).click();
	await expect(dialog.getByRole('button', { name: / is active$/ })).toContainText('Synced');

	// Device A shows a one-time pairing code.
	const connect = dialog.getByRole('button', { name: 'Connect another device' });
	await expect(connect).toHaveText('Connect another device');
	await connect.click();
	const codeBox = dialog.locator('[aria-label="One-time pairing code"]');
	await expect(codeBox).toBeVisible();
	const code = (await codeBox.innerText()).replace(/[^A-Za-z0-9]/g, '');
	expect(code).toHaveLength(16);

	// Device B joins with the code and receives the key and the notes.
	await openEmptyApp(b);
	const dialogB = await openSync(b);
	await dialogB.getByRole('button', { name: '+ New workspace' }).click();
	await dialogB.getByRole('button', { name: /^Join a synced workspace/ }).click();
	await dialogB.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(code);
	await dialogB.getByRole('button', { name: 'Start connection' }).click();
	await expect(dialogB.getByText('Paired and synced.')).toBeVisible({ timeout: 30_000 });
	await expect(dialog.getByText('Key sent. This device can go offline.')).toBeVisible();
	await dialog.getByRole('button', { name: 'Close' }).click();
	await dialogB.getByRole('button', { name: 'Close' }).click();
	await expect(noteCard(b, 'Shared plan')).toBeVisible();

	// An edit on B reaches A.
	await createNote(b, 'Second device note');
	dialog = await openSync(a);
	await dialog.getByRole('button', { name: 'Sync now' }).click();
	await dialog.getByRole('button', { name: 'Close' }).click();
	await expect(noteCard(a, 'Second device note')).toBeVisible({ timeout: 30_000 });

	// A delete on A tombstones the note on B.
	await quickAction(noteCard(a, 'Shared plan'), 'Move to trash');
	await expect(noteCard(a, 'Shared plan')).toBeHidden();
	dialog = await openSync(b);
	await dialog.getByRole('button', { name: 'Sync now' }).click();
	await dialog.getByRole('button', { name: 'Close' }).click();
	await expect(noteCard(b, 'Shared plan')).toBeHidden({ timeout: 30_000 });
	await b.goto('/trash');
	await expect(noteCard(b, 'Shared plan')).toBeVisible();

	await contextA.close();
	await contextB.close();
});

test('photo bytes, crops, deletion, and undo sync between two devices', async ({ browser }) => {
	test.setTimeout(8 * 60_000);
	const contextA = await browser.newContext();
	const contextB = await browser.newContext();
	const a = await contextA.newPage();
	const b = await contextB.newPage();
	await b.setViewportSize({ width: 390, height: 844 });

	await openEmptyApp(a);
	const png = await createSyntheticPhoto(a);
	await createNote(a, 'Photo sync', 'An image travels with this note.');
	let noteEditorA = await openNote(a, 'Photo sync');
	await attachPhoto(a, noteEditorA, png);
	let { viewer: viewerA, image: imageA } = await openFullPhoto(a, noteEditorA);
	await expect
		.poll(async () => {
			const image = await imageDetails(imageA);
			return [image.width, image.height];
		})
		.toEqual([512, 256]);
	const original = await imageDetails(imageA);
	const originalBytes = bytesFromDataUrl(original.source);
	expect(originalBytes.length).toBeGreaterThan(0);
	await viewerA.locator('header').getByRole('button', { name: 'Close photo' }).click();
	await closeNote(noteEditorA);

	// Device A creates a synced workspace, then pairs device B with a one-time code.
	let dialog = await openSync(a);
	await dialog.getByRole('button', { name: /^Expand / }).click();
	await dialog.getByRole('button', { name: /^Sync this workspace/ }).click();
	await dialog.getByRole('button', { name: 'Start sync' }).click();
	await expect(dialog.getByRole('button', { name: / is active$/ })).toContainText('Synced');
	const connect = dialog.getByRole('button', { name: 'Connect another device' });
	await connect.click();
	const codeBox = dialog.locator('[aria-label="One-time pairing code"]');
	await expect(codeBox).toBeVisible();
	const code = (await codeBox.innerText()).replace(/[^A-Za-z0-9]/g, '');
	expect(code).toHaveLength(16);

	await openEmptyApp(b);
	const dialogB = await openSync(b);
	await dialogB.getByRole('button', { name: '+ New workspace' }).click();
	await dialogB.getByRole('button', { name: /^Join a synced workspace/ }).click();
	await dialogB.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(code);
	await dialogB.getByRole('button', { name: 'Start connection' }).click();
	await expect(dialogB.getByText('Paired and synced.')).toBeVisible({ timeout: 30_000 });
	await expect(dialog.getByText('Key sent. This device can go offline.')).toBeVisible();
	await dialog.getByRole('button', { name: 'Close' }).click();
	await dialogB.getByRole('button', { name: 'Close' }).click();
	await expect(noteCard(b, 'Photo sync')).toBeVisible();

	// B receives the full attachment bytes, not just the card thumbnail.
	let noteEditorB = await openNote(b, 'Photo sync');
	let { viewer: viewerB, image: imageB } = await openFullPhoto(b, noteEditorB);
	await expect
		.poll(async () => {
			const image = await imageDetails(imageB);
			return [image.width, image.height];
		})
		.toEqual([512, 256]);
	expect(bytesFromDataUrl((await imageDetails(imageB)).source)).toEqual(originalBytes);

	// Crop on B, then verify both the exact cropped bytes and dimensions on A after reload.
	await viewerB.getByRole('button', { name: 'Crop photo' }).click();
	await expect(viewerB.getByRole('button', { name: 'Cancel crop' })).toBeVisible();
	await viewerB
		.locator('[aria-label="Aspect ratio presets mobile"]')
		.getByRole('button', { name: '1:1', exact: true })
		.click();
	await viewerB.getByRole('button', { name: 'Apply crop' }).click();
	await expect(viewerB.getByRole('button', { name: 'Crop photo' })).toBeVisible();
	await expect
		.poll(async () => {
			const image = await imageDetails(imageB);
			return image.width > 0 && image.width === image.height;
		})
		.toBe(true);
	const cropped = await imageDetails(imageB);
	expect(cropped.width).toBeLessThan(512);
	const croppedBytes = bytesFromDataUrl(cropped.source);
	await viewerB.locator('header').getByRole('button', { name: 'Close photo' }).click();
	await closeNote(noteEditorB);

	await syncNow(b);
	await syncNow(a);
	await a.reload();
	await expect(noteCard(a, 'Photo sync')).toBeVisible();
	noteEditorA = await openNote(a, 'Photo sync');
	({ viewer: viewerA, image: imageA } = await openFullPhoto(a, noteEditorA));
	await expect
		.poll(async () => {
			const image = await imageDetails(imageA);
			return image.width > 0 && image.width === image.height;
		})
		.toBe(true);
	const cropOnA = await imageDetails(imageA);
	expect([cropOnA.width, cropOnA.height]).toEqual([cropped.width, cropped.height]);
	expect(bytesFromDataUrl(cropOnA.source)).toEqual(croppedBytes);
	await viewerA.locator('header').getByRole('button', { name: 'Close photo' }).click();
	await closeNote(noteEditorA);

	// A photo deletion reaches A, and Undo on B restores it for the next sync.
	noteEditorB = await openNote(b, 'Photo sync');
	const photosB = noteEditorB.getByLabel('Photos');
	await photosB.getByRole('button', { name: 'Remove photo' }).click();
	await expect(photosB.getByRole('button', { name: /^Open sync-photo\./ })).toHaveCount(0);
	await closeNote(noteEditorB);
	await syncNow(b);
	await syncNow(a);
	await a.reload();
	noteEditorA = await openNote(a, 'Photo sync');
	await expect(noteEditorA.getByLabel('Photos').getByRole('button', { name: /^Open/ })).toHaveCount(
		0
	);
	await expect(noteEditorA.locator('[data-body-editor] .markdown-token-photo')).toHaveCount(0);
	await closeNote(noteEditorA);

	const undo = b.getByRole('button', { name: 'Undo' });
	await expect(undo).toBeVisible();
	await undo.click();
	await expect(noteCard(b, 'Photo sync').locator('img')).toHaveCount(1);
	await syncNow(b);
	await syncNow(a);
	await a.reload();
	noteEditorA = await openNote(a, 'Photo sync');
	({ viewer: viewerA, image: imageA } = await openFullPhoto(a, noteEditorA));
	await expect
		.poll(async () => {
			const image = await imageDetails(imageA);
			return image.width > 0 && image.width === image.height;
		})
		.toBe(true);
	const restored = await imageDetails(imageA);
	expect([restored.width, restored.height]).toEqual([cropped.width, cropped.height]);
	expect(bytesFromDataUrl(restored.source)).toEqual(croppedBytes);
	await viewerA.locator('header').getByRole('button', { name: 'Close photo' }).click();
	await closeNote(noteEditorA);

	await quickAction(noteCard(a, 'Photo sync'), 'Move to trash');
	await expect(noteCard(a, 'Photo sync')).toBeHidden();
	await syncNow(b);
	await expect(noteCard(b, 'Photo sync')).toBeHidden({ timeout: 30_000 });
	await b.goto('/trash');
	await expect(noteCard(b, 'Photo sync')).toBeVisible();

	await contextA.close();
	await contextB.close();
});

test('sync speaks up above the feed only when it needs attention', async ({ page, context }) => {
	await openEmptyApp(page);
	await createNote(page, 'Quiet note');
	const banner = page.locator('[data-sync-attention]');
	// A workspace that only lives on this device has nothing to say.
	await expect(banner).toHaveCount(0);

	let dialog = await openSync(page);
	await dialog.getByRole('button', { name: /^Expand / }).click();
	await dialog.getByRole('button', { name: /^Sync this workspace/ }).click();
	await dialog.getByRole('button', { name: 'Start sync' }).click();
	await expect(dialog.getByRole('button', { name: / is active$/ })).toContainText('Synced');
	await dialog.getByRole('button', { name: 'Close' }).click();
	// Synced and quiet: still nothing.
	await expect(banner).toHaveCount(0);

	// A sync that cannot reach the relay is worth a banner, with the next step on it.
	await context.setOffline(true);
	dialog = await openSync(page);
	await dialog.getByRole('button', { name: 'Sync now' }).click();
	await expect(dialog.getByText('Could not reach server. Check your connection.')).toBeVisible();
	await dialog.getByRole('button', { name: 'Close' }).click();
	await expect(banner).toHaveAttribute('data-sync-attention', 'error');
	await expect(banner).toContainText('Sync stopped: the server could not be reached.');
	await expect(banner).toContainText('Your notes are safe on this device.');

	// Retry once the connection is back clears it.
	await context.setOffline(false);
	await banner.getByRole('button', { name: 'Retry' }).click();
	await expect(banner).toHaveCount(0);
});
