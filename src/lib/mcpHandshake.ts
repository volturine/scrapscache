import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';

const encoder = new TextEncoder();

export function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function base64UrlToBytes(value: string): Uint8Array {
	const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
	const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export type EncryptedHandshakeGrant = {
	clientPublicKey: string;
	ciphertext: string;
	nonce: string;
};

export function encryptHandshakePayload(params: {
	mcpPublicKey: string;
	syncKey?: string;
	workspaces?: { name: string; syncKey: string }[];
}): EncryptedHandshakeGrant {
	const plaintext = params.workspaces?.length
		? JSON.stringify({ v: 1, workspaces: params.workspaces })
		: params.syncKey || '';
	const clientPrivateKey = crypto.getRandomValues(new Uint8Array(32));
	const clientPublicKey = bytesToBase64Url(x25519.getPublicKey(clientPrivateKey));
	const mcpPubBytes = base64UrlToBytes(params.mcpPublicKey);
	const sharedSecret = x25519.getSharedSecret(clientPrivateKey, mcpPubBytes);
	const key = sha256(
		encoder.encode(`scrapscache-mcp-handshake:v1:${bytesToBase64Url(sharedSecret)}`)
	);
	const nonce = crypto.getRandomValues(new Uint8Array(24));
	const ciphertext = xchacha20poly1305(key, nonce).encrypt(encoder.encode(plaintext));
	return {
		clientPublicKey,
		ciphertext: bytesToBase64Url(ciphertext),
		nonce: bytesToBase64Url(nonce)
	};
}
