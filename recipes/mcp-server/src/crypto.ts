import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

export function sha256(data: string | Uint8Array): Uint8Array {
	const bytes = typeof data === 'string' ? encoder.encode(data) : data;
	return nobleSha256(bytes);
}

export function sha256Base64Url(data: string | Uint8Array): string {
	return bytesToBase64Url(sha256(data));
}

export function randomBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return bytes;
}

export function randomOpaqueId(): string {
	return bytesToBase64Url(randomBytes(16));
}

export type SyncIdentity = {
	accountId: string;
	authPublicKey: string;
	authPrivateKey: Uint8Array;
};

export function identityFromSyncKey(syncKey: string): SyncIdentity {
	const accountIdBytes = sha256(encoder.encode(`scraps-cache-account-id:v1:${syncKey}`)).subarray(
		0,
		18
	);
	const accountId = bytesToBase64Url(accountIdBytes);
	const authPrivateKey = sha256(encoder.encode(`scraps-cache-account-auth:v2:${syncKey}`));
	const authPublicKey = bytesToBase64Url(ed25519.getPublicKey(authPrivateKey));
	return { accountId, authPublicKey, authPrivateKey };
}

export function signSyncChallenge(syncKey: string, accountId: string, challenge: string): string {
	const identity = identityFromSyncKey(syncKey);
	const message = encoder.encode(`scraps-cache-auth-challenge:v1:${accountId}:${challenge}`);
	return bytesToBase64Url(ed25519.sign(message, identity.authPrivateKey));
}

function syncPayloadKey(syncKey: string): Uint8Array {
	return sha256(encoder.encode(`scraps-cache-sync-payload:v1:${syncKey}`));
}

export function encryptSyncPayload(syncKey: string, payload: unknown): string {
	const key = syncPayloadKey(syncKey);
	const nonce = randomBytes(24);
	const plaintext = encoder.encode(JSON.stringify(payload));
	const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
	const envelope = new Uint8Array(nonce.length + ciphertext.length);
	envelope.set(nonce, 0);
	envelope.set(ciphertext, nonce.length);
	return bytesToBase64Url(envelope);
}

export function decryptSyncPayload<T = unknown>(syncKey: string, envelope: string): T {
	const key = syncPayloadKey(syncKey);
	const bytes = base64UrlToBytes(envelope);
	if (bytes.length < 40) {
		throw new Error('Encrypted payload too short');
	}
	const nonce = bytes.subarray(0, 24);
	const ciphertext = bytes.subarray(24);
	const decrypted = xchacha20poly1305(key, nonce).decrypt(ciphertext);
	return JSON.parse(decoder.decode(decrypted)) as T;
}

export function computeSlot(syncKey: string, recordKey: string): string {
	return bytesToBase64Url(sha256(encoder.encode(`${syncKey}\0${recordKey}`)));
}

export function createHandshakeKeyPair(): { privateKey: Uint8Array; publicKey: string } {
	const privateKey = randomBytes(32);
	const publicKeyBytes = x25519.getPublicKey(privateKey);
	return {
		privateKey,
		publicKey: bytesToBase64Url(publicKeyBytes)
	};
}

export function decryptHandshakePayload(params: {
	mcpPrivateKey: Uint8Array;
	clientPublicKey: string;
	ciphertext: string;
	nonce: string;
}): string {
	const clientPublicKeyBytes = base64UrlToBytes(params.clientPublicKey);
	const sharedSecret = x25519.getSharedSecret(params.mcpPrivateKey, clientPublicKeyBytes);
	const key = sha256(
		encoder.encode(`scrapscache-mcp-handshake:v1:${bytesToBase64Url(sharedSecret)}`)
	);
	const nonceBytes = base64UrlToBytes(params.nonce);
	const ciphertextBytes = base64UrlToBytes(params.ciphertext);
	const decrypted = xchacha20poly1305(key, nonceBytes).decrypt(ciphertextBytes);
	return decoder.decode(decrypted);
}

export function sealPayload(payload: unknown, secret: string): string {
	const key = sha256(encoder.encode(`scrapscache-mcp-seal:v1:${secret}`));
	const nonce = randomBytes(24);
	const plaintext = encoder.encode(JSON.stringify(payload));
	const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
	const combined = new Uint8Array(nonce.length + ciphertext.length);
	combined.set(nonce, 0);
	combined.set(ciphertext, nonce.length);
	return bytesToBase64Url(combined);
}

export function unsealPayload<T>(sealed: string, secret: string): T | null {
	try {
		const combined = base64UrlToBytes(sealed);
		if (combined.length < 24 + 16) return null;
		const nonce = combined.subarray(0, 24);
		const ciphertext = combined.subarray(24);
		const key = sha256(encoder.encode(`scrapscache-mcp-seal:v1:${secret}`));
		const decrypted = xchacha20poly1305(key, nonce).decrypt(ciphertext);
		return JSON.parse(decoder.decode(decrypted)) as T;
	} catch {
		return null;
	}
}
