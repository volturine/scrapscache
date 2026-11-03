import { expect, test, type Locator, type Page } from '@playwright/test';
import { createNote, editor, noteCardOpen, openEmptyApp } from './app';

// A 1×1 PNG; the optimizer re-encodes it, so the name ends up .webp in Chromium.
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
);
const SECOND_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=',
	'base64'
);

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function pickFromComposer(
	page: Page,
	files: { name: string; mimeType: string; buffer: Buffer }[]
) {
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'New photo note' }).click();
	const picker = await chooser;
	expect(picker.isMultiple()).toBe(true);
	await picker.setFiles(files);
}

async function pickIntoEditor(
	page: Page,
	files: { name: string; mimeType: string; buffer: Buffer }[]
) {
	const chooser = page.waitForEvent('filechooser');
	await editor(page).getByRole('button', { name: 'Attach', exact: true }).click();
	const picker = await chooser;
	expect(picker.isMultiple()).toBe(true);
	await picker.setFiles(files);
	await expect(photoQualityDialog(page)).toBeVisible();
	await page.getByRole('button', { name: /^Compressed/ }).click();
}

async function openCard(page: Page, title: string) {
	const openButton = noteCardOpen(page, title);
	await expect(openButton).toBeVisible();
	// Keyboard activation avoids the card's image/preview hit area while using
	// its real accessible open control.
	await openButton.focus();
	await page.keyboard.press('Enter');
	await expect(editor(page)).toBeVisible();
}

async function closeEditor(page: Page) {
	await editor(page).getByRole('button', { name: 'Close note' }).click();
	await expect(editor(page)).toBeHidden();
}

async function createPng(page: Page, leftColor: string, rightColor: string): Promise<Buffer> {
	const base64 = await page.evaluate(
		([left, right]) => {
			const canvas = document.createElement('canvas');
			canvas.width = 512;
			canvas.height = 256;
			const context = canvas.getContext('2d');
			if (!context) throw new Error('2D canvas is unavailable');
			context.fillStyle = left;
			context.fillRect(0, 0, 256, 256);
			context.fillStyle = right;
			context.fillRect(256, 0, 256, 256);
			context.fillStyle = '#ffffff';
			context.fillRect(200, 80, 112, 96);
			return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
		},
		[leftColor, rightColor]
	);
	return Buffer.from(base64, 'base64');
}

async function typeInTextRow(page: Page, text: string) {
	const body = page.locator('[data-body-editor]');
	const row = body.locator('[data-editor-line] [data-line-text]').last();
	const box = await row.boundingBox();
	expect(box).not.toBeNull();
	await row.click({ position: { x: Math.max(1, box!.width - 2), y: box!.height / 2 } });
	await expect(body).toBeFocused();
	if (text) await page.keyboard.type(text);
}

async function dispatchCopiedNotePaste(target: Locator) {
	await target.evaluate((element) => {
		const copied = (window as Window & { __capturedNoteClipboard?: Record<string, string> })
			.__capturedNoteClipboard;
		if (!copied?.['text/html']) throw new Error('No copied note HTML is available');
		const clipboardData = new DataTransfer();
		clipboardData.setData('text/html', copied['text/html']);
		clipboardData.setData('text/plain', copied['text/plain'] ?? '');
		const paste = new ClipboardEvent('paste', {
			bubbles: true,
			cancelable: true,
			clipboardData
		});
		element.dispatchEvent(paste);
		if (!paste.defaultPrevented) throw new Error('Copied note paste was not handled');
	});
}

function photoQualityDialog(page: Page) {
	return page
		.locator('[data-scope="dialog"][data-part="content"]')
		.filter({ hasText: 'Photo quality' });
}

async function typeInTrailingBlankRow(page: Page, value: string) {
	const body = page.locator('[data-body-editor]');
	const row = body.locator('[data-editor-line] [data-line-text]').last();
	await expect(row).toBeVisible();
	await expect
		.poll(() =>
			row.evaluate((element) => {
				const selection = window.getSelection();
				return (
					(element.textContent ?? '').replaceAll('\u200b', '') === '' &&
					document.activeElement === element.closest('[data-body-editor]') &&
					!!selection?.anchorNode &&
					element.contains(selection.anchorNode)
				);
			})
		)
		.toBe(true);
	// Adding photos leaves a real caret in the trailing blank row. Focusing the
	// contenteditable host and using Control+End can instead land on a photo chip.
	await page.keyboard.type(value);
}

async function installClipboardCapture(page: Page) {
	// The focused E2E server uses HTTP on a Tailscale address, which is not a
	// secure context for the browser clipboard API. Keep the app's ClipboardItem
	// construction and NoteClipboard helper in the path while capturing its data.
	await page.addInitScript(() => {
		type CapturedWindow = Window & { __capturedNoteClipboard?: Record<string, string> };
		class CapturedClipboardItem {
			constructor(private readonly representations: Record<string, Blob | Promise<Blob>>) {}
			get types() {
				return Object.keys(this.representations);
			}
			async getType(type: string): Promise<Blob> {
				const blob = await this.representations[type];
				if (!blob) throw new Error(`Clipboard representation missing: ${type}`);
				return blob;
			}
		}
		const capture = (representations: Record<string, string>) => {
			(window as CapturedWindow).__capturedNoteClipboard = representations;
		};
		Object.defineProperty(window, 'ClipboardItem', {
			configurable: true,
			value: CapturedClipboardItem
		});
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				async write(items: CapturedClipboardItem[]) {
					const item = items[0];
					const representations: Record<string, string> = {};
					for (const type of item.types) {
						const blob = await item.getType(type);
						representations[type] = type.startsWith('text/')
							? await blob.text()
							: `${blob.type}:${blob.size}`;
					}
					capture(representations);
				},
				async writeText(text: string) {
					capture({ 'text/plain': text });
				}
			}
		});
	});
}

test('a photo note: the photo stands in the body as a chip, and on the card', async ({ page }) => {
	await openEmptyApp(page);
	await pickFromComposer(page, [{ name: 'beach.png', mimeType: 'image/png', buffer: PNG }]);
	await expect(photoQualityDialog(page)).toBeVisible();
	await page.getByRole('button', { name: /^Compressed/ }).click();
	const photo = page.getByLabel('Photos').getByRole('button', { name: /^Open beach\./ });
	await expect(photo).toBeVisible();
	const chip = page.locator('[data-body-editor] .markdown-token-photo');
	await expect(chip).toHaveCount(1);
	await expect(chip).toHaveText(/^beach\./);
	const title = page.getByPlaceholder('Title', { exact: true });
	await expect(title).toBeVisible();
	await expect(title).toBeEditable();
	const titleBox = await title.boundingBox();
	const bodyBox = await page.locator('[data-body-editor]').boundingBox();
	const previewBox = await page.locator('[data-preview-panel]').boundingBox();
	expect(titleBox).not.toBeNull();
	expect(bodyBox).not.toBeNull();
	expect(previewBox).not.toBeNull();
	expect(previewBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height - 1);
	expect(previewBox!.y).toBeGreaterThanOrEqual(bodyBox!.y + bodyBox!.height - 1);

	await page.getByRole('button', { name: 'Done', exact: true }).click();
	const card = page.getByRole('article').filter({ has: page.locator('img') });
	await expect(card).toHaveCount(1);
	await expect(card.locator('.markdown-token-photo')).toHaveText(/^beach\./);
});

test('removing a photo takes its chip out of the body; Undo brings both back', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Beach day', 'Before the photo');
	await openCard(page, 'Beach day');
	await pickIntoEditor(page, [{ name: 'beach.png', mimeType: 'image/png', buffer: PNG }]);
	const strip = editor(page).getByLabel('Photos');
	await expect(strip.getByRole('button', { name: /^Open beach\./ })).toBeVisible();
	await typeInTrailingBlankRow(page, 'Sunscreen');
	await expect(editor(page).locator('[data-body-editor]')).toContainText('Sunscreen');
	await expect(editor(page).locator('[data-body-editor] .markdown-token-photo')).toHaveCount(1);
	await closeEditor(page);
	await openCard(page, 'Beach day');
	const reopenedEditor = editor(page);
	const reopenedStrip = reopenedEditor.getByLabel('Photos');
	const previews = page.getByRole('button', { name: 'Show previews' });
	if (await previews.count()) await previews.click();
	await expect(reopenedStrip.getByRole('button', { name: /^Open beach\./ })).toBeVisible();
	const chips = reopenedEditor.locator('[data-body-editor] .markdown-token-photo');
	await expect(chips).toHaveCount(1);

	await reopenedStrip.getByRole('button', { name: 'Remove photo' }).click();
	await expect(chips).toHaveCount(0);
	await expect(reopenedEditor.locator('[data-body-editor]')).toContainText('Before the photo');
	await expect(reopenedEditor.locator('[data-body-editor]')).toContainText('Sunscreen');
	await expect(reopenedStrip.getByRole('button', { name: /^Open beach\./ })).toHaveCount(0);

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(reopenedStrip.getByRole('button', { name: /^Open beach\./ })).toBeVisible();
	await expect(chips).toHaveCount(1);
	await expect(chips).not.toHaveClass(/markdown-token-photo-missing/);

	await closeEditor(page);
	await page.reload();
	const card = page.getByRole('article').filter({ hasText: 'Sunscreen' });
	await expect(card.locator('img')).toHaveCount(1);
	await expect(card.locator('.markdown-token-photo')).toHaveCount(1);
});

test('the viewer’s download saves the photo itself, as an image file', async ({ page }) => {
	await openEmptyApp(page);
	await pickFromComposer(page, [{ name: 'beach.png', mimeType: 'image/png', buffer: PNG }]);
	await page.getByRole('button', { name: /^Compressed/ }).click();
	await page
		.getByLabel('Photos')
		.getByRole('button', { name: /^Open beach\./ })
		.click();
	await expect(page.getByRole('dialog', { name: 'Photo' })).toBeVisible();
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download photo' }).click();
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/^beach\.(webp|png|jpe?g)$/);
	const path = await file.path();
	const { readFileSync } = await import('node:fs');
	const head = readFileSync(path!).subarray(0, 12).toString('latin1');
	// A WebP starts RIFF….WEBP, a PNG with its signature; a data URL written as text would start "data:".
	expect(head.startsWith('RIFF') || head.startsWith('\x89PNG') || head.startsWith('\xff\xd8')).toBe(
		true
	);
	expect(head.startsWith('data:')).toBe(false);
});

test('the multi-photo viewer navigates and crop cancel/apply preserve a usable image', async ({
	page
}) => {
	await openEmptyApp(page);
	const wide = await createPng(page, '#e11d48', '#2563eb');
	const other = await createPng(page, '#16a34a', '#f59e0b');
	await pickFromComposer(page, [
		{ name: 'wide.png', mimeType: 'image/png', buffer: wide },
		{ name: 'other.png', mimeType: 'image/png', buffer: other }
	]);
	await expect(photoQualityDialog(page)).toBeVisible();
	await page.getByRole('button', { name: /^Compressed/ }).click();

	const photos = page.getByLabel('Photos');
	await photos.getByRole('button', { name: /^Open wide\./ }).click();
	const viewer = page.getByRole('dialog', { name: 'Photo' });
	await expect(viewer.locator('header')).toContainText('wide.webp');
	await expect(viewer.locator('header')).toContainText('1 of 2');
	const firstImage = viewer.locator('img[alt^="wide"]');
	await expect(firstImage).toBeVisible();
	const initialSize = await firstImage.evaluate((image) => {
		const { naturalWidth, naturalHeight } = image as HTMLImageElement;
		return [naturalWidth, naturalHeight];
	});
	expect(initialSize[0]).toBeGreaterThan(0);
	expect(initialSize[0] / initialSize[1]).toBeGreaterThan(1.8);

	const thumbnails = viewer.getByLabel('Photo thumbnails');
	await thumbnails.getByRole('button', { name: 'other.webp' }).click();
	await expect(viewer.locator('header')).toContainText('other.webp');
	await expect(viewer.locator('header')).toContainText('2 of 2');
	await thumbnails.getByRole('button', { name: 'wide.webp' }).click();
	await expect(viewer.locator('header')).toContainText('wide.webp');

	const squarePreset = page
		.locator('[aria-label="Aspect ratio presets mobile"]')
		.getByRole('button', { name: '1:1', exact: true });
	await viewer.getByRole('button', { name: 'Crop photo' }).click();
	await expect(viewer.getByRole('button', { name: 'Cancel crop' })).toBeVisible();
	await squarePreset.click();
	await viewer.getByRole('button', { name: 'Cancel crop' }).click();
	await expect(viewer.getByRole('button', { name: 'Crop photo' })).toBeVisible();
	await expect
		.poll(() =>
			firstImage.evaluate((image) => {
				const { naturalWidth, naturalHeight } = image as HTMLImageElement;
				return [naturalWidth, naturalHeight];
			})
		)
		.toEqual(initialSize);

	await viewer.getByRole('button', { name: 'Crop photo' }).click();
	await squarePreset.click();
	await viewer.getByRole('button', { name: 'Apply crop' }).click();
	await expect(viewer.getByRole('button', { name: 'Crop photo' })).toBeVisible();
	await expect
		.poll(() =>
			firstImage.evaluate((image) => {
				const { naturalWidth, naturalHeight } = image as HTMLImageElement;
				return (
					naturalWidth > 0 && naturalHeight > 0 && Math.abs(naturalWidth / naturalHeight - 1) < 0.1
				);
			})
		)
		.toBe(true);
});

test('multiple photos deduplicate by image content and copy back as mixed note content', async ({
	page
}) => {
	await installClipboardCapture(page);
	await openEmptyApp(page);
	await createNote(page, 'Beach day', 'Before the photos');
	await openCard(page, 'Beach day');

	const chooser = page.waitForEvent('filechooser');
	await editor(page).getByRole('button', { name: 'Attach', exact: true }).click();
	const picker = await chooser;
	await picker.setFiles([
		{ name: 'lake.png', mimeType: 'image/png', buffer: PNG },
		{ name: 'lake-copy.png', mimeType: 'image/png', buffer: PNG },
		{ name: 'sunset.png', mimeType: 'image/png', buffer: SECOND_PNG }
	]);
	await expect(photoQualityDialog(page)).toBeVisible();
	await page.getByRole('button', { name: /^Compressed/ }).click();

	const photoStrip = editor(page).getByLabel('Photos');
	await expect(photoStrip.getByRole('button', { name: /^Open lake\./ })).toBeVisible();
	await expect(photoStrip.getByRole('button', { name: /^Open lake-copy\./ })).toHaveCount(0);
	await expect(photoStrip.getByRole('button', { name: /^Open sunset\./ })).toBeVisible();
	await expect(photoStrip.getByRole('button', { name: /^Open/ })).toHaveCount(2);
	await expect(editor(page).locator('[data-body-editor] .markdown-token-photo')).toHaveCount(2);
	await typeInTrailingBlankRow(page, 'After the photos');
	await expect(editor(page).locator('[data-body-editor]')).toContainText('Before the photos');
	await expect(editor(page).locator('[data-body-editor]')).toContainText('After the photos');
	await expect(editor(page).locator('[data-body-editor] .markdown-token-photo')).toHaveCount(2);
	const sourceIds = await editor(page)
		.locator('[data-body-editor] .markdown-token-photo')
		.evaluateAll((chips) => chips.map((chip) => chip.getAttribute('data-photo') ?? ''));
	expect(sourceIds).toHaveLength(2);

	await editor(page).getByRole('button', { name: 'Share' }).click();
	await page.getByRole('menuitem', { name: 'Copy note', exact: true }).click();
	const copiedHtml = () =>
		page.evaluate(
			() =>
				(window as Window & { __capturedNoteClipboard?: Record<string, string> })
					.__capturedNoteClipboard?.['text/html'] ?? ''
		);
	await expect.poll(copiedHtml).toContain('<img');
	const copied = await page.evaluate(
		() =>
			(window as Window & { __capturedNoteClipboard?: Record<string, string> })
				.__capturedNoteClipboard ?? {}
	);
	const html = copied['text/html'] ?? '';
	expect(copied['text/plain']).toContain('Before the photos');
	expect(copied['text/plain']).toContain('After the photos');
	expect(copied['image/png']).toMatch(/^image\/png:[1-9]\d*$/);
	expect(html.match(/<img\b/g) ?? []).toHaveLength(2);
	const htmlOrder = await page.evaluate((clipboardHtml) => {
		const parsed = new DOMParser().parseFromString(clipboardHtml, 'text/html');
		const wrapper = parsed.querySelector('[data-scrapscache-note]');
		return Array.from(wrapper?.children ?? []).map((child) =>
			child.querySelector('img') ? 'photo' : child.textContent?.trim()
		);
	}, html);
	expect(htmlOrder).toEqual([
		'Beach day',
		'Before the photos',
		'photo',
		'photo',
		'After the photos'
	]);

	await closeEditor(page);
	const composerRegion = page.getByRole('region', { name: 'New note' });
	await composerRegion.getByRole('button', { name: /^Take a note/ }).click();
	const composerBody = composerRegion.getByRole('textbox', { name: 'Note body' });
	await typeInTextRow(page, '');
	await dispatchCopiedNotePaste(composerBody);
	await expect(composerRegion.getByPlaceholder('Title', { exact: true })).toHaveValue('Beach day');
	await expect(composerBody).toContainText('Before the photos');
	await expect(composerBody).toContainText('After the photos');
	const composerChips = composerRegion.locator('[data-body-editor] .markdown-token-photo');
	await expect(composerChips).toHaveCount(2);
	await expect(composerRegion.locator('.markdown-token-photo-missing')).toHaveCount(0);
	const composerIds = await composerChips.evaluateAll((chips) =>
		chips.map((chip) => chip.getAttribute('data-photo') ?? '')
	);
	for (const id of composerIds) expect(sourceIds).not.toContain(id);
	const showComposerPreviews = composerRegion.getByRole('button', { name: 'Show previews' });
	if (await showComposerPreviews.count()) await showComposerPreviews.click();
	await expect(
		composerRegion.getByLabel('Photos').getByRole('button', { name: /^Open/ })
	).toHaveCount(2);
	await composerRegion.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(page.getByRole('article').filter({ hasText: 'After the photos' })).toHaveCount(2);

	await createNote(page, 'Existing note', 'Keep this text');
	await openCard(page, 'Existing note');
	const existingBody = editor(page).locator('[data-body-editor]');
	await typeInTextRow(page, '');
	await dispatchCopiedNotePaste(existingBody);
	await expect(editor(page).getByPlaceholder('Title', { exact: true })).toHaveValue(
		'Existing note'
	);
	await expect(existingBody).toContainText('Keep this text');
	await expect(existingBody).toContainText('Beach day');
	await expect(existingBody).toContainText('Before the photos');
	await expect(existingBody).toContainText('After the photos');
	const existingChips = existingBody.locator('.markdown-token-photo');
	await expect(existingChips).toHaveCount(2);
	await expect(editor(page).locator('.markdown-token-photo-missing')).toHaveCount(0);
	const existingIds = await existingChips.evaluateAll((chips) =>
		chips.map((chip) => chip.getAttribute('data-photo') ?? '')
	);
	for (const id of existingIds) {
		expect(sourceIds).not.toContain(id);
		expect(composerIds).not.toContain(id);
	}
});

test('canceling photo quality leaves the note and its body unchanged', async ({ page }) => {
	await openEmptyApp(page);
	await pickFromComposer(page, [{ name: 'beach.png', mimeType: 'image/png', buffer: PNG }]);
	await expect(photoQualityDialog(page)).toBeVisible();
	await page.getByRole('button', { name: 'Cancel attachments' }).click();
	await expect(photoQualityDialog(page)).toBeHidden();
	await expect(page.locator('[data-body-editor] .markdown-token-photo')).toHaveCount(0);
	await expect(page.getByLabel('Photos').getByRole('button', { name: /^Open/ })).toHaveCount(0);
});

test('an unsupported HEIC image stays available as a file attachment', async ({ page }) => {
	await openEmptyApp(page);
	await pickFromComposer(page, [
		{ name: 'camera.heic', mimeType: 'image/heic', buffer: Buffer.from('not an HEIC image') }
	]);
	await expect(photoQualityDialog(page)).toBeVisible();
	await page.getByRole('button', { name: /^Compressed/ }).click();
	await expect(
		page.getByText(/camera\.heic could not be read as a photo, so it was kept as a file\./)
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Open camera.heic' })).toBeVisible();
	await expect(page.locator('[data-body-editor] .markdown-token-photo')).toHaveCount(0);
});

test('a file too large to sync is refused with a message, and the rest go in', async ({ page }) => {
	await openEmptyApp(page);
	await page.getByRole('button', { name: 'Take a note…' }).click();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Attach', exact: true }).click();
	await (
		await chooser
	).setFiles([
		{ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(9 * 1024 * 1024) },
		{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }
	]);
	await expect(
		page.getByText(/clip\.mp4 is 9\.0 MB; a file over 8\.0 MB cannot sync, so it was not added\./)
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Open notes.txt' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Open clip.mp4' })).toHaveCount(0);
});
