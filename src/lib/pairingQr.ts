import jsQR from 'jsqr';
import { normalizePairingCode, pairingCodeFromUrl } from '$lib/syncPairing';

/** Read a one-time pairing code from a scanned QR payload: a pairing link or the bare code. */
export function pairingCodeFromQrText(text: string): string | null {
	const value = text.trim();
	if (/^https?:\/\//i.test(value)) {
		try {
			return pairingCodeFromUrl(value);
		} catch {
			return null;
		}
	}
	return normalizePairingCode(value);
}

/** Decode a pairing code from one camera frame or picked image, or null when none is readable. */
export function pairingCodeFromImageData(image: ImageData): string | null {
	const result = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
	return result ? pairingCodeFromQrText(result.data) : null;
}
