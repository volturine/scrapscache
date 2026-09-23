import { describe, expect, it } from 'vitest';
import type { Note } from './types';
import { normalizeBackup, prepareImportedNotes } from './backup';
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
	it('accepts only complete version 4 backups', () => {
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
			version: 4,
			exportedAt: 123,
			notes: [sourceNote],
			labels: [],
			boards: [],
			activeBoardId: '',
			tombstones: {},
			labelTombstones: {},
			boardTombstones: {},
			ui: { sidebarOpen: true, dark: null, layout: 'grid', view: 'notes' }
		});
		expect(backup).toMatchObject({ version: 4, exportedAt: 123, notes: [sourceNote] });
		expect(backup?.ui.rawMarkdown).toBe(false);

		const backupWithRawMarkdown = normalizeBackup({
			version: 4,
			exportedAt: 123,
			notes: [],
			labels: [],
			boards: [],
			activeBoardId: '',
			tombstones: {},
			labelTombstones: {},
			boardTombstones: {},
			ui: { sidebarOpen: true, dark: null, layout: 'grid', view: 'notes', rawMarkdown: true }
		});
		expect(backupWithRawMarkdown?.ui.rawMarkdown).toBe(true);
	});

	it('never retains sync identity from the backup file', () => {
		const backup = normalizeBackup({
			version: 4,
			exportedAt: 1,
			notes: [sourceNote],
			labels: [],
			boards: [],
			activeBoardId: '',
			tombstones: {},
			labelTombstones: {},
			boardTombstones: {},
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
