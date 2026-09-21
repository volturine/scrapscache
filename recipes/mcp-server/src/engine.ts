import { decryptSyncPayload, encryptSyncPayload, computeSlot, randomOpaqueId } from './crypto.js';
import { ScrapscacheSyncClient, type SyncEnvelope } from './syncClient.js';

export type Note = {
	id: string;
	title: string;
	body: string;
	labels: string[];
	color: string;
	pinned: boolean;
	archived: boolean;
	trash?: boolean;
	createdAt: number;
	updatedAt: number;
	images?: unknown[];
};

export type Label = {
	id: string;
	name: string;
	createdAt?: number;
	updatedAt?: number;
};

export type SyncRecordPayload =
	| { kind: 'note'; value: Note }
	| { kind: 'attachment'; value: unknown }
	| { kind: 'label'; value: Label }
	| { kind: 'board'; value: unknown }
	| { kind: 'note-tombstone'; id: string; deletedAt: number }
	| { kind: 'label-tombstone'; id: string; deletedAt: number }
	| { kind: 'board-tombstone'; id: string; deletedAt: number }
	| { kind: 'profile-meta'; value: { name: string } };

export const CHECK_RE = /^(\s*)(?:[-*•]\s+)?\[([xX ]?)\]\s*(.*)$/;

export type ParsedChecklistItem = {
	text: string;
	checked: boolean;
};

export function parseChecklistItems(body: string): ParsedChecklistItem[] {
	const items: ParsedChecklistItem[] = [];
	const lines = body.split('\n');
	for (const line of lines) {
		const match = line.match(CHECK_RE);
		if (match) {
			const checked = match[2].toLowerCase() === 'x';
			const text = match[3].trim();
			items.push({ text, checked });
		}
	}
	return items;
}

export const MCP_TOOLS = [
	{
		name: 'search_notes',
		description:
			'Search encrypted notes by keyword query, label name, or pinned state. Returns matching note summaries.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Search term to match within note title and body' },
				label: { type: 'string', description: 'Optional label name to filter notes' },
				pinnedOnly: { type: 'boolean', description: 'Filter only pinned notes' },
				limit: { type: 'number', description: 'Max number of notes to return (default 20, max 50)' }
			}
		}
	},
	{
		name: 'list_notes',
		description: 'List recent active notes ordered by latest modification date.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'number', description: 'Max notes to list (default 20, max 50)' }
			}
		}
	},
	{
		name: 'list_recent_notes',
		description: 'Alias for list_notes. Returns recently modified notes.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'number', description: 'Max notes to list (default 20, max 50)' }
			}
		}
	},
	{
		name: 'read_note',
		description:
			'Read the full contents of a note by its ID, including title, body text, checklist tasks, and labels.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'The unique ID of the note' }
			},
			required: ['id']
		}
	},
	{
		name: 'open_note',
		description: 'Alias for read_note. Read the full contents of a note by its ID.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'The unique ID of the note' }
			},
			required: ['id']
		}
	},
	{
		name: 'create_note',
		description:
			'Create a new note in Scraps Cache. Supports title, text body, checklist items, labels, and pinned status.',
		inputSchema: {
			type: 'object',
			properties: {
				title: { type: 'string', description: 'Title of the note' },
				body: { type: 'string', description: 'Body text content' },
				checklist: {
					type: 'array',
					items: { type: 'string' },
					description: 'Checklist task items to add'
				},
				labels: {
					type: 'array',
					items: { type: 'string' },
					description: 'Labels to associate with the note'
				},
				pinned: { type: 'boolean', description: 'Whether to pin the note to the top' },
				color: {
					type: 'string',
					description: 'Color palette name (e.g. "default", "sand", "sage", "clay", "lavender")'
				}
			}
		}
	},
	{
		name: 'update_note',
		description:
			'Update an existing note by ID. Can replace full body text, update title, append text or checklist items, toggle checklist tasks, update labels or color, or change pinned/archived state.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'ID of the note to update' },
				title: { type: 'string', description: 'New title for the note' },
				body: { type: 'string', description: 'New body text to replace the entire note body' },
				appendBody: { type: 'string', description: 'Text to append to existing note body' },
				appendChecklistItems: {
					type: 'array',
					items: { type: 'string' },
					description: 'New checklist tasks to append'
				},
				toggleChecklistItems: {
					type: 'array',
					items: { type: 'string' },
					description: 'Checklist task item texts to toggle between done and undone'
				},
				labels: {
					type: 'array',
					items: { type: 'string' },
					description: 'Replace note labels with these label names'
				},
				color: {
					type: 'string',
					description:
						'Change note color palette name (e.g. "default", "sand", "sage", "clay", "lavender")'
				},
				pinned: { type: 'boolean', description: 'Pin or unpin the note' },
				archived: { type: 'boolean', description: 'Archive or unarchive the note' }
			},
			required: ['id']
		}
	},
	{
		name: 'list_labels',
		description: 'List all available tags/labels in the note vault.',
		inputSchema: {
			type: 'object',
			properties: {}
		}
	}
];

export class McpSession {
	private readonly client: ScrapscacheSyncClient;
	private readonly syncKey: string;
	private readonly notes = new Map<string, Note>();
	private readonly labels = new Map<string, Label>();
	private readonly syncedSlots = new Map<string, SyncEnvelope>();
	private cursor = 0;
	private hydrated = false;
	private operationQueue: Promise<void> = Promise.resolve();
	private sseListeners = new Set<(event: string, data: unknown) => void>();
	private lastActiveAt = Date.now();

	constructor(client: ScrapscacheSyncClient) {
		this.client = client;
		this.syncKey = client.getSyncKey();
	}

	getAccountId(): string {
		return this.client.getAccountId();
	}

	touch(): void {
		this.lastActiveAt = Date.now();
	}

	getLastActiveAt(): number {
		return this.lastActiveAt;
	}

	addSseListener(listener: (event: string, data: unknown) => void): () => void {
		this.sseListeners.add(listener);
		return () => {
			this.sseListeners.delete(listener);
		};
	}

	broadcast(event: string, data: unknown): void {
		for (const listener of this.sseListeners) {
			try {
				listener(event, data);
			} catch {
				// Ignore listener errors
			}
		}
	}

	close(): void {
		this.broadcast('close', { reason: 'MCP session ended' });
		this.sseListeners.clear();
	}

	async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.operationQueue;
		let release!: () => void;
		this.operationQueue = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await operation();
		} finally {
			release();
		}
	}

	private applyEnvelopes(envelopes: SyncEnvelope[]): void {
		for (const envelope of envelopes) {
			try {
				const payload = decryptSyncPayload<SyncRecordPayload>(this.syncKey, envelope.ciphertext);
				if (!payload || typeof payload !== 'object') continue;
				if (payload.kind === 'note') {
					this.notes.set(payload.value.id, payload.value);
					this.syncedSlots.set(`note:${payload.value.id}`, envelope);
				} else if (payload.kind === 'note-tombstone') {
					this.notes.delete(payload.id);
					this.syncedSlots.set(`note:${payload.id}`, envelope);
				} else if (payload.kind === 'label') {
					this.labels.set(payload.value.id, payload.value);
					this.syncedSlots.set(`label:${payload.value.id}`, envelope);
				} else if (payload.kind === 'label-tombstone') {
					this.labels.delete(payload.id);
					this.syncedSlots.set(`label:${payload.id}`, envelope);
				}
			} catch {
				// Ignore records not intended for this sync key
			}
		}
	}

	private async downloadChanges(): Promise<void> {
		let hasMore = true;
		while (hasMore) {
			const result = await this.client.syncDelta(this.cursor, [], [], 100);
			if (result.reset) {
				this.notes.clear();
				this.labels.clear();
				this.syncedSlots.clear();
				this.cursor = 0;
			}
			this.applyEnvelopes([...result.envelopes, ...result.conflicts]);
			this.cursor = result.cursor;
			hasMore = result.hasMore;
		}
		this.hydrated = true;
	}

	async ensureHydrated(): Promise<void> {
		this.touch();
		await this.downloadChanges();
	}

	private async commitUploads(uploads: SyncEnvelope[]): Promise<void> {
		for (let attempt = 0; attempt < 4; attempt += 1) {
			const result = await this.client.syncDelta(this.cursor, uploads, [], 100);
			if (result.reset) {
				this.notes.clear();
				this.labels.clear();
				this.syncedSlots.clear();
				this.cursor = 0;
			}
			this.applyEnvelopes([...result.envelopes, ...result.conflicts]);
			this.cursor = result.cursor;
			if (result.hasMore) {
				await this.downloadChanges();
			}
			if (result.writesAccepted) {
				return;
			}
			// Update expected IDs for retrying conflict
			for (const upload of uploads) {
				const current = [...this.syncedSlots.values()].find((slot) => slot.slot === upload.slot);
				upload.expectedId = current?.id ?? null;
			}
		}
		throw new Error('Concurrent modification conflict: write could not be committed');
	}

	private getLabelNames(labelIds: string[] = []): string[] {
		return labelIds
			.map((id) => this.labels.get(id)?.name)
			.filter((name): name is string => typeof name === 'string');
	}

	private resolveLabelIds(names: string[]): string[] {
		const ids: string[] = [];
		for (const rawName of names) {
			const name = rawName.trim();
			if (!name) continue;
			let found = [...this.labels.values()].find(
				(l) => l.name.toLowerCase() === name.toLowerCase()
			);
			if (found) {
				ids.push(found.id);
			} else {
				// We can refer to or create label
				const newLabel: Label = {
					id: randomOpaqueId(),
					name,
					createdAt: Date.now(),
					updatedAt: Date.now()
				};
				this.labels.set(newLabel.id, newLabel);
				ids.push(newLabel.id);
			}
		}
		return ids;
	}

	async searchNotes(args: {
		query?: string;
		label?: string;
		pinnedOnly?: boolean;
		limit?: number;
	}) {
		await this.ensureHydrated();
		const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
		const query = args.query?.trim().toLowerCase();

		let targetLabelId: string | undefined;
		if (args.label) {
			const targetName = args.label.trim().toLowerCase();
			const found = [...this.labels.values()].find((l) => l.name.toLowerCase() === targetName);
			if (!found) {
				return { notes: [], total: 0 };
			}
			targetLabelId = found.id;
		}

		const results: Array<{
			id: string;
			title: string;
			preview: string;
			labels: string[];
			pinned: boolean;
			color: string;
			updatedAt: string;
		}> = [];

		const allNotes = [...this.notes.values()]
			.filter((n) => !n.trash && !n.archived)
			.sort((a, b) => b.updatedAt - a.updatedAt);

		for (const note of allNotes) {
			if (args.pinnedOnly && !note.pinned) continue;
			if (targetLabelId && !note.labels?.includes(targetLabelId)) continue;

			if (query) {
				const titleMatch = note.title?.toLowerCase().includes(query);
				const bodyMatch = note.body?.toLowerCase().includes(query);
				if (!titleMatch && !bodyMatch) continue;
			}

			const preview = (note.body || '').slice(0, 150).replace(/\n+/g, ' ').trim();
			results.push({
				id: note.id,
				title: note.title || 'Untitled',
				preview,
				labels: this.getLabelNames(note.labels),
				pinned: !!note.pinned,
				color: note.color || 'default',
				updatedAt: new Date(note.updatedAt).toISOString()
			});

			if (results.length >= limit) break;
		}

		return {
			notes: results,
			total: results.length
		};
	}

	async listNotes(args: { limit?: number }) {
		return this.searchNotes({ limit: args.limit });
	}

	async readNote(args: { id: string }) {
		await this.ensureHydrated();
		const note = this.notes.get(args.id);
		if (!note || note.trash) {
			throw new Error(`Note not found with id: ${args.id}`);
		}

		const checklist = parseChecklistItems(note.body || '');
		return {
			id: note.id,
			title: note.title || '',
			body: note.body || '',
			checklist,
			labels: this.getLabelNames(note.labels),
			pinned: !!note.pinned,
			archived: !!note.archived,
			color: note.color || 'default',
			createdAt: new Date(note.createdAt).toISOString(),
			updatedAt: new Date(note.updatedAt).toISOString()
		};
	}

	async createNote(args: {
		title?: string;
		body?: string;
		checklist?: string[];
		labels?: string[];
		pinned?: boolean;
		color?: string;
	}) {
		await this.ensureHydrated();
		const now = Date.now();
		const noteId = randomOpaqueId();

		let noteBody = args.body || '';
		if (args.checklist && args.checklist.length > 0) {
			const checklistLines = args.checklist.map((item) => `- [ ] ${item.trim()}`).join('\n');
			noteBody = noteBody ? `${noteBody}\n${checklistLines}` : checklistLines;
		}

		const labelIds = args.labels ? this.resolveLabelIds(args.labels) : [];

		const note: Note = {
			id: noteId,
			title: args.title?.trim() || '',
			body: noteBody,
			labels: labelIds,
			color: args.color || 'default',
			pinned: !!args.pinned,
			archived: false,
			createdAt: now,
			updatedAt: now
		};

		const recordKey = `note:${noteId}`;
		const payload: SyncRecordPayload = { kind: 'note', value: note };
		const ciphertext = encryptSyncPayload(this.syncKey, payload);
		const slot = computeSlot(this.syncKey, recordKey);

		const envelope: SyncEnvelope = {
			id: randomOpaqueId(),
			slot,
			ciphertext,
			expectedId: null
		};

		await this.commitUploads([envelope]);
		this.notes.set(note.id, note);

		return {
			success: true,
			note: {
				id: note.id,
				title: note.title,
				labels: this.getLabelNames(note.labels),
				pinned: note.pinned
			}
		};
	}

	async updateNote(args: {
		id: string;
		title?: string;
		body?: string;
		appendBody?: string;
		appendChecklistItems?: string[];
		toggleChecklistItems?: string[];
		labels?: string[];
		color?: string;
		pinned?: boolean;
		archived?: boolean;
	}) {
		await this.ensureHydrated();
		const existing = this.notes.get(args.id);
		if (!existing || existing.trash) {
			throw new Error(`Note not found with id: ${args.id}`);
		}

		let updatedBody = args.body !== undefined ? args.body : existing.body || '';

		if (args.appendBody) {
			updatedBody = updatedBody ? `${updatedBody}\n${args.appendBody}` : args.appendBody;
		}

		if (args.appendChecklistItems && args.appendChecklistItems.length > 0) {
			const lines = args.appendChecklistItems.map((item) => `- [ ] ${item.trim()}`).join('\n');
			updatedBody = updatedBody ? `${updatedBody}\n${lines}` : lines;
		}

		if (args.toggleChecklistItems && args.toggleChecklistItems.length > 0) {
			const targets = new Set(args.toggleChecklistItems.map((t) => t.trim().toLowerCase()));
			const lines = updatedBody.split('\n');
			const newLines = lines.map((line) => {
				const match = line.match(CHECK_RE);
				if (!match) return line;
				const itemText = match[3].trim().toLowerCase();
				if (targets.has(itemText)) {
					const isChecked = match[2].toLowerCase() === 'x';
					const newBox = isChecked ? '[ ]' : '[x]';
					return `${match[1]}- ${newBox} ${match[3]}`;
				}
				return line;
			});
			updatedBody = newLines.join('\n');
		}

		const labelIds =
			args.labels !== undefined ? this.resolveLabelIds(args.labels) : existing.labels;

		const updatedNote: Note = {
			...existing,
			title: args.title !== undefined ? args.title : existing.title,
			body: updatedBody,
			labels: labelIds,
			color: args.color !== undefined ? args.color : existing.color,
			pinned: args.pinned !== undefined ? args.pinned : existing.pinned,
			archived: args.archived !== undefined ? args.archived : existing.archived,
			updatedAt: Date.now()
		};

		const recordKey = `note:${existing.id}`;
		const payload: SyncRecordPayload = { kind: 'note', value: updatedNote };
		const ciphertext = encryptSyncPayload(this.syncKey, payload);
		const slot = computeSlot(this.syncKey, recordKey);
		const currentEnvelope = this.syncedSlots.get(recordKey);

		const envelope: SyncEnvelope = {
			id: randomOpaqueId(),
			slot,
			ciphertext,
			expectedId: currentEnvelope?.id ?? null
		};

		await this.commitUploads([envelope]);
		this.notes.set(updatedNote.id, updatedNote);

		return {
			success: true,
			note: {
				id: updatedNote.id,
				title: updatedNote.title,
				labels: this.getLabelNames(updatedNote.labels),
				pinned: updatedNote.pinned,
				archived: updatedNote.archived
			}
		};
	}

	async listLabels() {
		await this.ensureHydrated();
		const labels = [...this.labels.values()].map((l) => ({
			id: l.id,
			name: l.name
		}));
		return { labels };
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
		this.touch();
		switch (name) {
			case 'search_notes':
				return this.searchNotes(args as Parameters<McpSession['searchNotes']>[0]);
			case 'list_notes':
			case 'list_recent_notes':
				return this.listNotes(args as Parameters<McpSession['listNotes']>[0]);
			case 'read_note':
			case 'open_note':
				return this.readNote(args as { id: string });
			case 'create_note':
				return this.createNote(args as Parameters<McpSession['createNote']>[0]);
			case 'update_note':
				return this.updateNote(args as Parameters<McpSession['updateNote']>[0]);
			case 'list_labels':
				return this.listLabels();
			default:
				throw new Error(`Unknown tool: ${name}`);
		}
	}

	async listResources() {
		await this.ensureHydrated();
		const resources = [...this.notes.values()]
			.filter((n) => !n.trash)
			.map((note) => ({
				uri: `scrapscache://notes/${note.id}`,
				name: note.title || 'Untitled note',
				mimeType: 'text/markdown'
			}));
		return { resources };
	}

	async readResource(uri: string) {
		const match = uri.match(/^scrapscache:\/\/notes\/([^/]+)$/);
		if (!match) {
			throw new Error(`Invalid resource URI format: ${uri}`);
		}
		const note = await this.readNote({ id: match[1] });
		return {
			contents: [
				{
					uri,
					mimeType: 'text/markdown',
					text: `# ${note.title}\n\n${note.body}`
				}
			]
		};
	}
}
