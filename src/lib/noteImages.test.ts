import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./native', () => ({ isNativeApp: vi.fn(() => false) }));
import {
	CANVAS_MIME,
	createCanvasAttachment,
	decodeCanvasAttachment,
	isCanvasAttachment,
	type CanvasScene
} from './canvasAttachment';
import {
	fileToNoteImage,
	saveAttachment,
	getClipboardFiles,
	isInlinePreviewable,
	looksLikePhoto,
	noteImageFromCroppedDataUrl,
	prepareAttachmentForMemory,
	stripFullPreviewBytes
} from './noteImages';

describe('attachment preview routing', () => {
	it('keeps browser-viewable files in the app viewer', () => {
		for (const mime of [
			'application/pdf',
			'text/plain',
			'text/yaml',
			'application/yaml',
			'application/json',
			'audio/mpeg',
			'video/mp4'
		]) {
			expect(isInlinePreviewable({ mime })).toBe(true);
		}
	});

	it('sends unsupported files to the platform save/share flow', () => {
		for (const mime of [
			'application/zip',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		]) {
			expect(isInlinePreviewable({ mime })).toBe(false);
		}
	});
});

describe('looksLikePhoto', () => {
	it('identifies image mime types as photos', () => {
		expect(looksLikePhoto({ type: 'image/png', name: 'screenshot' })).toBe(true);
		expect(looksLikePhoto({ type: 'image/jpeg', name: 'photo' })).toBe(true);
		expect(looksLikePhoto({ type: 'image/webp', name: 'pic' })).toBe(true);
		expect(looksLikePhoto({ type: 'image/heic', name: 'camera' })).toBe(true);
	});

	it('identifies image file extensions even without mime type', () => {
		expect(looksLikePhoto({ type: '', name: 'photo.jpg' })).toBe(true);
		expect(looksLikePhoto({ type: '', name: 'photo.JPEG' })).toBe(true);
		expect(looksLikePhoto({ type: '', name: 'photo.png' })).toBe(true);
		expect(looksLikePhoto({ type: '', name: 'photo.webp' })).toBe(true);
		expect(looksLikePhoto({ type: '', name: 'photo.avif' })).toBe(true);
		expect(looksLikePhoto({ type: '', name: 'photo.gif' })).toBe(true);
		expect(looksLikePhoto({ type: '', name: 'photo.heic' })).toBe(true);
		expect(looksLikePhoto({ type: '', name: 'photo.dng' })).toBe(true);
	});

	it('rejects non-image files', () => {
		expect(looksLikePhoto({ type: 'application/pdf', name: 'doc.pdf' })).toBe(false);
		expect(looksLikePhoto({ type: 'text/plain', name: 'notes.txt' })).toBe(false);
		expect(looksLikePhoto({ type: '', name: 'archive.zip' })).toBe(false);
	});

	it('rejects excalidraw files even with image extension', () => {
		expect(looksLikePhoto({ type: 'image/png', name: 'diagram.excalidraw.png' })).toBe(false);
		expect(looksLikePhoto({ type: '', name: 'diagram.excalidraw' })).toBe(false);
	});
});

describe('getClipboardFiles', () => {
	it('extracts files from clipboardData.files', () => {
		const photo = new File(['data'], 'shot.png', { type: 'image/png' });
		const dataTransfer = {
			files: [photo]
		} as unknown as DataTransfer;
		expect(getClipboardFiles(dataTransfer)).toEqual([photo]);
	});

	it('extracts files from clipboardData.items when files is empty', () => {
		const photo = new File(['data'], 'shot.png', { type: 'image/png' });
		const dataTransfer = {
			files: [],
			items: [
				{
					kind: 'file',
					type: 'image/png',
					getAsFile: () => photo
				},
				{
					kind: 'string',
					type: 'text/plain',
					getAsFile: () => null
				}
			]
		} as unknown as DataTransfer;
		expect(getClipboardFiles(dataTransfer)).toEqual([photo]);
	});

	it('returns empty array when no files are present', () => {
		expect(getClipboardFiles(null)).toEqual([]);
		const dataTransfer = {
			files: [],
			items: [
				{
					kind: 'string',
					type: 'text/plain',
					getAsFile: () => null
				}
			]
		} as unknown as DataTransfer;
		expect(getClipboardFiles(dataTransfer)).toEqual([]);
	});
});

describe('resident attachment previews', () => {
	it('keeps a displayable original when thumbnail generation left no preview', () => {
		const image = {
			id: 'photo',
			mime: 'image/png',
			dataUrl: 'data:image/png;base64,AA==',
			createdAt: 1
		};
		expect(stripFullPreviewBytes(image).dataUrl).toBe(image.dataUrl);
		expect(stripFullPreviewBytes({ ...image, thumbUrl: image.dataUrl }).dataUrl).toBe('');
	});
	it('extracts an encrypted canvas payload preview before releasing full bytes', async () => {
		const scene: CanvasScene = {
			elements: [{ id: 'text-1', type: 'text', x: 0, y: 0, width: 20, height: 10 }],
			appState: {}
		};
		const preview = 'data:image/png;base64,AA==';
		const attachment = await createCanvasAttachment(scene, preview);
		delete attachment.thumbUrl;

		const compacted = await prepareAttachmentForMemory(attachment);

		expect(compacted.thumbUrl).toBe(preview);
		expect(compacted.dataUrl).toBe('');
		expect(compacted.contentHash).toBeTruthy();
	});
});

describe('excalidraw file transformation', () => {
	it('transforms excalidraw files into native canvas attachments', async () => {
		const excalidrawJson = JSON.stringify({
			type: 'excalidraw',
			version: 2,
			elements: [
				{
					id: 'box-1',
					type: 'rectangle',
					x: 10,
					y: 10,
					width: 100,
					height: 60
				}
			],
			appState: { viewBackgroundColor: '#121212' },
			files: {}
		});
		const file = new File([excalidrawJson], 'Architecture.excalidraw', {
			type: 'application/octet-stream'
		});

		const attachment = await fileToNoteImage(file, 'compressed');

		expect(isCanvasAttachment(attachment)).toBe(true);
		expect(attachment.mime).toBe(CANVAS_MIME);
		expect(attachment.name).toBe('Architecture');
		expect(attachment.thumbUrl).toBeTruthy();

		const decoded = await decodeCanvasAttachment(attachment);
		expect(decoded.elements).toHaveLength(1);
		expect(decoded.elements[0].id).toBe('box-1');
		expect(decoded.appState.viewBackgroundColor).toBe('#121212');
	});
});

describe('photos on a browser without a WebP encoder', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it.each([
		['HEIC', 'image/heic'],
		['HEIF', ''],
		['AVIF', '']
	])(
		'stores the produced type and extension for %s, even without a MIME type',
		async (extension, mime) => {
			vi.stubGlobal(
				'createImageBitmap',
				vi.fn(async () => ({ width: 800, height: 600, close: () => {} }))
			);
			// Thumbnails decode through an <img>, which jsdom never loads.
			vi.stubGlobal(
				'Image',
				class {
					width = 800;
					height = 600;
					onload: (() => void) | null = null;
					set src(_value: string) {
						queueMicrotask(() => this.onload?.());
					}
				}
			);
			vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
				drawImage: () => {}
			} as unknown as CanvasRenderingContext2D);
			vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
				'data:image/jpeg;base64,AA=='
			);
			vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
				callback: BlobCallback,
				type?: string
			) {
				const produced = type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
				callback(new Blob([new Uint8Array(16)], { type: produced }));
			});

			const image = await fileToNoteImage(
				new File(['photo'], `IMG_0001.${extension}`, { type: mime }),
				'compressed'
			);

			expect(image.mime).toBe('image/jpeg');
			expect(image.name).toBe('IMG_0001.jpg');
			expect(image.dataUrl.startsWith('data:image/jpeg;')).toBe(true);
		}
	);
});

describe('cropping a photo', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('names the result after the type the browser produced', async () => {
		vi.stubGlobal('URL', { createObjectURL: () => 'blob:crop', revokeObjectURL: vi.fn() });
		// Thumbnails decode through an <img>, which jsdom never loads.
		vi.stubGlobal(
			'Image',
			class {
				width = 8;
				height = 8;
				onload: (() => void) | null = null;
				set src(_value: string) {
					queueMicrotask(() => this.onload?.());
				}
			}
		);
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
			drawImage: () => {}
		} as unknown as CanvasRenderingContext2D);
		vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
			'data:image/jpeg;base64,AA=='
		);
		const source = {
			id: 'img-1',
			mime: 'image/webp',
			name: 'IMG_0001.webp',
			dataUrl: 'data:image/webp;base64,AA==',
			width: 16,
			height: 8,
			createdAt: 1
		};
		// Safari has no WebP encoder, so the cropper hands back a PNG data URL.
		const cropped = await noteImageFromCroppedDataUrl(source, 'data:image/png;base64,AA==');
		expect(cropped.mime).toBe('image/png');
		expect(cropped.name).toBe('IMG_0001.png');
		expect([cropped.width, cropped.height]).toEqual([8, 8]);
	});
});

describe('saveAttachment', () => {
	const PNG =
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('downloads the photo bytes on the web, named after the photo', async () => {
		const { isNativeApp } = await import('./native');
		vi.mocked(isNativeApp).mockReturnValue(false);
		const createObjectURL = vi.fn((_blob: Blob) => 'blob:photo');
		vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
		const clicks: string[] = [];
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
			this: HTMLAnchorElement
		) {
			clicks.push(`${this.download}:${this.href}`);
		});
		await saveAttachment({
			id: 'a',
			mime: 'image/png',
			dataUrl: PNG,
			name: 'one.png',
			createdAt: 1
		});
		expect(createObjectURL).toHaveBeenCalledTimes(1);
		const [blob] = createObjectURL.mock.calls[0];
		expect(blob.type).toBe('image/png');
		expect(blob.size).toBeGreaterThan(10);
		expect(clicks).toEqual(['one.png:blob:photo']);
	});

	it('hands the photo to the share sheet in the app', async () => {
		const { isNativeApp } = await import('./native');
		vi.mocked(isNativeApp).mockReturnValue(true);
		const share = vi.fn(async () => {});
		vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
		await saveAttachment({
			id: 'a',
			mime: 'image/png',
			dataUrl: PNG,
			name: 'one.png',
			createdAt: 1
		});
		expect(share).toHaveBeenCalledTimes(1);
		const [{ files, title }] = share.mock.calls[0] as unknown as [{ files: File[]; title: string }];
		expect(title).toBe('one.png');
		expect(files[0].name).toBe('one.png');
		expect(files[0].type).toBe('image/png');
	});

	it('reports unavailable native sharing instead of silently using an unsupported download', async () => {
		const { isNativeApp } = await import('./native');
		vi.mocked(isNativeApp).mockReturnValue(true);
		vi.stubGlobal('navigator', { ...navigator, canShare: () => false });
		await expect(
			saveAttachment({ id: 'a', mime: 'image/png', dataUrl: PNG, name: 'one.png', createdAt: 1 })
		).rejects.toThrow(/sharing is unavailable/);
	});

	it('refuses while only the thumbnail is here', async () => {
		await expect(
			saveAttachment({
				id: 'a',
				mime: 'image/png',
				dataUrl: '',
				thumbUrl: PNG,
				name: 'one.png',
				createdAt: 1
			})
		).rejects.toThrow(/still loading/);
	});
});
