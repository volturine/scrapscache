import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import type { Note, NoteColor, NoteImage } from '$lib/types';
import type { LinkPreview } from '$lib/linkPreview';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64Url(bytes: Uint8Array): string {
	const CHUNK_SIZE = 8192;
	let binary = '';
	for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
		const chunk = bytes.subarray(i, i + CHUNK_SIZE);
		binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
	}
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function base64UrlToBytes(value: string): Uint8Array {
	const padded =
		value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function secureBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return bytes;
}

export interface SharedNoteData {
	version: 1;
	title: string;
	body: string;
	color: NoteColor;
	images?: NoteImage[];
	linkPreviews?: LinkPreview[];
	labelNames?: string[];
	createdAt: number;
}

export function generateShareKey(): string {
	return bytesToBase64Url(secureBytes(32));
}

/**
 * Serializes and encrypts note data with XChaCha20-Poly1305.
 * The 32-byte key is kept client-side and placed only in the URL fragment.
 */
export function encryptSharedNote(
	note: Pick<Note, 'title' | 'body' | 'color' | 'images' | 'linkPreviews' | 'createdAt'>,
	labelNames: string[] = [],
	key: string = generateShareKey()
): { ciphertext: string; key: string } {
	const payload: SharedNoteData = {
		version: 1,
		title: note.title ?? '',
		body: note.body ?? '',
		color: note.color ?? 'default',
		...(note.images?.length ? { images: note.images } : {}),
		...(note.linkPreviews?.length ? { linkPreviews: note.linkPreviews } : {}),
		...(labelNames.length ? { labelNames } : {}),
		createdAt: note.createdAt || Date.now()
	};

	const rawKey = base64UrlToBytes(key);
	if (rawKey.length !== 32) {
		throw new Error('Share key must be 32 bytes');
	}

	const nonce = secureBytes(24);
	const plaintext = encoder.encode(JSON.stringify(payload));
	const encrypted = xchacha20poly1305(rawKey, nonce).encrypt(plaintext);

	const packed = new Uint8Array(nonce.length + encrypted.length);
	packed.set(nonce, 0);
	packed.set(encrypted, nonce.length);

	return {
		ciphertext: bytesToBase64Url(packed),
		key
	};
}

/**
 * Decrypts a shared note payload using the base64url-encoded 32-byte key from the URL hash.
 */
export function decryptSharedNote(ciphertext: string, key: string): SharedNoteData {
	const rawKey = base64UrlToBytes(key);
	if (rawKey.length !== 32) {
		throw new Error('Share key must be 32 bytes');
	}

	const packed = base64UrlToBytes(ciphertext);
	if (packed.length < 24 + 16) {
		throw new Error('Invalid ciphertext length');
	}

	const nonce = packed.slice(0, 24);
	const encrypted = packed.slice(24);
	const plaintextBytes = xchacha20poly1305(rawKey, nonce).decrypt(encrypted);
	const parsed = JSON.parse(decoder.decode(plaintextBytes)) as SharedNoteData;

	if (parsed.version !== 1) {
		throw new Error(`Unsupported shared note version: ${parsed.version}`);
	}

	return parsed;
}

export function createShareUrl(origin: string, id: string, key: string): string {
	const base = origin.replace(/\/+$/, '');
	return `${base}/share/${encodeURIComponent(id)}#${key}`;
}

export function parseShareHash(hash: string): string | null {
	const trimmed = hash.replace(/^#/, '').trim();
	if (!trimmed) return null;
	if (/^[A-Za-z0-9_-]{40,45}$/.test(trimmed)) {
		return trimmed;
	}
	return null;
}
