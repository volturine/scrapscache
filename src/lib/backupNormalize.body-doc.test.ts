import { describe, expect, it } from 'vitest';
import { BodyAuthor, replaceBodySnapshot } from './model';
import { normalizeBackup } from './backupNormalize';

function normalizedNote(body: string, bodyDoc?: string) {
	const backup = normalizeBackup({
		version: 5,
		exportedAt: 1,
		notes: [{ id: 'note', body, ...(bodyDoc !== undefined ? { bodyDoc } : {}) }],
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
	return backup?.notes[0];
}

describe('backup body document normalization', () => {
	it('preserves a readable normal document when its text matches', () => {
		const document = new BodyAuthor().edit('note', { body: '' }, 'normal body');

		const note = normalizedNote(document.body, document.bodyDoc);
		expect(note?.body).toBe('normal body');
		expect(note?.bodyDoc).toBe(document.bodyDoc);
	});

	it('preserves a readable replacement snapshot when its text matches', () => {
		const base = new BodyAuthor().edit('note', { body: '' }, 'base');
		const snapshot = replaceBodySnapshot(base, 'snapshot body', { time: 30, writer: 'writer' });

		const note = normalizedNote(snapshot.body, snapshot.bodyDoc);
		expect(note?.body).toBe('snapshot body');
		expect(note?.bodyDoc).toBe(snapshot.bodyDoc);
	});

	it('discards a readable document that disagrees with the backup text', () => {
		const document = new BodyAuthor().edit('note', { body: '' }, 'document text');

		const note = normalizedNote('backup plaintext', document.bodyDoc);
		expect(note?.body).toBe('backup plaintext');
		expect(note).not.toHaveProperty('bodyDoc');
	});

	it('discards an empty document when the backup text is nonempty', () => {
		const document = new BodyAuthor().edit('note', { body: 'temporary text' }, '');

		const note = normalizedNote('backup plaintext', document.bodyDoc);
		expect(note?.body).toBe('backup plaintext');
		expect(note).not.toHaveProperty('bodyDoc');
	});
});
