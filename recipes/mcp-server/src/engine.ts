import { decryptSyncPayload, encryptSyncPayload, computeSlot, randomOpaqueId } from './crypto.js';
import { ScrapscacheSyncClient, type SyncEnvelope, type SyncResult } from './syncClient.js';
import {
	applyNoteEdit,
	createEditContext,
	mergeTwoLabels,
	mergeTwoNotes,
	NOTE_FIELDS,
	SyncClock,
	touchNoteFields,
	type Label,
	type Note as ModelNote,
	type NoteColor,
	type NotePatch
} from '../../../src/lib/model/index.js';

/** Legacy MCP-created records used `trash`; keep reading them while they migrate. */
export type Note = ModelNote & { trash?: boolean };
export type { Label };

export type SyncRecordPayload =
	| { kind: 'note'; value: Note }
	| { kind: 'attachment'; value: unknown }
	| { kind: 'label'; value: Label }
	| { kind: 'board'; value: unknown }
	| { kind: 'note-tombstone'; id: string; deletedAt: number }
	| { kind: 'label-tombstone'; id: string; deletedAt: number }
	| { kind: 'board-tombstone'; id: string; deletedAt: number }
	| { kind: 'profile-meta'; value: { name: string } };

type WritableRecord = { kind: 'note'; value: Note } | { kind: 'label'; value: Label };

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

const RFC3339_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

function reminderTimestamp(value: unknown): number | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (typeof value !== 'string' || !RFC3339_DATETIME_RE.test(value)) {
		throw new Error(
			'Reminder must be an ISO 8601 timestamp with a timezone, or null to remove it.'
		);
	}

	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) {
		throw new Error('Reminder must be a valid ISO 8601 timestamp with a timezone.');
	}
	return timestamp;
}

const READ_ONLY_ANNOTATIONS = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true
};

const NOTE_LIST_OUTPUT_SCHEMA = {
	type: 'object',
	properties: {
		notes: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					title: { type: 'string' },
					preview: { type: 'string' },
					workspace: { type: 'string' }
				},
				required: ['id', 'title', 'preview']
			}
		},
		total: { type: 'integer', description: 'Number of matching notes before the limit' },
		hasMore: { type: 'boolean', description: 'Whether additional notes matched' }
	},
	required: ['notes', 'total', 'hasMore']
};

const NOTE_MUTATION_OUTPUT_SCHEMA = {
	type: 'object',
	properties: {
		success: { type: 'boolean' },
		note: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				title: { type: 'string' },
				labels: { type: 'array', items: { type: 'string' } },
				pinned: { type: 'boolean' },
				archived: { type: 'boolean' },
				reminder: {
					type: ['string', 'null'],
					format: 'date-time',
					description: 'ISO 8601 reminder date and time, or null if no reminder is set.'
				}
			},
			required: ['id', 'title', 'labels', 'pinned', 'reminder']
		}
	},
	required: ['success', 'note']
};

export const MCP_TOOLS = [
	{
		name: 'search_notes',
		description:
			'Find active notes by words in their title or body, label, or pinned state. Returns IDs and short previews, not full notes. Use open_note with a returned ID to read a note; refine the query if hasMore is true.',
		annotations: READ_ONLY_ANNOTATIONS,
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Search term to match within note title and body' },
				label: { type: 'string', description: 'Optional label name to filter notes' },
				pinnedOnly: { type: 'boolean', description: 'Filter only pinned notes' },
				limit: {
					type: 'integer',
					minimum: 1,
					maximum: 50,
					description: 'Maximum results to return (default 20, max 50)'
				}
			}
		},
		outputSchema: NOTE_LIST_OUTPUT_SCHEMA
	},
	{
		name: 'list_notes',
		description:
			'Find recently modified active notes. Returns IDs and short previews, not full notes. Use open_note with a returned ID to read one.',
		annotations: READ_ONLY_ANNOTATIONS,
		inputSchema: {
			type: 'object',
			properties: {
				limit: {
					type: 'integer',
					minimum: 1,
					maximum: 50,
					description: 'Maximum results to return (default 20, max 50)'
				}
			}
		},
		outputSchema: NOTE_LIST_OUTPUT_SCHEMA
	},
	{
		name: 'list_workspaces',
		description: 'List the workspaces granted to this MCP connection.',
		annotations: READ_ONLY_ANNOTATIONS,
		inputSchema: {
			type: 'object',
			properties: {}
		},
		outputSchema: {
			type: 'object',
			properties: {
				workspaces: {
					type: 'array',
					items: {
						type: 'object',
						properties: { workspace: { type: 'string' } },
						required: ['workspace']
					}
				}
			},
			required: ['workspaces']
		}
	},
	{
		name: 'open_note',
		description:
			'Read the full plaintext body, checklist, labels, reminder, and metadata of one note. Pass an ID returned by search_notes or list_notes.',
		annotations: READ_ONLY_ANNOTATIONS,
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'Note ID returned by search_notes or list_notes' }
			},
			required: ['id']
		},
		outputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				title: { type: 'string' },
				body: { type: 'string' },
				checklist: { type: 'array', items: { type: 'object' } },
				labels: { type: 'array', items: { type: 'string' } },
				reminder: {
					type: ['string', 'null'],
					format: 'date-time',
					description:
						'Reminder date and time as an ISO 8601 timestamp, or null if no reminder is set.'
				},
				workspace: { type: 'string' }
			},
			required: ['id', 'title', 'body', 'checklist', 'labels', 'reminder']
		}
	},
	{
		name: 'create_note',
		description:
			'Create a new note in Scraps Cache. Supports title, text body, checklist items, labels, a reminder, and pinned status.',
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
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
				reminder: {
					type: 'string',
					format: 'date-time',
					description:
						'Optional reminder date and time as an ISO 8601 timestamp with a timezone, e.g. 2026-09-24T14:00:00+02:00.'
				},
				color: {
					type: 'string',
					description: 'Color palette name (e.g. "default", "sand", "sage", "clay", "lavender")'
				}
			}
		},
		outputSchema: NOTE_MUTATION_OUTPUT_SCHEMA
	},
	{
		name: 'update_note',
		description:
			'Update an existing note by ID. Can replace full body text, update title, append text or checklist items, toggle checklist tasks, update labels, reminder, or color, or change pinned/archived state.',
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
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
				archived: { type: 'boolean', description: 'Archive or unarchive the note' },
				reminder: {
					type: ['string', 'null'],
					format: 'date-time',
					description:
						'Reminder date and time as an ISO 8601 timestamp with a timezone, e.g. 2026-09-24T14:00:00+02:00. Set null to remove the reminder.'
				}
			},
			required: ['id']
		},
		outputSchema: NOTE_MUTATION_OUTPUT_SCHEMA
	},
	{
		name: 'list_labels',
		description: 'List all available tags/labels in the note vault.',
		annotations: READ_ONLY_ANNOTATIONS,
		inputSchema: {
			type: 'object',
			properties: {}
		}
	}
];

export function getMcpTools(multipleWorkspaces: boolean) {
	if (!multipleWorkspaces) return MCP_TOOLS;
	return MCP_TOOLS.map((tool) =>
		tool.name === 'list_workspaces'
			? tool
			: {
					...tool,
					inputSchema: {
						...tool.inputSchema,
						...(tool.name === 'create_note' ? { required: ['workspace'] } : {}),
						properties: {
							...tool.inputSchema.properties,
							workspace: {
								type: 'string',
								description:
									'Workspace name. Omit on search and list to cover all granted workspaces.'
							}
						}
					}
				}
	);
}

export class McpSession {
	private readonly client: ScrapscacheSyncClient;
	private readonly syncKey: string;
	private readonly workspaceName: string;
	private readonly notes = new Map<string, Note>();
	private readonly labels = new Map<string, Label>();
	private readonly syncedSlots = new Map<string, SyncEnvelope>();
	private cursor = 0;
	private hydrated = false;
	private operationQueue: Promise<void> = Promise.resolve();
	private sseListeners = new Set<(event: string, data: unknown) => void>();
	private lastActiveAt = Date.now();
	private readonly clock = new SyncClock();
	private readonly editContext = createEditContext(() => this.clock.now());

	constructor(client: ScrapscacheSyncClient, workspaceName = 'Workspace') {
		this.client = client;
		this.syncKey = client.getSyncKey();
		this.workspaceName = workspaceName.trim() || 'Workspace';
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

	getWorkspaceCount(): number {
		return 1;
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

	dispose(): void {
		this.close();
		this.notes.clear();
		this.labels.clear();
		this.syncedSlots.clear();
		this.cursor = 0;
		this.hydrated = false;
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
				const payload = decryptSyncPayload<SyncRecordPayload>(
					this.syncKey,
					envelope.ciphertext,
					envelope.slot
				);
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

	/** One relay round trip; its answer also sets the clock edits are stamped with. */
	private async delta(uploads: SyncEnvelope[] = []): Promise<SyncResult> {
		const sentAt = Date.now();
		const result = await this.client.syncDelta(this.cursor, uploads, [], 100);
		this.clock.observe(result.serverTime, sentAt, Date.now());
		return result;
	}

	private async downloadChanges(): Promise<void> {
		let hasMore = true;
		while (hasMore) {
			const result = await this.delta();
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

	/**
	 * Write records under optimistic concurrency. When another writer got there
	 * first, merge with its copy and retry, so neither side's edit is lost.
	 */
	private async commitRecords(records: WritableRecord[]): Promise<void> {
		let pending = records;
		for (let attempt = 0; attempt < 4; attempt += 1) {
			const envelopes = pending.map((record): SyncEnvelope => {
				const key = `${record.kind}:${record.value.id}`;
				const slot = computeSlot(this.syncKey, key);
				return {
					id: randomOpaqueId(),
					slot,
					ciphertext: encryptSyncPayload(this.syncKey, record, slot),
					expectedId: this.syncedSlots.get(key)?.id ?? null
				};
			});
			const result = await this.delta(envelopes);
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
				pending.forEach((record, index) => {
					if (record.kind === 'note') this.notes.set(record.value.id, record.value);
					else this.labels.set(record.value.id, record.value);
					this.syncedSlots.set(`${record.kind}:${record.value.id}`, envelopes[index]);
				});
				return;
			}
			pending = pending.map((record): WritableRecord => {
				if (record.kind === 'note') {
					const current = this.notes.get(record.value.id);
					return current ? { kind: 'note', value: mergeTwoNotes(current, record.value) } : record;
				}
				const current = this.labels.get(record.value.id);
				return current ? { kind: 'label', value: mergeTwoLabels(current, record.value) } : record;
			});
		}
		throw new Error('Concurrent modification conflict: write could not be committed');
	}

	private getLabelNames(labelIds: string[] = []): string[] {
		return labelIds
			.map((id) => this.labels.get(id)?.name)
			.filter((name): name is string => typeof name === 'string');
	}

	private isTrashed(note: Note): boolean {
		return note.trashed ?? note.trash ?? false;
	}

	/** Label ids for names; labels that do not exist yet are returned to be written with the note. */
	private resolveLabelIds(names: string[]): { ids: string[]; created: Label[] } {
		const ids: string[] = [];
		const created: Label[] = [];
		for (const rawName of names) {
			const name = rawName.trim();
			if (!name) continue;
			const known = [...this.labels.values(), ...created].find(
				(label) => label.name.toLowerCase() === name.toLowerCase()
			);
			if (known) {
				if (!ids.includes(known.id)) ids.push(known.id);
				continue;
			}
			const now = this.clock.now();
			const label: Label = { id: randomOpaqueId(), name, createdAt: now, updatedAt: now };
			created.push(label);
			ids.push(label.id);
		}
		return { ids, created };
	}

	async searchNotes(args: {
		query?: string;
		label?: string;
		pinnedOnly?: boolean;
		limit?: number;
	}) {
		await this.ensureHydrated();
		const limit =
			typeof args.limit === 'number' && Number.isInteger(args.limit)
				? Math.min(Math.max(args.limit, 1), 50)
				: 20;
		const query = args.query?.trim().toLowerCase();

		let targetLabelId: string | undefined;
		if (args.label) {
			const targetName = args.label.trim().toLowerCase();
			const found = [...this.labels.values()].find((l) => l.name.toLowerCase() === targetName);
			if (!found) {
				return { notes: [], total: 0, hasMore: false };
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
			.filter((n) => !this.isTrashed(n) && !n.archived)
			.sort((a, b) => b.updatedAt - a.updatedAt);
		let total = 0;

		for (const note of allNotes) {
			if (args.pinnedOnly && !note.pinned) continue;
			if (targetLabelId && !note.labels?.includes(targetLabelId)) continue;

			const body = note.body || '';
			const matchIndex = query ? body.toLowerCase().indexOf(query) : -1;
			if (query) {
				const titleMatch = note.title?.toLowerCase().includes(query);
				if (!titleMatch && matchIndex === -1) continue;
			}
			total++;
			if (results.length >= limit) continue;

			const previewStart = matchIndex > 0 ? Math.max(0, matchIndex - 50) : 0;
			const previewEnd = Math.min(body.length, previewStart + 150);
			const preview = `${previewStart ? '…' : ''}${body.slice(previewStart, previewEnd).replace(/\s+/g, ' ').trim()}${previewEnd < body.length ? '…' : ''}`;
			results.push({
				id: note.id,
				title: note.title || 'Untitled',
				preview,
				labels: this.getLabelNames(note.labels),
				pinned: !!note.pinned,
				color: note.color || 'default',
				updatedAt: new Date(note.updatedAt).toISOString()
			});
		}

		return {
			notes: results,
			total,
			hasMore: total > limit
		};
	}

	async listNotes(args: { limit?: number }) {
		return this.searchNotes({ limit: args.limit });
	}

	async readNote(args: { id: string }) {
		await this.ensureHydrated();
		const note = this.notes.get(args.id);
		if (!note || this.isTrashed(note)) {
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
			reminder: note.reminder == null ? null : new Date(note.reminder).toISOString(),
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
		reminder?: string | null;
	}) {
		await this.ensureHydrated();
		const now = this.clock.now();
		const noteId = randomOpaqueId();
		const reminder = reminderTimestamp(args.reminder) ?? null;

		let noteBody = args.body || '';
		if (args.checklist && args.checklist.length > 0) {
			const checklistLines = args.checklist.map((item) => `- [ ] ${item.trim()}`).join('\n');
			noteBody = noteBody ? `${noteBody}\n${checklistLines}` : checklistLines;
		}

		const labels = args.labels ? this.resolveLabelIds(args.labels) : { ids: [], created: [] };

		const note = touchNoteFields(
			{
				id: noteId,
				title: args.title?.trim() || '',
				body: noteBody,
				labels: labels.ids,
				color: (args.color || 'default') as NoteColor,
				pinned: !!args.pinned,
				archived: false,
				trashed: false,
				trashedAt: null,
				reminder,
				createdAt: now,
				updatedAt: now,
				images: []
			},
			NOTE_FIELDS,
			{ ...this.editContext, now: () => now }
		);

		await this.commitRecords([
			...labels.created.map((label): WritableRecord => ({ kind: 'label', value: label })),
			{ kind: 'note', value: note }
		]);

		return {
			success: true,
			note: {
				id: note.id,
				title: note.title,
				labels: this.getLabelNames(note.labels),
				pinned: note.pinned,
				reminder: note.reminder == null ? null : new Date(note.reminder).toISOString()
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
		reminder?: string | null;
	}) {
		await this.ensureHydrated();
		const existing = this.notes.get(args.id);
		if (!existing || this.isTrashed(existing)) {
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

		const reminder = reminderTimestamp(args.reminder);
		const labels = args.labels !== undefined ? this.resolveLabelIds(args.labels) : null;

		const before: Note = {
			...existing,
			trashed: existing.trashed ?? existing.trash ?? false,
			trashedAt: existing.trashedAt ?? null
		};
		const patch: NotePatch = {
			body: updatedBody,
			...(args.title !== undefined ? { title: args.title } : {}),
			...(labels ? { labels: labels.ids } : {}),
			...(args.color !== undefined ? { color: args.color as NoteColor } : {}),
			...(args.pinned !== undefined ? { pinned: args.pinned } : {}),
			...(args.archived !== undefined ? { archived: args.archived } : {}),
			...(reminder !== undefined ? { reminder } : {})
		};
		const updatedNote = applyNoteEdit(before, patch, this.editContext);
		const createdLabels = labels?.created ?? [];
		if (updatedNote !== before || createdLabels.length > 0) {
			await this.commitRecords([
				...createdLabels.map((label): WritableRecord => ({ kind: 'label', value: label })),
				{ kind: 'note', value: updatedNote }
			]);
		}

		return {
			success: true,
			note: {
				id: updatedNote.id,
				title: updatedNote.title,
				labels: this.getLabelNames(updatedNote.labels),
				pinned: updatedNote.pinned,
				archived: updatedNote.archived,
				reminder: updatedNote.reminder == null ? null : new Date(updatedNote.reminder).toISOString()
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

	async listWorkspaces() {
		return { workspaces: [{ workspace: this.workspaceName }] };
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
		this.touch();
		switch (name) {
			case 'search_notes':
				return this.searchNotes(args as Parameters<McpSession['searchNotes']>[0]);
			case 'list_notes':
				return this.listNotes(args as Parameters<McpSession['listNotes']>[0]);
			case 'open_note':
				return this.readNote(args as { id: string });
			case 'create_note':
				return this.createNote(args as Parameters<McpSession['createNote']>[0]);
			case 'update_note':
				return this.updateNote(args as Parameters<McpSession['updateNote']>[0]);
			case 'list_labels':
				return this.listLabels();
			case 'list_workspaces':
				return this.listWorkspaces();
			default:
				throw new Error(`Unknown tool: ${name}`);
		}
	}

	async listResources() {
		await this.ensureHydrated();
		const resources = [...this.notes.values()]
			.filter((n) => !this.isTrashed(n))
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
