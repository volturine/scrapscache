import { describe, expect, it, vi } from 'vitest';
import { handleJsonRpcMessage } from '../src/protocol.js';

function sessionWithToolResult(toolResult: unknown) {
	return {
		touch: vi.fn(),
		runExclusive: async <T>(operation: () => Promise<T>) => operation(),
		callTool: vi.fn().mockResolvedValue(toolResult),
		listResources: async () => ({ resources: [] }),
		readResource: async () => ({})
	};
}

describe('MCP JSON-RPC tool results', () => {
	it('marks partial workspace failures as tool errors', async () => {
		const session = sessionWithToolResult({
			notes: [],
			total: 0,
			workspaces: [{ workspace: 'Ready', noteCount: 0 }],
			errors: [{ workspace: 'Unavailable', error: 'account not found' }]
		});

		const response = await handleJsonRpcMessage(session, {
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name: 'list_notes', arguments: {} }
		});
		const result = (response as { result: { isError: boolean; content: [{ text: string }] } })
			.result;

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('Unavailable');
	});
});
