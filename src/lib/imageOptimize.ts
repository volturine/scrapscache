export type ImageQuality = 'compressed' | 'hd';

export type ImageOptimizationRecipe = {
	maxLongEdge: number;
	targetBytes: number;
	initialQuality: number;
	minQuality: number;
	encodingVersion: number;
};

const IMAGE_RECIPES: Record<ImageQuality, ImageOptimizationRecipe> = {
	// 1600 px keeps a photographed A4 page legible while dramatically reducing
	// storage and sync traffic for ordinary camera photos.
	compressed: {
		maxLongEdge: 1600,
		targetBytes: 700 * 1024,
		initialQuality: 0.74,
		minQuality: 0.6,
		encodingVersion: 2
	},
	hd: {
		maxLongEdge: 2560,
		targetBytes: 4 * 1024 * 1024,
		initialQuality: 0.86,
		minQuality: 0.72,
		encodingVersion: 3
	}
};

export function imageOptimizationRecipe(quality: ImageQuality): ImageOptimizationRecipe {
	return IMAGE_RECIPES[quality];
}

export type OptimizedImage = {
	blob: Blob;
	/** The type the browser actually encoded, never the one that was requested. */
	mime: string;
	width: number;
	height: number;
	byteSize: number;
	encodingVersion: number;
};

type Drawable = CanvasImageSource & { width: number; height: number; close?: () => void };

export function fitImageDimensions(
	width: number,
	height: number,
	maxLongEdge = IMAGE_RECIPES.hd.maxLongEdge
): { width: number; height: number } {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		throw new Error('Image has invalid dimensions');
	}
	const scale = Math.min(1, maxLongEdge / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

const PREFERRED_MIME = 'image/webp';
// Every browser encodes JPEG, and JPEG honours the quality argument.
const FALLBACK_MIME = 'image/jpeg';

const EXTENSION_BY_MIME: Record<string, string> = {
	'image/webp': 'webp',
	'image/jpeg': 'jpg',
	'image/png': 'png'
};

function canvasBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Browser could not encode this image'))),
			mime,
			quality
		);
	});
}

async function loadWithImageElement(source: Blob): Promise<Drawable> {
	const url = URL.createObjectURL(source);
	try {
		const image = new Image();
		image.decoding = 'async';
		const loaded = new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('Browser could not decode this image'));
		});
		image.src = url;
		await loaded;
		return image as Drawable;
	} finally {
		URL.revokeObjectURL(url);
	}
}

async function loadDrawable(source: Blob): Promise<Drawable> {
	if (typeof createImageBitmap === 'function') {
		return (await createImageBitmap(source, { imageOrientation: 'from-image' })) as Drawable;
	}
	return loadWithImageElement(source);
}

/**
 * Re-encode a browser-decodable image before persistence.
 * Canvas output removes source metadata, including embedded GPS/EXIF blocks.
 */
export async function optimizeImageBlob(
	source: Blob,
	quality: ImageQuality
): Promise<OptimizedImage> {
	const recipe = imageOptimizationRecipe(quality);
	const drawable = await loadDrawable(source);
	try {
		let dimensions = fitImageDimensions(drawable.width, drawable.height, recipe.maxLongEdge);
		let encodeQuality = recipe.initialQuality;
		let encoded: Blob | null = null;
		let requestedMime = PREFERRED_MIME;

		for (let attempt = 0; attempt < 8; attempt++) {
			const canvas = document.createElement('canvas');
			canvas.width = dimensions.width;
			canvas.height = dimensions.height;
			const context = canvas.getContext('2d', { alpha: true });
			if (!context) throw new Error('Browser image processing is unavailable');
			context.imageSmoothingEnabled = true;
			context.imageSmoothingQuality = 'high';
			context.drawImage(drawable, 0, 0, dimensions.width, dimensions.height);
			encoded = await canvasBlob(canvas, requestedMime, encodeQuality);
			// `toBlob` silently substitutes PNG for a type the browser cannot encode
			// (Safari has no WebP encoder), so the blob's own type is the truth.
			if (requestedMime === PREFERRED_MIME && encoded.type !== PREFERRED_MIME) {
				requestedMime = FALLBACK_MIME;
				encoded = await canvasBlob(canvas, requestedMime, encodeQuality);
			}
			canvas.width = 1;
			canvas.height = 1;
			if (encoded.size <= recipe.targetBytes) break;
			// An encoder that substituted its own format ignores quality too;
			// another pass would only shrink the image without reducing its bytes.
			if (encoded.type !== requestedMime) break;

			if (encodeQuality > recipe.minQuality) {
				encodeQuality = Math.max(recipe.minQuality, encodeQuality - 0.05);
			} else {
				dimensions = fitImageDimensions(
					Math.max(1, Math.round(dimensions.width * 0.82)),
					Math.max(1, Math.round(dimensions.height * 0.82)),
					Math.max(dimensions.width, dimensions.height)
				);
			}
		}

		if (!encoded) throw new Error('Browser could not encode this image');
		return {
			blob: encoded,
			mime: encoded.type || requestedMime,
			width: dimensions.width,
			height: dimensions.height,
			byteSize: encoded.size,
			encodingVersion: recipe.encodingVersion
		};
	} finally {
		drawable.close?.();
	}
}

export function optimizedImageName(name: string, mime: string): string {
	const stem = name.replace(/\.[^.]+$/, '') || 'image';
	const extension = EXTENSION_BY_MIME[mime] ?? mime.replace(/^image\//, '');
	return `${stem}.${extension}`;
}
