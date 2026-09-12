import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Seals a payload the way envelopes were written before slot binding: nonce and
 * ciphertext, no version byte, no AAD. Tests need to produce this because the
 * app no longer can, and the relay still holds envelopes in this shape.
 */
export function legacySyncEnvelope(syncKey: string, payload: unknown): string {
	const key = sha256(new TextEncoder().encode(`scraps-cache-sync-payload:v1:${syncKey}`));
	const nonce = new Uint8Array(24);
	crypto.getRandomValues(nonce);
	const ciphertext = xchacha20poly1305(key, nonce).encrypt(
		new TextEncoder().encode(JSON.stringify(payload))
	);
	const packed = new Uint8Array(nonce.length + ciphertext.length);
	packed.set(nonce);
	packed.set(ciphertext, nonce.length);
	return btoa(String.fromCharCode(...packed))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');
}
