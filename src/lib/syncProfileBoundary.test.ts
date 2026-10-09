/**
 * The boundary between two workspaces, below the application.
 *
 * Everything a workspace stores on the relay is sealed with its own sync key
 * and filed under the account that key derives. Even handed another
 * workspace's envelope, a workspace cannot open it, and it never asks for one:
 * the two live under different account ids.
 */

import { describe, expect, it } from 'vitest';
import { unboundSyncEnvelope } from '../tests/unboundEnvelope';
import {
	createSyncIdentity,
	decryptSyncPayload,
	encryptSyncPayload,
	identityFromSyncKey,
	signSyncChallenge
} from './syncPairing';

const mine = createSyncIdentity();
const theirs = createSyncIdentity();

describe('two workspaces are two accounts', () => {
	it('derives a different account id from each sync key', () => {
		expect(mine.syncKey).not.toBe(theirs.syncKey);
		expect(mine.accountId).not.toBe(theirs.accountId);
	});

	it('derives the same account id from the same key, on any device', () => {
		expect(identityFromSyncKey(mine.syncKey).accountId).toBe(mine.accountId);
	});

	it('refuses to sign for an account its key does not derive', () => {
		const challenge = 'a-relay-challenge';
		expect(signSyncChallenge(mine.syncKey, mine.accountId, challenge)).toEqual(expect.any(String));
		// Not a weaker signature: a workspace cannot even ask to be another one.
		expect(() => signSyncChallenge(theirs.syncKey, mine.accountId, challenge)).toThrow();
	});
});

describe('one workspace cannot read another workspace', () => {
	const secret = { notes: [{ id: 'n1', title: 'private' }] };
	const slot = 'a'.repeat(64);
	const otherSlot = 'b'.repeat(64);

	it('cannot open an envelope sealed by the other', () => {
		const sealed = encryptSyncPayload(mine.syncKey, secret, slot);
		expect(() => decryptSyncPayload(theirs.syncKey, sealed, slot)).toThrow();
	});

	it('opens its own', () => {
		const sealed = encryptSyncPayload(mine.syncKey, secret, slot);
		expect(decryptSyncPayload(mine.syncKey, sealed, slot)).toEqual(secret);
	});

	it('seals the same notes differently for each workspace', () => {
		expect(encryptSyncPayload(mine.syncKey, secret, slot)).not.toBe(
			encryptSyncPayload(theirs.syncKey, secret, slot)
		);
	});

	it('refuses an envelope the relay moved to a different slot', () => {
		const sealed = encryptSyncPayload(mine.syncKey, secret, slot);
		expect(() => decryptSyncPayload(mine.syncKey, sealed, otherSlot)).toThrow();
	});
});

describe('envelopes without a slot binding', () => {
	const slot = 'a'.repeat(64);
	const secret = { kind: 'note', value: { id: 'old' } };

	it('are refused, even under the account key that sealed them', () => {
		expect(() =>
			decryptSyncPayload(mine.syncKey, unboundSyncEnvelope(mine.syncKey, secret), slot)
		).toThrow();
	});

	it('are refused when the nonce happens to start with the v2 marker', () => {
		const nonce = crypto.getRandomValues(new Uint8Array(24));
		nonce[0] = 2;
		expect(() =>
			decryptSyncPayload(mine.syncKey, unboundSyncEnvelope(mine.syncKey, secret, nonce), slot)
		).toThrow();
	});
});
