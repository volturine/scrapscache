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
});
