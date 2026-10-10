import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { Note } from '#lib/types.js';
import { buildNotesMarkdownZip } from './notesMarkdownExport.js';

function note(overrides: Partial<Note> = {}): Note {
	return {
		id: 'note-id',
		title: 'Trip',
		body: 'A **readable** note.',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		...overrides
	};
}

describe('Markdown notes export', () => {
	it('puts notes and linked attachments in the notes folder', async () => {
		const zip = await buildNotesMarkdownZip([
			note({
				images: [
					{
						id: 'attachment-id',
						name: 'map.png',
						mime: 'image/png',
						dataUrl: 'data:image/png;base64,AQID',
						createdAt: 1
					}
				]
			})
		]);
		const files = unzipSync(zip);

		expect(Object.keys(files).sort()).toEqual(['notes/Trip.md', 'notes/attachments/Trip-map.png']);
		expect(strFromU8(files['notes/Trip.md']!)).toContain('# Trip\n\nA **readable** note.');
		expect(strFromU8(files['notes/Trip.md']!)).toContain('![map.png](attachments/Trip-map.png)');
		expect(files['notes/attachments/Trip-map.png']).toEqual(new Uint8Array([1, 2, 3]));
	});

	it('keeps duplicate note titles as distinct files', async () => {
		const zip = await buildNotesMarkdownZip([note(), note({ id: 'note-two' })]);
		const files = unzipSync(zip);

		expect(Object.keys(files).sort()).toEqual(['notes/Trip-2.md', 'notes/Trip.md']);
	});

	it('fails instead of silently omitting an attachment with unavailable bytes', async () => {
		await expect(
			buildNotesMarkdownZip([
				note({
					images: [
						{
							id: 'missing',
							name: 'missing.pdf',
							mime: 'application/pdf',
							dataUrl: '',
							createdAt: 1
						}
					]
				})
			])
		).rejects.toThrow('Could not read an attachment');
	});
});
