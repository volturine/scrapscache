import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64Url, randomBytes } from '../src/crypto.js';
import { McpSession } from '../src/engine.js';
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

	it('reports the total across workspaces while limiting the combined results', async () => {
		const session = new VaultSession('https://scrapscache.example', [
			workspace('Personal'),
			workspace('Work')
		]);
		let calls = 0;
		const mock = vi.spyOn(McpSession.prototype, 'callTool').mockImplementation(async () => {
			calls++;
			return {
				notes: [{ id: `note-${calls}`, title: `Note ${calls}`, updatedAt: '2026-09-22' }],
				total: 3,
				hasMore: true
			};
		});
		try {
			const result = (await session.callTool('list_notes', { limit: 1 })) as {
				notes: Array<{ workspace: string }>;
				total: number;
				hasMore: boolean;
				workspaces: Array<{ workspace: string; noteCount: number }>;
			};
			expect(result.notes).toHaveLength(1);
			expect(result.total).toBe(6);
			expect(result.hasMore).toBe(true);
			expect(result.notes[0].workspace).toBeTruthy();
			expect(result.workspaces.map((item) => item.noteCount)).toEqual([3, 3]);
		} finally {
			mock.mockRestore();
		}
	});
});
