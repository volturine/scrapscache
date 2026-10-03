import { describe, expect, it } from 'vitest';
import type { Note } from './types';
import { importedReminderHistory, normalizeBackup, prepareImportedNotes } from './backup';
import { reminderWakeId } from '#lib/model/index.js';
import { createEditContext } from './model';

const sourceNote: Note = {
	id: 'note',
	title: 'Imported',
	body: 'Body',
	color: 'default',
	pinned: false,
	archived: false,
	trashed: false,
	trashedAt: null,
	createdAt: 1,
	updatedAt: 2,
	reminder: null,
	labels: ['label'],
	fieldTimes: { title: 2, body: 1 },
	images: [{ id: 'image', mime: 'image/jpeg', dataUrl: 'data:', createdAt: 1 }]
};

describe('backup normalization', () => {
	it('accepts only complete version 5 backups', () => {
		expect(normalizeBackup(null)).toBeNull();
		expect(normalizeBackup({ notes: [] })).toBeNull();
		expect(
			normalizeBackup({
				version: 3,
				exportedAt: 123,
				notes: [],
				labels: []
			})
		).toBeNull();

		const backup = normalizeBackup({
			version: 5,
			exportedAt: 123,
			notes: [sourceNote],
			labels: [],
			boards: [],
			activeBoardId: '',
			tombstones: {},
			labelTombstones: {},
			boardTombstones: {},
			canvasLibrary: [],
			reminderHistory: [],
			ui: { sidebarOpen: true, dark: null, layout: 'grid', view: 'notes' }
		});
		expect(backup).toMatchObject({ version: 5, exportedAt: 123, notes: [sourceNote] });
		expect(backup?.ui.rawMarkdown).toBe(false);

		const backupWithRawMarkdown = normalizeBackup({
			version: 5,
			exportedAt: 123,
			notes: [],
			labels: [],
			boards: [],
			activeBoardId: '',
			tombstones: {},
			labelTombstones: {},
			boardTombstones: {},
			canvasLibrary: [],
			reminderHistory: [],
			ui: { sidebarOpen: true, dark: null, layout: 'grid', view: 'notes', rawMarkdown: true }
		});
		expect(backupWithRawMarkdown?.ui.rawMarkdown).toBe(true);
	});

	it('never retains sync identity from the backup file', () => {
		const backup = normalizeBackup({
			version: 5,
			exportedAt: 1,
			notes: [sourceNote],
			labels: [],
			boards: [],
			activeBoardId: '',
			tombstones: {},
			labelTombstones: {},
			boardTombstones: {},
			canvasLibrary: [],
			reminderHistory: [],
			ui: { sidebarOpen: true, dark: null, layout: 'grid', view: 'notes' },
			sync: { syncKey: 'root-secret', lastSync: 42 }
		});
		expect(backup).not.toHaveProperty('sync');
		expect(JSON.stringify(backup)).not.toContain('root-secret');
	});

	it('restores replacement imports under new note ids, keeping attachment ids', () => {
		// A restore under the old id would merge into newer synced text instead of replacing it.
		const [note] = prepareImportedNotes(
			[sourceNote],
			'replace',
			createEditContext(() => 100)
		);

		expect(note.id).not.toBe(sourceNote.id);
		expect(note).toMatchObject({ createdAt: 100, trashedAt: null });
		expect(note.images).toEqual([expect.objectContaining({ id: 'image', createdAt: 100 })]);
		expect(new Set(Object.values(note.fieldTimes ?? {})).size).toBe(1);
	});

	it('regenerates note and attachment IDs for additive imports', () => {
		const [note] = prepareImportedNotes(
			[sourceNote],
			'keep',
			createEditContext(() => 100)
		);

		expect(note.id).not.toBe(sourceNote.id);
		expect(note.images?.[0].id).not.toBe(sourceNote.images?.[0].id);
		expect(note).toMatchObject({ createdAt: 100 });
	});
});

describe('backup library and reminder history', () => {
	const complete = {
		version: 5,
		exportedAt: 1,
		notes: [],
		labels: [],
		boards: [],
		activeBoardId: '',
		tombstones: {},
		labelTombstones: {},
		boardTombstones: {},
		canvasLibrary: [],
		reminderHistory: [],
		ui: { sidebarOpen: true, dark: null, layout: 'grid', view: 'notes' }
	};

	it('rejects a backup without them, and drops malformed entries', () => {
		const { canvasLibrary: _library, ...withoutLibrary } = complete;
		expect(normalizeBackup(withoutLibrary)).toBeNull();
		expect(normalizeBackup({ ...complete, version: 3 })).toBeNull();
		const wake = 'a'.repeat(43);
		const backup = normalizeBackup({
			...complete,
			canvasLibrary: [
				{ id: 'star', created: 1, elements: [] },
				{ id: 'no-elements', created: 1 }
			],
			reminderHistory: [
				{ id: wake, noteId: 'n', firedAt: 1 },
				{ id: 'short', noteId: 'n', firedAt: 1 }
			]
		});
		expect(backup?.canvasLibrary.map((item) => item.id)).toEqual(['star']);
		expect(backup?.reminderHistory.map((entry) => entry.id)).toEqual([wake]);
	});

	it('imports a version 4 backup with an empty library and history', () => {
		const { canvasLibrary: _library, reminderHistory: _history, ...v4 } = complete;
		const backup = normalizeBackup({ ...v4, version: 4, notes: [sourceNote] });
		expect(backup).toMatchObject({
			version: 5,
			notes: [sourceNote],
			canvasLibrary: [],
			reminderHistory: []
		});
	});

	it("moves a note's reminder history to the id the restore gives it", () => {
		const reminder = 5_000;
		const source = { ...sourceNote, reminder };
		const imported = { ...source, id: 'fresh' };
		const handled = {
			id: reminderWakeId(source.id, reminder),
			noteId: source.id,
			firedAt: 10,
			dismissedAt: 20
		};
		const stale = { id: reminderWakeId(source.id, 1), noteId: source.id, firedAt: 1 };

		expect(importedReminderHistory([source], [imported], [handled, stale])).toEqual([
			{ id: reminderWakeId('fresh', reminder), noteId: 'fresh', firedAt: 10, dismissedAt: 20 }
		]);
	});
});
