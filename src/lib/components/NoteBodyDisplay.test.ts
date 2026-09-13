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
