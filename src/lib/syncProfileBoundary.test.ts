/**
 * The boundary between two workspaces, below the application.
 *
 * Everything a workspace stores on the relay is sealed with its own sync key
 * and filed under the account that key derives. Even handed another
 * workspace's envelope, a workspace cannot open it, and it never asks for one:
 * the two live under different account ids.
 */

import { describe, expect, it } from 'vitest';
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

	it('cannot open an envelope sealed by the other', () => {
		const sealed = encryptSyncPayload(mine.syncKey, secret);
		expect(() => decryptSyncPayload(theirs.syncKey, sealed)).toThrow();
	});

	it('opens its own', () => {
		const sealed = encryptSyncPayload(mine.syncKey, secret);
		expect(decryptSyncPayload(mine.syncKey, sealed)).toEqual(secret);
	});

	it('seals the same notes differently for each workspace', () => {
		expect(encryptSyncPayload(mine.syncKey, secret)).not.toBe(
			encryptSyncPayload(theirs.syncKey, secret)
		);
	});
});
