import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { pairingCodeFromImageData, pairingCodeFromQrText } from './pairingQr';
import { createPairingUrl } from './syncPairing';

const CODE = 'ABCD0123EFGH4567';

/** Render a QR code into RGBA pixels with a quiet zone, the way a camera frame arrives. */
function qrImageData(text: string, scale = 4): ImageData {
	const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
	const margin = 4;
	const modules = qr.modules.size + margin * 2;
	const size = modules * scale;
	const data = new Uint8ClampedArray(size * size * 4).fill(255);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const mx = Math.floor(x / scale) - margin;
			const my = Math.floor(y / scale) - margin;
			const inside = mx >= 0 && my >= 0 && mx < qr.modules.size && my < qr.modules.size;
			if (inside && qr.modules.get(my, mx)) {
				const i = (y * size + x) * 4;
				data[i] = data[i + 1] = data[i + 2] = 0;
			}
		}
	}
	return { data, width: size, height: size, colorSpace: 'srgb' } as ImageData;
}

describe('pairingCodeFromQrText', () => {
	it('reads the code from a pairing link fragment', () => {
		const link = createPairingUrl('https://notes.example/app?x=1', CODE);
		expect(pairingCodeFromQrText(link)).toBe(CODE);
	});

	it('accepts a bare or formatted code', () => {
		expect(pairingCodeFromQrText('abcd-0123-efgh-4567')).toBe(CODE);
	});

	it('rejects links without a pairing code and unrelated text', () => {
		expect(pairingCodeFromQrText('https://notes.example/#other=1')).toBeNull();
		expect(pairingCodeFromQrText('https://[bad')).toBeNull();
		expect(pairingCodeFromQrText('hello world')).toBeNull();
	});
});

describe('pairingCodeFromImageData', () => {
	it('decodes the pairing QR the app renders', () => {
		const link = createPairingUrl('https://notes.example/', CODE);
		expect(pairingCodeFromImageData(qrImageData(link))).toBe(CODE);
	});

	it('returns null for a frame without a QR code', () => {
		const blank = new Uint8ClampedArray(64 * 64 * 4).fill(255);
		expect(
			pairingCodeFromImageData({
				data: blank,
				width: 64,
				height: 64,
				colorSpace: 'srgb'
			} as ImageData)
		).toBeNull();
	});

	it('returns null for a QR code that holds something else', () => {
		expect(pairingCodeFromImageData(qrImageData('https://example.com/'))).toBeNull();
	});
});
