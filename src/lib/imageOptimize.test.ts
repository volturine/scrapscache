import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	fitImageDimensions,
	imageOptimizationRecipe,
	optimizeImageBlob,
	optimizedImageName
} from './imageOptimize';

describe('image optimization geometry', () => {
	it('fits landscape and portrait images without upscaling', () => {
		expect(fitImageDimensions(6000, 4000)).toEqual({ width: 2560, height: 1707 });
		expect(fitImageDimensions(3000, 5000)).toEqual({ width: 1536, height: 2560 });
		expect(fitImageDimensions(800, 600)).toEqual({ width: 800, height: 600 });
	});

	it('rejects invalid dimensions', () => {
		expect(() => fitImageDimensions(0, 100)).toThrow('invalid dimensions');
		expect(() => fitImageDimensions(Number.NaN, 100)).toThrow('invalid dimensions');
	});

	it('names the re-encoded file after the type the browser produced', () => {
		expect(optimizedImageName('holiday.HEIC', 'image/webp')).toBe('holiday.webp');
		expect(optimizedImageName('image', 'image/webp')).toBe('image.webp');
		expect(optimizedImageName('holiday.HEIC', 'image/jpeg')).toBe('holiday.jpg');
		expect(optimizedImageName('holiday.HEIC', 'image/png')).toBe('holiday.png');
	});

	it('uses a text-legible compressed size and a larger HD recipe', () => {
		const compressed = imageOptimizationRecipe('compressed');
		const hd = imageOptimizationRecipe('hd');
		expect(compressed.maxLongEdge).toBeGreaterThanOrEqual(1600);
		expect(compressed.maxLongEdge).toBeLessThan(hd.maxLongEdge);
		expect(compressed.targetBytes).toBeLessThan(hd.targetBytes);
		expect(compressed.encodingVersion).not.toBe(hd.encodingVersion);
	});
});

type ToBlobCall = { type: string; quality: number };

/**
 * A canvas whose `toBlob` behaves like Safari: a request for WebP silently
 * yields PNG, and only JPEG honours the quality argument. jsdom has no canvas
 * backend at all, so decoding and drawing are stubbed as well.
 */
function installFakeCanvas(encode: (call: ToBlobCall) => Blob) {
	const calls: ToBlobCall[] = [];
	vi.stubGlobal(
		'createImageBitmap',
		vi.fn(async () => ({ width: 4000, height: 3000, close: () => {} }))
	);
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
		drawImage: () => {},
		imageSmoothingEnabled: true,
		imageSmoothingQuality: 'high'
	} as unknown as CanvasRenderingContext2D);
	vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
		callback: BlobCallback,
		type?: string,
		quality?: unknown
	) {
		const call = { type: type ?? 'image/png', quality: typeof quality === 'number' ? quality : 1 };
		calls.push(call);
		callback(encode(call));
	});
	return calls;
}

function blobOfSize(bytes: number, type: string): Blob {
	return new Blob([new Uint8Array(bytes)], { type });
}

describe('image optimization without a WebP encoder', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('re-encodes as JPEG and labels the result with the produced type', async () => {
		const calls = installFakeCanvas(({ type, quality }) =>
			type === 'image/jpeg'
				? blobOfSize(Math.round(quality * 1024 * 1024), 'image/jpeg')
				: blobOfSize(2 * 1024 * 1024, 'image/png')
		);

		const result = await optimizeImageBlob(
			new Blob(['photo'], { type: 'image/heic' }),
			'compressed'
		);

		expect(result.mime).toBe('image/jpeg');
		expect(result.blob.type).toBe('image/jpeg');
		expect(result.byteSize).toBeLessThanOrEqual(700 * 1024);
		expect({ width: result.width, height: result.height }).toEqual({ width: 1600, height: 1200 });
		expect(calls.filter((call) => call.type === 'image/webp')).toHaveLength(1);
		const jpegQualities = calls.filter((call) => call.type === 'image/jpeg').map((c) => c.quality);
		expect(jpegQualities[0]).toBeCloseTo(0.74);
		expect(jpegQualities.at(-1)).toBeLessThan(0.74);
	});

	it('stops after one pass when the encoder ignores both type and quality', async () => {
		const calls = installFakeCanvas(() => blobOfSize(2 * 1024 * 1024, 'image/png'));

		const result = await optimizeImageBlob(
			new Blob(['photo'], { type: 'image/heic' }),
			'compressed'
		);

		expect(result.mime).toBe('image/png');
		expect({ width: result.width, height: result.height }).toEqual({ width: 1600, height: 1200 });
		expect(calls.map((call) => call.type)).toEqual(['image/webp', 'image/jpeg']);
	});
});
