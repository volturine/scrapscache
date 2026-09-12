import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { cpace } from '@cipherman/pake-js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { PairingGrant } from '$lib/pairingProtocol';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PAIRING_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PAIRING_CODE_LENGTH = 16;
const PAIRING_URL_KEY = 'pair';
export type SyncIdentity = {
	syncKey: string;
	accountId: string;
	authPublicKey: string;
	pairingCode: string;
};
export type PairingRequestKey = { ephemeralSecret: string; share: string };

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function base64UrlToBytes(value: string): Uint8Array {
	const padded =
		value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
	return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
function secureBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return bytes;
}
function canonicalizePairingChar(char: string): string {
	const upper = char.toUpperCase();
	if (upper === 'O') return '0';
	if (upper === 'I' || upper === 'L') return '1';
	return upper;
}

export function normalizePairingCode(value: string): string | null {
	const cleaned = [...value]
		.map(canonicalizePairingChar)
		.filter((char) => PAIRING_ALPHABET.includes(char))
		.join('');
	return cleaned.length === PAIRING_CODE_LENGTH ? cleaned : null;
}

export function formatPairingCode(value: string): string {
	const cleaned = [...value]
		.map(canonicalizePairingChar)
		.filter((char) => PAIRING_ALPHABET.includes(char))
		.join('')
		.slice(0, PAIRING_CODE_LENGTH);
	return cleaned.match(/.{1,4}/g)?.join('-') ?? cleaned;
}

/** Build a pairing link with the one-time secret in the fragment, never the HTTP request. */
export function createPairingUrl(currentUrl: string, code: string): string {
	const normalized = normalizePairingCode(code);
	if (!normalized) throw new Error('Pairing code is invalid');
	const url = new URL(currentUrl);
	url.search = '';
	url.hash = new URLSearchParams({ [PAIRING_URL_KEY]: normalized }).toString();
	return url.toString();
}

export function pairingCodeFromUrl(value: string): string | null {
	const url = new URL(value);
	return normalizePairingCode(new URLSearchParams(url.hash.slice(1)).get(PAIRING_URL_KEY) ?? '');
}

export function createOneTimePairingCode(): string {
	const bytes = secureBytes(PAIRING_CODE_LENGTH);
	return [...bytes].map((byte) => PAIRING_ALPHABET[byte & 31]).join('');
}
export function identityFromSyncKey(syncKey: string): SyncIdentity {
	const raw = base64UrlToBytes(syncKey);
	if (raw.length !== 32) throw new Error('Invalid sync key');
	const authPrivateKey = sha256(encoder.encode(`scraps-cache-account-auth:v2:${syncKey}`));
	const authPublicKey = bytesToBase64Url(ed25519.getPublicKey(authPrivateKey));
	const accountId = bytesToBase64Url(
		sha256(encoder.encode(`scraps-cache-account-id:v1:${syncKey}`)).slice(0, 18)
	);
	return {
		syncKey,
		accountId,
		authPublicKey,
		pairingCode: ''
	};
}

export function legacyAuthSecret(syncKey: string): string {
	identityFromSyncKey(syncKey);
	return bytesToBase64Url(sha256(encoder.encode(`scraps-cache-account-auth:v1:${syncKey}`)));
}

function signSyncAuthMessage(syncKey: string, message: string): string {
	const authPrivateKey = sha256(encoder.encode(`scraps-cache-account-auth:v2:${syncKey}`));
	return bytesToBase64Url(ed25519.sign(encoder.encode(message), authPrivateKey));
}

export function signSyncRegistration(
	syncKey: string,
	accountId: string,
	authPublicKey: string
): string {
	const identity = identityFromSyncKey(syncKey);
	if (identity.accountId !== accountId || identity.authPublicKey !== authPublicKey)
		throw new Error('Invalid sync account identity');
	return signSyncAuthMessage(
		syncKey,
		`scraps-cache-auth-registration:v1:${accountId}:${authPublicKey}`
	);
}

export function signSyncMigration(
	syncKey: string,
	accountId: string,
	authPublicKey: string
): string {
	const identity = identityFromSyncKey(syncKey);
	if (identity.accountId !== accountId || identity.authPublicKey !== authPublicKey)
		throw new Error('Invalid sync account identity');
	return signSyncAuthMessage(
		syncKey,
		`scraps-cache-auth-migration:v1:${accountId}:${authPublicKey}`
	);
}

export function signSyncChallenge(syncKey: string, accountId: string, challenge: string): string {
	const identity = identityFromSyncKey(syncKey);
	if (identity.accountId !== accountId) throw new Error('Invalid sync account identity');
	return signSyncAuthMessage(syncKey, `scraps-cache-auth-challenge:v1:${accountId}:${challenge}`);
}
export function createSyncIdentity(): SyncIdentity {
	return identityFromSyncKey(bytesToBase64Url(secureBytes(32)));
}
export function randomOpaqueId(): string {
	return bytesToBase64Url(secureBytes(16));
}
export function pairingCodeTag(code: string): string {
	const normalized = normalizePairingCode(code);
	if (!normalized) throw new Error('Pairing code is invalid');
	return bytesToHex(sha256(encoder.encode(`scraps-cache-pairing-tag:v1:${normalized}`)));
}
function pakeInputs(code: string) {
	const normalized = normalizePairingCode(code);
	if (!normalized) throw new Error('Pairing code is invalid');
	const tag = pairingCodeTag(normalized);
	return {
		PRS: sha256(encoder.encode(`scraps-cache-pake-prs:v1:${normalized}`)),
		sid: encoder.encode(tag),
		CI: encoder.encode('scraps-cache-sync-rendezvous:v1')
	};
}
export function createPairingRequestKey(code: string): PairingRequestKey {
	const init = cpace.ristretto255.init(pakeInputs(code));
	return {
		ephemeralSecret: bytesToBase64Url(init.ephemeralSecret),
		share: bytesToBase64Url(init.share)
	};
}
function pakeKey(code: string, own: PairingRequestKey, peerShare: string): Uint8Array {
	const inputs = pakeInputs(code);
	const isk = cpace.ristretto255.deriveIskSymmetric({
		ephemeralSecret: base64UrlToBytes(own.ephemeralSecret),
		ownShare: base64UrlToBytes(own.share),
		peerShare: base64UrlToBytes(peerShare),
		sid: inputs.sid,
		ownAD: inputs.CI,
		peerAD: inputs.CI
	});
	return sha256(encoder.encode(`scraps-cache-pake-transfer:v1:${bytesToBase64Url(isk)}`));
}
export function sealSyncKeyForPeer(
	syncKey: string,
	code: string,
	own: PairingRequestKey,
	peerShare: string
): PairingGrant {
	identityFromSyncKey(syncKey);
	const nonce = secureBytes(24);
	const ciphertext = xchacha20poly1305(pakeKey(code, own, peerShare), nonce).encrypt(
		encoder.encode(JSON.stringify({ syncKey }))
	);
	const packed = new Uint8Array(nonce.length + ciphertext.length);
	packed.set(nonce);
	packed.set(ciphertext, nonce.length);
	return { ciphertext: bytesToBase64Url(packed) };
}
export function openSyncKeyFromPeer(
	code: string,
	own: PairingRequestKey,
	peerShare: string,
	grant: PairingGrant
): string {
	const packed = base64UrlToBytes(grant.ciphertext);
	if (packed.length <= 24) throw new Error('Invalid encrypted sync key');
	const decoded = JSON.parse(
		decoder.decode(
			xchacha20poly1305(pakeKey(code, own, peerShare), packed.slice(0, 24)).decrypt(
				packed.slice(24)
			)
		)
	) as { syncKey?: unknown };
	if (typeof decoded.syncKey !== 'string') throw new Error('Invalid encrypted sync key');
	identityFromSyncKey(decoded.syncKey);
	return decoded.syncKey;
}
function syncPayloadKey(syncKey: string): Uint8Array {
	identityFromSyncKey(syncKey);
	return sha256(encoder.encode(`scraps-cache-sync-payload:v1:${syncKey}`));
}

/** Leading byte of a packed envelope. v1 envelopes have no marker and start
 * straight into the nonce, so a v1 nonce beginning 0x02 is indistinguishable
 * here; decryption resolves it, since only one version will authenticate. */
const ENVELOPE_V2 = 2;

/**
 * Ties an envelope to the account and slot it was written for, so the cipher
 * rejects a relay that moves ciphertext between slots or accounts instead of
 * that only failing later, when the decrypted record names its own key.
 */
function syncPayloadAad(syncKey: string, slot: string): Uint8Array {
	return encoder.encode(
		`scraps-cache-sync-envelope:v2:${identityFromSyncKey(syncKey).accountId}:${slot}`
	);
}

export function encryptSyncPayload(syncKey: string, payload: unknown, slot: string): string {
	const nonce = secureBytes(24);
	const ciphertext = xchacha20poly1305(
		syncPayloadKey(syncKey),
		nonce,
		syncPayloadAad(syncKey, slot)
	).encrypt(encoder.encode(JSON.stringify(payload)));
	const packed = new Uint8Array(1 + nonce.length + ciphertext.length);
	packed[0] = ENVELOPE_V2;
	packed.set(nonce, 1);
	packed.set(ciphertext, 1 + nonce.length);
	return bytesToBase64Url(packed);
}

export type OpenedSyncEnvelope = {
	payload: unknown;
	/** True when this opened through the pre-slot-binding path. The caller is
	 * expected to rewrite the record, which is what eventually empties the relay
	 * of unbound envelopes and lets that path be deleted. Reading the version byte
	 * from outside cannot answer this: a v1 nonce starting 0x02 looks like a v2
	 * marker, and only attempting decryption settles it. */
	legacy: boolean;
};

export function decryptSyncEnvelope(
	syncKey: string,
	envelope: string,
	slot: string
): OpenedSyncEnvelope {
	const packed = base64UrlToBytes(envelope);
	const key = syncPayloadKey(syncKey);
	if (packed[0] === ENVELOPE_V2 && packed.length > 25) {
		try {
			return {
				payload: JSON.parse(
					decoder.decode(
						xchacha20poly1305(key, packed.slice(1, 25), syncPayloadAad(syncKey, slot)).decrypt(
							packed.slice(25)
						)
					)
				),
				legacy: false
			};
		} catch {
			// Fall through: a v1 envelope whose nonce happens to open with 0x02.
		}
	}
	// Envelopes written before slot binding existed. This path goes away once no
	// account still has one; until then dropping it would make every record
	// uploaded before the change unreadable.
	if (packed.length <= 24) throw new Error('Invalid encrypted sync envelope');
	return {
		payload: JSON.parse(
			decoder.decode(xchacha20poly1305(key, packed.slice(0, 24)).decrypt(packed.slice(24)))
		),
		legacy: true
	};
}

export function decryptSyncPayload(syncKey: string, envelope: string, slot: string): unknown {
	return decryptSyncEnvelope(syncKey, envelope, slot).payload;
}
