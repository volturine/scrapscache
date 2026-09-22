import { describe, expect, it, beforeEach } from 'vitest';
import { McpSession, parseChecklistItems } from '../src/engine.js';
import { ScrapscacheSyncClient, type SyncEnvelope } from '../src/syncClient.js';
import { bytesToBase64Url, randomBytes } from '../src/crypto.js';

describe('MCP session and note engine', () => {
	const syncKey = bytesToBase64Url(randomBytes(32));
	let uploadedEnvelopes: SyncEnvelope[] = [];

	const mockSyncClient = {
		getAccountId: () => 'test_account_id',
		getSyncKey: () => syncKey,
		syncDelta: async (cursor: number, uploads: SyncEnvelope[] = [], _deletions: string[] = []) => {
			uploadedEnvelopes.push(...uploads);
			return {
				cursor: cursor + uploads.length,
				envelopes: [],
				conflicts: [],
				hasMore: false,
				reset: false,
				writesAccepted: true
			};
		}
	} as unknown as ScrapscacheSyncClient;

	beforeEach(() => {
		uploadedEnvelopes = [];
	});

	it('correctly parses checklist items from markdown body', () => {
		const body = `Here is my list:
- [ ] First task
- [x] Completed task
* [ ] Bullet check
plain text line`;
		const items = parseChecklistItems(body);
		expect(items).toEqual([
			{ text: 'First task', checked: false },
			{ text: 'Completed task', checked: true },
			{ text: 'Bullet check', checked: false }
		]);
	});

	it('creates a note and encrypts sync envelope', async () => {
		const session = new McpSession(mockSyncClient);
		const result = await session.createNote({
			title: 'Shopping List',
			body: 'Remember to get vegetables',
			checklist: ['Carrots', 'Broccoli'],
			labels: ['Groceries'],
			pinned: true
		});

		expect(result.success).toBe(true);
		expect(result.note.title).toBe('Shopping List');
		expect(result.note.pinned).toBe(true);
		expect(result.note.labels).toEqual(['Groceries']);
		expect(uploadedEnvelopes.length).toBe(1);

		// Read note back
		const note = await session.readNote({ id: result.note.id });
		expect(note.title).toBe('Shopping List');
		expect(note.checklist).toEqual([
			{ text: 'Carrots', checked: false },
			{ text: 'Broccoli', checked: false }
		]);
		expect(note.pinned).toBe(true);
	});

	it('searches notes by query, label, and pinned status', async () => {
		const session = new McpSession(mockSyncClient);

		await session.createNote({
			title: 'Recipe for Soup',
			body: 'Delicious pumpkin soup',
			labels: ['Cooking']
		});

		await session.createNote({
			title: 'Workout plan',
			body: 'Push day routine',
			labels: ['Fitness'],
			pinned: true
		});

		// Search query
		const soupSearch = await session.searchNotes({ query: 'pumpkin' });
		expect(soupSearch.total).toBe(1);
		expect(soupSearch.notes[0].title).toBe('Recipe for Soup');

		// Search label
		const fitnessSearch = await session.searchNotes({ label: 'Fitness' });
		expect(fitnessSearch.total).toBe(1);
		expect(fitnessSearch.notes[0].title).toBe('Workout plan');

		// Filter pinned
		const pinnedOnly = await session.searchNotes({ pinnedOnly: true });
		expect(pinnedOnly.total).toBe(1);
		expect(pinnedOnly.notes[0].title).toBe('Workout plan');
	});

	it('shows matching text in previews and reports when the result limit hides matches', async () => {
		const session = new McpSession(mockSyncClient);
		await session.createNote({
			title: 'First',
			body: `${'before '.repeat(40)}NEEDED FOR V1 later`
		});
		await session.createNote({ title: 'Second', body: 'NEEDED FOR V1 now' });

		const result = await session.searchNotes({ query: 'needed for v1', limit: 1 });
		expect(result.total).toBe(2);
		expect(result.hasMore).toBe(true);
		expect(result.notes).toHaveLength(1);
		expect(result.notes[0].preview.toLowerCase()).toContain('needed for v1');
		expect(result.notes[0].id).toBeTruthy();

		const all = await session.searchNotes({ query: 'needed for v1', limit: 2 });
		expect(all.hasMore).toBe(false);
		expect(all.notes[1].preview.toLowerCase()).toContain('needed for v1');
	});

	it('updates note body, appends tasks, and toggles checklist items', async () => {
		const session = new McpSession(mockSyncClient);

		const created = await session.createNote({
			title: 'Todo List',
			checklist: ['Wash dishes', 'Vacuum floor']
		});

		// Append an item
		await session.updateNote({
			id: created.note.id,
			appendChecklistItems: ['Mow lawn']
		});

		let note = await session.readNote({ id: created.note.id });
		expect(note.checklist.map((c) => c.text)).toEqual(['Wash dishes', 'Vacuum floor', 'Mow lawn']);
		expect(note.checklist.every((c) => !c.checked)).toBe(true);

		// Toggle item to done
		await session.updateNote({
			id: created.note.id,
			toggleChecklistItems: ['Wash dishes']
		});

		note = await session.readNote({ id: created.note.id });
		expect(note.checklist.find((c) => c.text === 'Wash dishes')?.checked).toBe(true);
		expect(note.checklist.find((c) => c.text === 'Vacuum floor')?.checked).toBe(false);

		// Replace entire body, change labels and color
		await session.updateNote({
			id: created.note.id,
			title: 'Updated Todo List',
			body: 'All tasks completed!\n- [x] All done',
			labels: ['Chores'],
			color: 'sage'
		});

		note = await session.readNote({ id: created.note.id });
		expect(note.title).toBe('Updated Todo List');
		expect(note.body).toBe('All tasks completed!\n- [x] All done');
		expect(note.labels).toEqual(['Chores']);
		expect(note.color).toBe('sage');
		expect(note.checklist).toEqual([{ text: 'All done', checked: true }]);
	});

	it('lists tags/labels in the note vault', async () => {
		const session = new McpSession(mockSyncClient);
		await session.createNote({
			title: 'Tagged note',
			labels: ['Work', 'Ideas']
		});

		const labels = await session.listLabels();
		const names = labels.labels.map((l) => l.name).sort();
		expect(names).toEqual(['Ideas', 'Work']);
	});

	it('lists the named workspace for a single-workspace connection', async () => {
		const session = new McpSession(mockSyncClient, 'Personal');

		expect(await session.callTool('list_workspaces', {})).toEqual({
			workspaces: [{ workspace: 'Personal' }]
		});
	});

	it('does not dispatch obsolete alias tool names', async () => {
		const session = new McpSession(mockSyncClient);
		await expect(session.callTool('read_note', { id: 'note' })).rejects.toThrow(
			'Unknown tool: read_note'
		);
		await expect(session.callTool('list_recent_notes', {})).rejects.toThrow(
			'Unknown tool: list_recent_notes'
		);
	});
});
