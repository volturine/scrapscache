import { describe, expect, it } from 'vitest';
import { parseHandshakeGrant } from '../src/grant.js';
import { bytesToBase64Url, identityFromSyncKey, randomBytes } from '../src/crypto.js';

describe('handshake workspace grant', () => {
	it('keeps a raw sync key as one workspace', () => {
		const syncKey = bytesToBase64Url(randomBytes(32));
		expect(parseHandshakeGrant(syncKey)).toEqual([
			{ name: 'Workspace', syncKey, accountId: identityFromSyncKey(syncKey).accountId }
		]);
	});

	it('reads several named workspaces and drops a repeated key', () => {
		const home = bytesToBase64Url(randomBytes(32));
		const work = bytesToBase64Url(randomBytes(32));
		const granted = parseHandshakeGrant(
			JSON.stringify({
				v: 1,
				workspaces: [
					{ name: 'Home', syncKey: home },
					{ name: 'Work', syncKey: work },
					{ name: 'Home', syncKey: home }
				]
			})
		);
		expect(granted.map((workspace) => workspace.name)).toEqual(['Home', 'Work']);
		expect(granted[0].accountId).toBe(identityFromSyncKey(home).accountId);
		expect(granted[1].accountId).toBe(identityFromSyncKey(work).accountId);
	});
});
