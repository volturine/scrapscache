import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
	isZipBytes,
	materializeKeepTakeout,
	parseKeepNote,
	readKeepTakeout,
	unzipKeepTakeout
} from './keepImport';

const PNG = Uint8Array.from(
	atob(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
	),
	(char) => char.charCodeAt(0)
);

function keepNote(overrides: Record<string, unknown> = {}) {
	return {
		color: 'DEFAULT',
		isTrashed: false,
		isPinned: false,
		isArchived: false,
		title: 'Note',
		textContent: 'Hello',
		userEditedTimestampUsec: 1_700_000_000_000_000,
		createdTimestampUsec: 1_600_000_000_000_000,
		...overrides
	};
}

describe('parseKeepNote', () => {
	it('maps text, flags, color, and microsecond timestamps', () => {
		const note = parseKeepNote(
			keepNote({
				color: 'CERULEAN',
				isPinned: true,
				isArchived: true,
				isTrashed: true,
				title: '  Title  '
			})
		);
		expect(note).toMatchObject({
			title: 'Title',
			body: 'Hello',
			color: 'darkblue',
			pinned: true,
			archived: true,
			trashed: true,
			createdAt: 1_600_000_000_000,
			updatedAt: 1_700_000_000_000
		});
	});

	it('falls back to edited time when created time is missing', () => {
		const note = parseKeepNote(
			keepNote({
				createdTimestampUsec: undefined
			})
		);
		expect(note?.createdAt).toBe(1_700_000_000_000);
	});

	it('uses created time when edited time is zero', () => {
		const note = parseKeepNote(
			keepNote({
				userEditedTimestampUsec: 0,
				createdTimestampUsec: 1_391_004_371_794_000,
				textContent: 'Topolcanky konzervatorium'
			})
		);
		expect(note).toMatchObject({
			body: 'Topolcanky konzervatorium',
			createdAt: 1_391_004_371_794,
			updatedAt: 1_391_004_371_794
		});
	});

	it('converts checklists including one nested child', () => {
		const note = parseKeepNote(
			keepNote({
				textContent: undefined,
				listContent: [
					{
						text: 'Milk',
						isChecked: false,
						childListItems: [{ text: 'Oat', isChecked: true }]
					},
					{ text: 'Eggs', isChecked: true }
				]
			})
		);
		expect(note?.body).toBe('[ ] Milk\n  [x] Oat\n[x] Eggs');
	});

	it('reads labels, attachment paths, and link annotations', () => {
		const note = parseKeepNote(
			keepNote({
				labels: [{ name: 'Recipes' }, { name: 'recipes' }, { name: '  ' }],
				attachments: [{ filePath: 'Takeout/Keep/pic.png', mimetype: 'image/png' }],
				annotations: [
					{
						title: 'Example',
						description: 'A site',
						url: 'https://www.example.com/path',
						source: 'WEBLINK'
					}
				]
			})
		);
		expect(note?.labelNames).toEqual(['Recipes']);
		expect(note?.attachments).toEqual([{ fileName: 'pic.png', mime: 'image/png' }]);
		expect(note?.linkPreviews).toEqual([
			{
				url: 'https://www.example.com/path',
				hostname: 'example.com',
				title: 'Example',
				description: 'A site'
			}
		]);
	});

	it('rejects objects that are not Keep notes', () => {
		expect(parseKeepNote({ title: 'no' })).toBeNull();
		expect(parseKeepNote(null)).toBeNull();
	});
});

describe('readKeepTakeout', () => {
	it('reads JSON notes, Labels.txt, and skips HTML plus invalid JSON', () => {
		const parsed = readKeepTakeout({
			'Takeout/Keep/Note.json': strToU8(
				JSON.stringify(keepNote({ title: 'Keep me', labels: [{ name: 'Work' }] }))
			),
			'Takeout/Keep/2023-11-14T21_37_44.527+01_00.json': strToU8(
				JSON.stringify(
					keepNote({
						title: '',
						textContent: 'Old',
						userEditedTimestampUsec: 0,
						createdTimestampUsec: 0
					})
				)
			),
			'Takeout/Keep/Labels.txt': strToU8('vllm\nWork\n'),
			'Takeout/Keep/Note.html': strToU8('<html></html>'),
			'Takeout/Keep/broken.json': strToU8('{not json'),
			'Takeout/Keep/other.json': strToU8(JSON.stringify({ hello: true }))
		});
		expect(parsed.notes).toHaveLength(2);
		expect(parsed.notes[0].title).toBe('Keep me');
		expect(parsed.notes[1]).toMatchObject({
			body: 'Old',
			updatedAt: Date.parse('2023-11-14T21:37:44.527+01:00')
		});
		expect(parsed.labelNames).toEqual(['vllm', 'Work']);
	});
});

describe('materializeKeepTakeout', () => {
	it('unzips a Takeout archive into notes with attachments and original times', async () => {
		const zip = zipSync({
			'Takeout/Keep/Photo.json': strToU8(
				JSON.stringify(
					keepNote({
						title: 'Photo',
						attachments: [{ filePath: '1766.png', mimetype: 'image/png' }]
					})
				)
			),
			'Takeout/Keep/1766.png': PNG,
			'Takeout/Keep/Labels.txt': strToU8('ideas\n')
		});
		expect(isZipBytes(zip)).toBe(true);
		const files = await unzipKeepTakeout(zip);
		expect(Object.keys(files).some((name) => name.endsWith('.html'))).toBe(false);
		const { notes, labels } = await materializeKeepTakeout(files);
		expect(labels.map((label) => label.name)).toEqual(['ideas']);
		expect(notes).toHaveLength(1);
		expect(notes[0]).toMatchObject({
			title: 'Photo',
			createdAt: 1_600_000_000_000,
			updatedAt: 1_700_000_000_000,
			trashedAt: null
		});
		expect(notes[0].images).toEqual([
			expect.objectContaining({
				name: '1766.png',
				mime: 'image/png',
				dataUrl: expect.stringMatching(/^data:image\/png;base64,/)
			})
		]);
	});
});
