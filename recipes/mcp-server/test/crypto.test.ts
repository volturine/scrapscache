import { describe, expect, it } from 'vitest';
import {
	identityFromSyncKey,
	signSyncChallenge,
	encryptSyncPayload,
	decryptSyncPayload,
	computeSlot,
	randomBytes,
	bytesToBase64Url
} from '../src/crypto.js';

describe('MCP crypto primitives', () => {
	const sampleSyncKey = bytesToBase64Url(randomBytes(32));

	it('derives a consistent account identity from a sync key', () => {
		const id1 = identityFromSyncKey(sampleSyncKey);
		const id2 = identityFromSyncKey(sampleSyncKey);
		expect(id1.accountId).toBe(id2.accountId);
		expect(id1.authPublicKey).toBe(id2.authPublicKey);
		expect(id1.accountId.length).toBeGreaterThan(10);
	});

	it('signs and verifies a sync challenge', () => {
		const identity = identityFromSyncKey(sampleSyncKey);
		const challenge = 'test-challenge-nonce-123';
		const sig = signSyncChallenge(sampleSyncKey, identity.accountId, challenge);
		expect(typeof sig).toBe('string');
		expect(sig.length).toBeGreaterThan(20);
	});

	it('encrypts and decrypts payloads accurately', () => {
		const payload = {
			kind: 'note',
			value: {
				id: 'test-123',
				title: 'Encrypted Note',
				body: 'Top secret thoughts'
			}
		};

		const slot = computeSlot(sampleSyncKey, 'note:test-123');
		const ciphertext = encryptSyncPayload(sampleSyncKey, payload, slot);
		expect(typeof ciphertext).toBe('string');
		expect(ciphertext).not.toContain('Encrypted Note');

		const decrypted = decryptSyncPayload<typeof payload>(sampleSyncKey, ciphertext, slot);
		expect(decrypted).toEqual(payload);
		expect(() => decryptSyncPayload(sampleSyncKey, ciphertext, 'f'.repeat(64))).toThrow();
	});

	it('computes deterministic slot identifiers', () => {
		const slot1 = computeSlot(sampleSyncKey, 'note:abc');
		const slot2 = computeSlot(sampleSyncKey, 'note:abc');
		const slot3 = computeSlot(sampleSyncKey, 'note:def');
		expect(slot1).toBe(slot2);
		expect(slot1).not.toBe(slot3);
		expect(slot1).toMatch(/^[a-f0-9]{64}$/);
	});
});
