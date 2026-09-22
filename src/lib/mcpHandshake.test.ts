import { describe, it, expect } from 'vitest';
import { encryptHandshakePayload, base64UrlToBytes, bytesToBase64Url } from './mcpHandshake';
import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

describe('mcpHandshake', () => {
	it('encrypts payload that receiver can decrypt with x25519 shared secret', () => {
		const mcpPrivateKey = crypto.getRandomValues(new Uint8Array(32));
		const mcpPublicKey = bytesToBase64Url(x25519.getPublicKey(mcpPrivateKey));
		const sampleSyncKey = 'abcdefghijklmnopqrstuvwxyz0123456789-_SAMPLE';

		const grant = encryptHandshakePayload({
			mcpPublicKey,
			syncKey: sampleSyncKey
		});

		expect(grant.clientPublicKey).toBeTruthy();
		expect(grant.ciphertext).toBeTruthy();
		expect(grant.nonce).toBeTruthy();

		// Simulate MCP receiver side
		const clientPubBytes = base64UrlToBytes(grant.clientPublicKey);
		const sharedSecret = x25519.getSharedSecret(mcpPrivateKey, clientPubBytes);
		const key = sha256(
			new TextEncoder().encode(`scrapscache-mcp-handshake:v1:${bytesToBase64Url(sharedSecret)}`)
		);
		const decryptedBytes = xchacha20poly1305(key, base64UrlToBytes(grant.nonce)).decrypt(
			base64UrlToBytes(grant.ciphertext)
		);
		const decrypted = new TextDecoder().decode(decryptedBytes);

		expect(decrypted).toBe(sampleSyncKey);
	});
});
