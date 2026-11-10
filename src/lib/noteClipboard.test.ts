import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteImage } from './types';
import {
	clipboardPhotos,
	noteToClipboardHtml,
	readCopiedNotePaste,
	writeNoteToClipboard
} from './noteClipboard';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const WEBP = 'data:image/webp;base64,UklGRg==';

function photo(partial: Partial<NoteImage> = {}): NoteImage {
	return {
		id: 'p1',
		mime: 'image/webp',
		dataUrl: WEBP,
		name: 'beach.webp',
		createdAt: 1,
		width: 40,
		height: 30,
		...partial
	};
}

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'n',
		title: 'Trip',
		body: 'packing list',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		...partial
	};
}

class FakeClipboardItem {
	constructor(public data: Record<string, Blob | PromiseLike<Blob | string> | string>) {}
}

async function itemText(item: FakeClipboardItem, type: string): Promise<string> {
	const value = await item.data[type];
	return typeof value === 'string' ? value : value.text();
}

function installClipboard(write: (items: FakeClipboardItem[]) => Promise<void>) {
	const writeText = vi.fn().mockResolvedValue(undefined);
	Object.assign(navigator, { clipboard: { write: vi.fn(write), writeText } });
	vi.stubGlobal('ClipboardItem', FakeClipboardItem);
	return { write: navigator.clipboard.write as ReturnType<typeof vi.fn>, writeText };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('noteToClipboardHtml', () => {
	it('renders the title, paragraphs with line breaks, and the photos', () => {
		const html = noteToClipboardHtml({ title: 'Trip <2026>', body: '[ ] a\n[x] b\n\nnotes' }, [
			photo({ dataUrl: PNG, mime: 'image/png', name: 'beach.png' })
		]);
		expect(html).toBe(
			[
				'<div data-scrapscache-note="{&quot;title&quot;:&quot;Trip &lt;2026&gt;&quot;,&quot;body&quot;:&quot;[ ] a\\n[x] b\\n\\nnotes&quot;}">',
				'<h1>Trip &lt;2026&gt;</h1>',
				'<p style="white-space:pre-wrap">[ ] a<br>[x] b</p>',
				'<p style="white-space:pre-wrap">notes</p>',
				`<p><img src="${PNG}" alt="beach.png" data-scrapscache-photo-id="p1" data-scrapscache-photo-name="beach.png" data-scrapscache-photo-index="0" width="40" height="30"></p>`,
				'</div>'
			].join('\n')
		);
	});

	it('puts a photo where its marker line stands and the rest after the text', () => {
		const placed = photo({ id: 'p1', dataUrl: PNG, mime: 'image/png', name: 'cove.png' });
		const loose = photo({ id: 'p2', dataUrl: WEBP, name: 'kiosk.webp' });
		const html = noteToClipboardHtml(
			{ title: '', body: 'The cove:\n![cove.png](photo:p1)\nParking\n![gone](photo:p9)' },
			[placed, loose]
		);
		expect(html).toBe(
			[
				'<div data-scrapscache-note="{&quot;title&quot;:&quot;&quot;,&quot;body&quot;:&quot;The cove:\\n![cove.png](photo:p1)\\nParking\\n![gone](photo:p9)&quot;}">',
				'<p style="white-space:pre-wrap">The cove:</p>',
				`<p><img src="${PNG}" alt="cove.png" data-scrapscache-photo-id="p1" data-scrapscache-photo-name="cove.png" data-scrapscache-photo-index="0" width="40" height="30"></p>`,
				'<p style="white-space:pre-wrap">Parking<br>![gone](photo:p9)</p>',
				`<p><img src="${WEBP}" alt="kiosk.webp" data-scrapscache-photo-id="p2" data-scrapscache-photo-name="kiosk.webp" data-scrapscache-photo-index="1" width="40" height="30"></p>`,
				'</div>'
			].join('\n')
		);
	});

	it('leaves out an empty title and body', () => {
		expect(noteToClipboardHtml({ title: '', body: '' }, [])).toBe(
			'<div data-scrapscache-note="{&quot;title&quot;:&quot;&quot;,&quot;body&quot;:&quot;&quot;}"></div>'
		);
	});
});

describe('readCopiedNotePaste', () => {
	function clipboardHtml(html: string): DataTransfer {
		return { getData: (type: string) => (type === 'text/html' ? html : '') } as DataTransfer;
	}

	it('round-trips the title, mixed body text, and multiple photos with fresh ids', () => {
		const html = noteToClipboardHtml(
			{
				title: 'Road trip',
				body: 'Before\n![camp.webp](photo:source-two)\nBetween\n![shore.png](photo:source-one)\nAfter'
			},
			[
				photo({ id: 'source-one', name: 'shore.png', mime: 'image/png', dataUrl: PNG }),
				photo({ id: 'source-two', name: 'camp.webp', dataUrl: WEBP })
			]
		);

		const pasted = readCopiedNotePaste(clipboardHtml(html));

		expect(pasted).not.toBeNull();
		expect(pasted?.title).toBe('Road trip');
		expect(pasted?.images.map(({ name, mime }) => ({ name, mime }))).toEqual([
			{ name: 'shore.png', mime: 'image/png' },
			{ name: 'camp.webp', mime: 'image/webp' }
		]);
		expect(pasted?.images.every(({ id }) => !['source-one', 'source-two'].includes(id))).toBe(true);
		expect(new Set(pasted?.images.map(({ id }) => id)).size).toBe(2);
		expect(pasted?.images.every(({ contentHash }) => !!contentHash)).toBe(true);
		expect(pasted!.images[0].createdAt).toBeLessThan(pasted!.images[1].createdAt);
		expect(pasted?.body).toBe(
			`Before\n![camp.webp](photo:${pasted?.images[1].id})\nBetween\n![shore.png](photo:${pasted?.images[0].id})\nAfter`
		);
	});

	it('rejects an own-note wrapper whose photo uses a remote URL', () => {
		const html = noteToClipboardHtml({ title: 'Trip', body: '![beach.webp](photo:p1)' }, [
			photo({ dataUrl: WEBP })
		]).replace(`src="${WEBP}"`, 'src="https://example.test/photo.webp"');

		expect(readCopiedNotePaste(clipboardHtml(html))).toBeNull();
	});
});

describe('clipboardPhotos', () => {
	it('keeps photos with bytes and skips files and thumb-only photos', () => {
		const ready = photo();
		const thumbOnly = photo({ id: 'p2', dataUrl: '', thumbUrl: PNG });
		const pdf = photo({ id: 'p3', mime: 'application/pdf', dataUrl: 'data:application/pdf,' });
		expect(clipboardPhotos([ready, thumbOnly, pdf])).toEqual([ready]);
	});
});

describe('writeNoteToClipboard', () => {
	it('writes text, HTML with the photos, and the first photo as PNG in one item', async () => {
		const items: FakeClipboardItem[] = [];
		const { writeText } = installClipboard(async (written) => {
			items.push(...written);
		});
		const encodePng = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));

		const copied = await writeNoteToClipboard(note({ images: [photo()] }), { encodePng });

		expect(copied).toBe(true);
		expect(items).toHaveLength(1);
		expect(Object.keys(items[0].data)).toEqual(['text/plain', 'text/html', 'image/png']);
		expect(await itemText(items[0], 'text/plain')).toBe('# Trip\npacking list\n[1 image(s)]');
		expect(await itemText(items[0], 'text/html')).toContain(`<img src="${WEBP}"`);
		expect(await itemText(items[0], 'image/png')).toBe('png');
		expect(encodePng).toHaveBeenCalledWith(photo());
		expect(writeText).not.toHaveBeenCalled();
	});

	it('loads photo bytes that only live in device storage', async () => {
		const items: FakeClipboardItem[] = [];
		installClipboard(async (written) => {
			items.push(...written);
		});
		const thumbOnly = photo({ dataUrl: '', thumbUrl: PNG });
		const loadPhotos = vi.fn(async () => [photo()]);

		await writeNoteToClipboard(note({ images: [thumbOnly] }), {
			loadPhotos,
			encodePng: async () => new Blob(['png'])
		});

		expect(loadPhotos).toHaveBeenCalled();
		expect(await itemText(items[0], 'text/html')).toContain(`<img src="${WEBP}"`);
	});

	it('copies plain text alone when the note has no photos', async () => {
		const { write, writeText } = installClipboard(async () => {});

		const copied = await writeNoteToClipboard(
			note({ images: [photo({ mime: 'application/pdf', dataUrl: 'data:application/pdf,' })] })
		);

		expect(copied).toBe(true);
		expect(write).not.toHaveBeenCalled();
		expect(writeText).toHaveBeenCalledWith('# Trip\npacking list\n[1 file(s)]');
	});

	it('drops the PNG when the browser rejects it, keeping the HTML photos', async () => {
		const items: FakeClipboardItem[] = [];
		const { write } = installClipboard(async (written) => {
			if ('image/png' in written[0].data) throw new DOMException('Type not supported');
			items.push(...written);
		});

		const copied = await writeNoteToClipboard(note({ images: [photo()] }), {
			encodePng: async () => new Blob(['png'])
		});

		expect(copied).toBe(true);
		expect(write).toHaveBeenCalledTimes(2);
		expect(Object.keys(items[0].data)).toEqual(['text/plain', 'text/html']);
	});

	it('falls back to plain text when every rich write fails', async () => {
		const { writeText } = installClipboard(async () => {
			throw new DOMException('Not allowed');
		});

		const copied = await writeNoteToClipboard(note({ images: [photo()] }), {
			encodePng: async () => new Blob(['png'])
		});

		expect(copied).toBe(true);
		expect(writeText).toHaveBeenCalledWith('# Trip\npacking list\n[1 image(s)]');
	});
});
