import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Seals a payload in the pre-slot-binding shape: nonce and ciphertext, no version
 * byte, no AAD. A relay could still serve this, so tests use it to prove every
 * decode path refuses it.
 */
export function unboundSyncEnvelope(
	syncKey: string,
	payload: unknown,
	nonce = crypto.getRandomValues(new Uint8Array(24))
): string {
	const key = sha256(new TextEncoder().encode(`scraps-cache-sync-payload:v1:${syncKey}`));
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
