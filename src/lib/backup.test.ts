import { describe, expect, it } from 'vitest';
import type { Note } from './types';
import { importedReminderHistory, prepareImportedNotes } from './backup';
import { normalizeBackup } from './backupNormalize';
import { reminderWakeId } from '#lib/model/index.js';
import { createEditContext } from './model';
import { noteActivity } from './utils';

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

	it('restores replacement imports under new note ids, keeping attachment ids and dates', () => {
		// A restore under the old id would merge into newer synced text instead of replacing it.
		const [note] = prepareImportedNotes(
			[sourceNote],
			'replace',
			createEditContext(() => 100)
		);

		expect(note.id).not.toBe(sourceNote.id);
		// Brought back, not edited: the note reads as it did when the backup was taken.
		expect(note).toMatchObject({ createdAt: 1, updatedAt: 2, trashedAt: null });
		expect(note.fieldTimes).toMatchObject({ title: 2, body: 1, color: 2 });
		expect(note.images).toEqual([expect.objectContaining({ id: 'image', createdAt: 100 })]);
	});

	it('regenerates note and attachment IDs for additive imports', () => {
		const [note] = prepareImportedNotes(
			[sourceNote],
			'keep',
			createEditContext(() => 100)
		);

		expect(note.id).not.toBe(sourceNote.id);
		expect(note.images?.[0].id).not.toBe(sourceNote.images?.[0].id);
		expect(note).toMatchObject({ createdAt: 1, updatedAt: 2 });
	});

	it('reads as created, not edited, when the backup copy was never edited', () => {
		const [note] = prepareImportedNotes(
			[{ ...sourceNote, updatedAt: 1, fieldTimes: undefined }],
			'keep',
			createEditContext(() => 100)
		);

		expect(noteActivity(note, 100).label).toMatch(/^Created/);
		expect(note.fieldTimes).toMatchObject({ title: 1, body: 1 });
	});

	it('reads a future or unsafe clock as now, so later edits are not frozen behind it', () => {
		// A restored time becomes a last-write-wins clock: `time + 1` stops advancing at 2^53.
		const [note] = prepareImportedNotes(
			[
				{
					...sourceNote,
					createdAt: -5,
					updatedAt: 2 ** 53,
					fieldTimes: { title: Number.MAX_VALUE, body: 150, color: 40 }
				}
			],
			'replace',
			createEditContext(() => 100)
		);

		expect(note).toMatchObject({ createdAt: 100, updatedAt: 100 });
		// Rejected field times fall back to the clamped updatedAt; a sane past one stays.
		expect(note.fieldTimes).toMatchObject({ title: 100, body: 100, color: 40, pinned: 100 });
	});

	it('starts the purge window of a trashed note over but keeps its dates', () => {
		const [note] = prepareImportedNotes(
			[{ ...sourceNote, trashed: true, trashedAt: 5 }],
			'replace',
			createEditContext(() => 100)
		);

		expect(note).toMatchObject({ trashed: true, trashedAt: 100, createdAt: 1, updatedAt: 2 });
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

	it('moves the receipts of a repeating reminder, each under its own time', () => {
		const DAY = 86_400_000;
		const reminder = Date.UTC(2026, 9, 1, 9);
		const source = { ...sourceNote, reminder, repeat: { unit: 'day', every: 1, zone: 'UTC' } };
		const imported = { ...source, id: 'fresh' };
		const third = reminder + 2 * DAY;
		const shown = { id: reminderWakeId(source.id, third), noteId: source.id, firedAt: third };
		const offSchedule = {
			id: reminderWakeId(source.id, third + 1),
			noteId: source.id,
			firedAt: third + 1
		};

		expect(
			importedReminderHistory([source as Note], [imported as Note], [shown, offSchedule])
		).toEqual([{ id: reminderWakeId('fresh', third), noteId: 'fresh', firedAt: third }]);
	});
});
