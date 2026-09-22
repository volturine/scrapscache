import { McpSession } from './engine.js';
import type { GrantedWorkspace } from './grant.js';
import { ScrapscacheSyncClient } from './syncClient.js';

type Vault = { name: string; session: McpSession };

const ACROSS_VAULTS = new Set(['search_notes', 'list_notes', 'list_recent_notes', 'list_labels']);
const BY_NOTE_ID = new Set(['read_note', 'open_note', 'update_note']);

function workspaceArg(args: Record<string, unknown>): string | undefined {
	const value = args.workspace;
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function withoutWorkspace(args: Record<string, unknown>): Record<string, unknown> {
	const rest = { ...args };
	delete rest.workspace;
	return rest;
}

function annotate(result: unknown, workspace: string): unknown {
	if (!result || typeof result !== 'object') return result;
	const record = result as { notes?: unknown };
	if (Array.isArray(record.notes)) {
		return {
			...record,
			notes: record.notes.map((note) =>
				note && typeof note === 'object' ? { ...note, workspace } : note
			)
		};
	}
	return { ...record, workspace };
}

export class VaultSession {
	private readonly vaults: Vault[];
	private operationQueue: Promise<void> = Promise.resolve();

	constructor(scrapscacheUrl: string, workspaces: GrantedWorkspace[]) {
		this.vaults = workspaces.map((workspace) => ({
			name: workspace.name,
			session: new McpSession(new ScrapscacheSyncClient(scrapscacheUrl, workspace.syncKey))
		}));
	}

	touch(): void {
		for (const vault of this.vaults) vault.session.touch();
	}

	getLastActiveAt(): number {
		return Math.max(...this.vaults.map((vault) => vault.session.getLastActiveAt()));
	}

	dispose(): void {
		for (const vault of this.vaults) vault.session.dispose();
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

	addSseListener(listener: (event: string, data: unknown) => void): () => void {
		const unsubscribers = this.vaults.map((vault) => vault.session.addSseListener(listener));
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	}

	private names(): string {
		return this.vaults.map((vault) => vault.name).join(', ');
	}

	private pick(name: string | undefined): Vault | null {
		if (!name) return this.vaults.length === 1 ? this.vaults[0] : null;
		const found = this.vaults.find((vault) => vault.name === name);
		if (!found)
			throw new Error(`Unknown workspace "${name}". Granted workspaces: ${this.names()}.`);
		return found;
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
		this.touch();
		if (name === 'list_workspaces') return this.listWorkspaces();
		const requested = workspaceArg(args);
		const rest = withoutWorkspace(args);
		const target = this.pick(requested);
		if (target) {
			const result = await target.session.callTool(name, rest);
			return this.vaults.length === 1 ? result : annotate(result, target.name);
		}
		if (ACROSS_VAULTS.has(name)) return this.across(name, rest);
		if (BY_NOTE_ID.has(name)) return this.byNoteId(name, rest);
		if (name === 'create_note') {
			throw new Error(`Pass workspace to create a note. Granted workspaces: ${this.names()}.`);
		}
		throw new Error(`Unknown tool: ${name}`);
	}

	private async across(name: string, args: Record<string, unknown>): Promise<unknown> {
		const limit = typeof args.limit === 'number' ? args.limit : undefined;
		const settled = await Promise.all(
			this.vaults.map(async (vault) => {
				try {
					const result = await vault.session.callTool(name, args);
					return { vault, result, error: '' };
				} catch (err) {
					return {
						vault,
						result: null,
						error: err instanceof Error ? err.message : 'Workspace request failed'
					};
				}
			})
		);
		const errors = settled
			.filter((item) => item.error)
			.map((item) => ({ workspace: item.vault.name, error: item.error }));
		if (errors.length === settled.length) {
			throw new Error(
				`No granted workspaces are available: ${errors
					.map((item) => `${item.workspace}: ${item.error}`)
					.join('; ')}`
			);
		}

		if (name === 'list_labels') {
			return {
				workspaces: settled.map((item) => ({
					workspace: item.vault.name,
					labels:
						item.result && typeof item.result === 'object' && 'labels' in item.result
							? (item.result as { labels: unknown }).labels
							: [],
					...(item.error ? { error: item.error } : {})
				})),
				...(errors.length ? { errors } : {})
			};
		}

		const notes: Array<Record<string, unknown> & { updatedAt?: string }> = [];
		const workspaces = settled.map((item) => {
			const found =
				item.result && typeof item.result === 'object' && 'notes' in item.result
					? (item.result as { notes?: unknown }).notes
					: [];
			return {
				workspace: item.vault.name,
				noteCount: Array.isArray(found) ? found.length : 0,
				...(item.error ? { error: item.error } : {})
			};
		});
		for (const item of settled) {
			if (item.error) {
				continue;
			}
			const found =
				item.result && typeof item.result === 'object' && 'notes' in item.result
					? (item.result as { notes?: unknown }).notes
					: [];
			if (!Array.isArray(found)) continue;
			for (const note of found) {
				if (note && typeof note === 'object') {
					notes.push({ ...(note as Record<string, unknown>), workspace: item.vault.name });
				}
			}
		}
		notes.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
		const capped =
			typeof limit === 'number' ? notes.slice(0, Math.min(Math.max(limit, 1), 50)) : notes;
		return {
			notes: capped,
			total: capped.length,
			workspaces,
			...(errors.length ? { errors } : {})
		};
	}

	async listWorkspaces() {
		return { workspaces: this.vaults.map((vault) => ({ workspace: vault.name })) };
	}

	private async byNoteId(name: string, args: Record<string, unknown>): Promise<unknown> {
		const hits: { vault: Vault; result: unknown }[] = [];
		for (const vault of this.vaults) {
			try {
				hits.push({ vault, result: await vault.session.callTool(name, args) });
			} catch (err) {
				const message = err instanceof Error ? err.message : '';
				if (!/not found/i.test(message)) throw err;
			}
		}
		if (hits.length === 1) return annotate(hits[0].result, hits[0].vault.name);
		if (hits.length === 0) {
			throw new Error(`Note not found with id: ${String(args.id || '')}`);
		}
		throw new Error(
			`That note id exists in ${hits.map((hit) => hit.vault.name).join(', ')}. Pass workspace.`
		);
	}

	async listResources(): Promise<{
		resources: { uri: string; name: string; mimeType: string }[];
	}> {
		if (this.vaults.length === 1) return this.vaults[0].session.listResources();
		const groups = await Promise.all(
			this.vaults.map(async (vault) => ({
				name: vault.name,
				resources: (await vault.session.listResources()).resources
			}))
		);
		return {
			resources: groups.flatMap((group) =>
				group.resources.map((resource) => ({
					...resource,
					name: `${group.name}: ${resource.name}`,
					uri: `scrapscache://workspace/${encodeURIComponent(group.name)}/notes/${resource.uri.split('/').pop()}`
				}))
			)
		};
	}

	async readResource(uri: string): Promise<unknown> {
		const named = uri.match(/^scrapscache:\/\/workspace\/([^/]+)\/notes\/([^/]+)$/);
		if (named) {
			const name = decodeURIComponent(named[1]);
			const target = this.pick(name);
			if (!target) throw new Error(`Unknown workspace "${name}".`);
			return target.session.readResource(`scrapscache://notes/${named[2]}`);
		}
		if (this.vaults.length === 1) return this.vaults[0].session.readResource(uri);
		let found: unknown = null;
		for (const vault of this.vaults) {
			try {
				const content = await vault.session.readResource(uri);
				if (found) {
					throw new Error('That note exists in more than one workspace. Use a workspace URI.');
				}
				found = content;
			} catch (err) {
				const message = err instanceof Error ? err.message : '';
				if (message.startsWith('That note exists')) throw err;
				if (!/not found/i.test(message) && !/Invalid resource/i.test(message)) throw err;
			}
		}
		if (!found) throw new Error(`Resource not found: ${uri}`);
		return found;
	}
}
