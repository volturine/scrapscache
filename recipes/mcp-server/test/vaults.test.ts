import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64Url, randomBytes } from '../src/crypto.js';
import { VaultSession } from '../src/vaults.js';

function workspace(name: string) {
	const syncKey = bytesToBase64Url(randomBytes(32));
	return {
		name,
		syncKey,
		accountId: 'account-' + name.toLowerCase()
	};
}

describe('multi-workspace MCP sessions', () => {
	it('lists the names in a multi-workspace grant without contacting the relay', async () => {
		const session = new VaultSession('https://scrapscache.example', [
			workspace('Personal'),
			workspace('Work')
		]);

		expect(await session.callTool('list_workspaces', {})).toEqual({
			workspaces: [{ workspace: 'Personal' }, { workspace: 'Work' }]
		});
	});

	it('fails instead of returning an empty result when every workspace is unavailable', async () => {
		const session = new VaultSession('https://scrapscache.example', [
			workspace('Personal'),
			workspace('Work')
		]);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('account not found', { status: 404 }))
		);

		await expect(session.callTool('list_notes', {})).rejects.toThrow(
			'No granted workspaces are available'
		);
	});
});
