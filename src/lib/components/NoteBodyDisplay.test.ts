import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import NoteBodyDisplay from './NoteBodyDisplay.svelte';
import type { Note } from '$lib/types';
import { notesStore } from '$lib/stores/notes.svelte';
import { uiStore } from '$lib/stores/ui.svelte';

const PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Wasm',
		body: 'https://webassembly.org/',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		images: [
			{
				id: 'photo-1',
				mime: 'image/png',
				dataUrl: PNG,
				name: 'who-wins.png',
				createdAt: 1
			}
		],
		...partial
	};
}

afterEach(() => {
	notesStore.notes = [];
	notesStore.labels = [];
	uiStore.rawMarkdown = false;
});

describe('NoteBodyDisplay attachment order', () => {
	it('lists links with the file rows after the note body, photos last', () => {
		const { container } = render(NoteBodyDisplay, { props: { note: note() } });
		const filesAndLinks = container.querySelector('[aria-label="Files and links"]');
		const photos = container.querySelector('[aria-label="Photos"]');
		expect(filesAndLinks).toBeTruthy();
		expect(photos).toBeTruthy();
		expect(
			filesAndLinks!.compareDocumentPosition(photos!) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		// A URL renders as a pseudo file row showing its hostname.
		expect(filesAndLinks!.textContent).toContain('webassembly.org');
	});
});

describe('NoteBodyDisplay inline Markdown', () => {
	it('styles supported Markdown and hides its delimiters by default', () => {
		const { container } = render(NoteBodyDisplay, {
			props: { note: note({ body: '**bold** *italic* `code` ~~removed~~' }) }
		});

		expect(container.querySelector('.markdown-token-strong')?.textContent).toBe('bold');
		expect(container.querySelector('.markdown-token-emphasis')?.textContent).toBe('italic');
		expect(container.querySelector('.markdown-token-code')?.textContent).toBe('code');
		expect(container.querySelector('.markdown-token-strikethrough')?.textContent).toBe('removed');
		expect(container.querySelectorAll('.markdown-token-marker-hidden')).toHaveLength(8);
	});

	it('reveals raw delimiters and syntax colors when enabled', () => {
		uiStore.rawMarkdown = true;
		const { container } = render(NoteBodyDisplay, {
			props: { note: note({ body: '## **bold** `code` ~~removed~~' }) }
		});

		expect(container.querySelector('.markdown-content')?.classList.contains('markdown-raw')).toBe(
			true
		);
		expect(container.querySelectorAll('.markdown-token-marker-hidden')).toHaveLength(0);
		expect(container.querySelector('[data-markdown-token="heading"]')?.textContent).toBe('## ');
		expect(
			container.querySelector('.markdown-token-strong:not(.markdown-token-marker)')?.textContent
		).toBe('bold');
	});
});

describe('NoteBodyDisplay Markdown blocks', () => {
	it('renders Markdown tables as semantic tables', () => {
		const { container } = render(NoteBodyDisplay, {
			props: {
				note: note({
					body: [
						'| Rule name | Matches path | Limit |',
						'| --- | --- | ---: |',
						'| register | `/api/sync/register` | 5 per hour |'
					].join('\n')
				})
			}
		});

		const table = container.querySelector('[data-markdown-table]');
		expect(table).toBeTruthy();
		expect(table?.querySelectorAll('th')).toHaveLength(3);
		expect(table?.querySelectorAll('tbody tr')).toHaveLength(1);
		expect(table?.textContent).not.toContain('---');
		expect(
			table?.querySelector('.markdown-token-code:not(.markdown-token-marker)')?.textContent
		).toBe('/api/sync/register');
	});

	it('renders fenced code with safe syntax tokens', () => {
		const { container } = render(NoteBodyDisplay, {
			props: {
				note: note({
					body: [
						'before',
						'',
						'```sh',
						'# comment',
						'wrangler d1 --remote --command "SELECT 1"',
						'```',
						'',
						'after'
					].join('\n')
				})
			}
		});

		const code = container.querySelector('[data-markdown-code-block]');
		expect(code?.tagName).toBe('PRE');
		expect(code?.getAttribute('data-language')).toBe('sh');
		expect(code?.textContent).toContain('# comment');
		expect(code?.querySelector('.markdown-code-token-comment')?.textContent).toBe('# comment');
		expect(code?.querySelector('.markdown-code-token-flag')?.textContent).toBe('--remote');
		expect(code?.querySelector('.markdown-code-token-string')?.textContent).toBe('"SELECT 1"');
	});

	it('keeps HTML-looking code as text', () => {
		const { container } = render(NoteBodyDisplay, {
			props: { note: note({ body: '```html\n<script>alert(1)</script>\n```' }) }
		});

		const code = container.querySelector('[data-markdown-code-block]');
		expect(code?.querySelector('script')).toBeNull();
		expect(code?.textContent).toContain('<script>alert(1)</script>');
	});

	it('keeps table source visible when raw Markdown is enabled', () => {
		uiStore.rawMarkdown = true;
		const { container } = render(NoteBodyDisplay, {
			props: {
				note: note({
					body: [
						'| Rule name | Matches path |',
						'| --- | --- |',
						'| register | `/api` |',
						'',
						'Leave headroom rather than tightening the rule.'
					].join('\n')
				})
			}
		});

		expect(container.querySelector('[data-markdown-table]')).toBeNull();
		const rawTable = container.querySelector('[data-markdown-raw-table-container]');
		expect(rawTable).toBeTruthy();
		expect(rawTable?.querySelector('.markdown-raw-display-table')).toBeTruthy();
		expect(rawTable?.querySelectorAll('.markdown-raw-table-display-cell')).toHaveLength(6);
		expect(rawTable?.textContent).toContain('| Rule name | Matches path |');
		expect(rawTable?.textContent).toContain('| register | `/api` |');
		expect(container.querySelector('.markdown-content')?.textContent).toContain(
			'Leave headroom rather than tightening the rule.'
		);
		expect(container.querySelector('.markdown-content')?.classList).toContain('markdown-raw');
	});
});
