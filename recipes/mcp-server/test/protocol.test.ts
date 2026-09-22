import { describe, expect, it, vi } from 'vitest';
import { handleJsonRpcMessage } from '../src/protocol.js';

function sessionWithToolResult(toolResult: unknown, workspaceCount = 1) {
	return {
		touch: vi.fn(),
		getWorkspaceCount: () => workspaceCount,
		runExclusive: async <T>(operation: () => Promise<T>) => operation(),
		callTool: vi.fn().mockResolvedValue(toolResult),
		listResources: async () => ({ resources: [] }),
		readResource: async () => ({})
	};
}

describe('MCP JSON-RPC tool results', () => {
	it('advertises one canonical tool per action and only exposes workspace for multi-workspace grants', async () => {
		for (const workspaceCount of [1, 2, 1]) {
			const response = await handleJsonRpcMessage(sessionWithToolResult({}, workspaceCount), {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list'
			});
			const tools = (
				response as {
					result: {
						tools: Array<{
							name: string;
							inputSchema: { properties: Record<string, unknown>; required?: string[] };
							annotations?: { readOnlyHint?: boolean };
							outputSchema?: object;
						}>;
					};
				}
			).result.tools;
			const names = tools.map((tool) => tool.name);
			expect(names).toContain('open_note');
			expect(names).not.toContain('read_note');
			expect(names).not.toContain('list_recent_notes');
			expect(
				tools.find((tool) => tool.name === 'open_note')?.inputSchema.properties
			).toHaveProperty('id');
			expect(
				'workspace' in tools.find((tool) => tool.name === 'open_note')!.inputSchema.properties
			).toBe(workspaceCount > 1);
			expect(tools.find((tool) => tool.name === 'search_notes')?.annotations?.readOnlyHint).toBe(
				true
			);
			expect(tools.find((tool) => tool.name === 'search_notes')?.outputSchema).toBeDefined();
			expect(tools.find((tool) => tool.name === 'create_note')?.inputSchema.required).toEqual(
				workspaceCount > 1 ? ['workspace'] : undefined
			);
		}
	});

	it('returns structured data and text fallback for a successful tool call', async () => {
		const note = { id: 'note-1', title: 'Example', body: 'Hello', checklist: [], labels: [] };
		const response = await handleJsonRpcMessage(sessionWithToolResult(note), {
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/call',
			params: { name: 'open_note', arguments: { id: 'note-1' } }
		});
		const result = (
			response as {
				result: { structuredContent: unknown; content: [{ text: string }]; isError: boolean };
			}
		).result;
		expect(result.structuredContent).toEqual(note);
		expect(JSON.parse(result.content[0].text)).toEqual(note);
		expect(result.isError).toBe(false);
	});

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
