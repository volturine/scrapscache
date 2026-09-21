import { describe, expect, it } from 'vitest';
import { parseHandshakeGrant } from '../src/grant.js';
import { identityFromSyncKey } from '../src/crypto.js';

describe('handshake workspace grant', () => {
	it('keeps a raw sync key as one workspace', () => {
		const syncKey = 'k-one';
		expect(parseHandshakeGrant(syncKey)).toEqual([
			{ name: 'Workspace', syncKey, accountId: identityFromSyncKey(syncKey).accountId }
		]);
	});

	it('reads several named workspaces and drops a repeated key', () => {
		const home = 'k-home';
		const work = 'k-work';
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
