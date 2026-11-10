import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteImage } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import NoteEditor from './NoteEditor.svelte';

const imageConversion = vi.hoisted(() => ({ fileToNoteImage: vi.fn() }));
vi.mock('#lib/noteImages.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/noteImages.js')>()),
	fileToNoteImage: imageConversion.fileToNoteImage
}));

let conversionSequence = 0;

function convertedFile(file: File): NoteImage {
	const isPhoto = file.type.startsWith('image/');
	const mime = isPhoto ? 'image/webp' : file.type || 'application/octet-stream';
	const dataUrl = isPhoto ? 'data:image/webp;base64,YWJj' : 'data:text/plain;base64,dG9kbw==';
	conversionSequence += 1;
	return {
		id: `converted-${conversionSequence}`,
		mime,
		dataUrl,
		...(isPhoto ? { thumbUrl: dataUrl } : {}),
		name: file.name,
		createdAt: 1,
		contentHash: `${file.type}:${file.name}`,
		byteSize: file.size
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Groceries',
		body: 'Milk',
		color: 'green',
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

function editorOverlay(container: HTMLElement): HTMLElement {
	const overlay = container.querySelector('[data-editor-overlay]');
	if (!(overlay instanceof HTMLElement)) throw new Error('editor overlay missing');
	return overlay;
}

function createClipboardEvent(
	files: File[],
	text = '',
	types = files.length > 0 ? ['Files'] : ['text/plain']
): ClipboardEvent {
	const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
	const clipboardData = {
		files,
		items: files.map((f) => ({
			kind: 'file',
			type: f.type,
			getAsFile: () => f
		})),
		types,
		getData: (format: string) => (format === 'text/plain' ? text : ''),
		setData: () => {},
		clearData: () => {}
	};
	Object.defineProperty(event, 'clipboardData', { value: clipboardData });
	return event;
}

beforeEach(() => {
	vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
	conversionSequence = 0;
	imageConversion.fileToNoteImage.mockReset();
	imageConversion.fileToNoteImage.mockImplementation(async (file: File) => convertedFile(file));
});

afterEach(() => {
	vi.restoreAllMocks();
	notesStore.notes = [];
	notesStore.labels = [];
});

describe('NoteEditor paste photo', () => {
	it('asks for photo quality when a photo is pasted into NoteEditor', async () => {
		notesStore.notes = [note()];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const overlay = editorOverlay(container);
		const photo = new File(['fake-jpg-content'], 'camera.jpg', { type: 'image/jpeg' });

		const pasteEvent = createClipboardEvent([photo]);
		overlay.dispatchEvent(pasteEvent);
		expect(pasteEvent.defaultPrevented).toBe(true);

		await vi.waitFor(() => {
			expect(container.querySelector('#photo-quality-title')?.textContent).toContain(
				'Photo quality'
			);
		});
	});

	it('keeps the photo quality dialog above its backdrop', async () => {
		notesStore.notes = [note()];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const overlay = editorOverlay(container);
		const photo = new File(['fake-jpg-content'], 'camera.jpg', { type: 'image/jpeg' });

		overlay.dispatchEvent(createClipboardEvent([photo]));

		await vi.waitFor(() => {
			const backdrop = document.querySelector('[data-scope="dialog"][data-part="backdrop"]');
			const positioner = document.querySelector('[data-scope="dialog"][data-part="positioner"]');
			expect(backdrop).not.toBeNull();
			expect(positioner).not.toBeNull();
			expect(positioner?.className).toContain('z_101');
		});
	});

	it('attaches directly when a non-photo file is pasted into NoteEditor', async () => {
		notesStore.notes = [note()];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const overlay = editorOverlay(container);
		const file = new File(['todo list'], 'tasks.txt', { type: 'text/plain' });

		const pasteEvent = createClipboardEvent([file]);
		overlay.dispatchEvent(pasteEvent);
		expect(pasteEvent.defaultPrevented).toBe(true);

		await vi.waitFor(() => {
			expect(container.querySelector('[aria-label="Open tasks.txt"]')).not.toBeNull();
		});
	});

	it('waits for an accepted photo import before closing the editor', async () => {
		const pending = deferred<NoteImage>();
		imageConversion.fileToNoteImage.mockReturnValueOnce(pending.promise);
		const onClose = vi.fn();
		let registeredClose: (() => Promise<void>) | undefined;
		notesStore.notes = [note()];
		const { container } = render(NoteEditor, {
			props: {
				noteId: 'note-1',
				onClose,
				registerClose: (close) => (registeredClose = close)
			}
		});
		const photo = new File(['slow'], 'slow.png', { type: 'image/png' });
		editorOverlay(container).dispatchEvent(createClipboardEvent([photo]));
		await fireEvent.click(await screen.findByRole('button', { name: /^Compressed/ }));
		await vi.waitFor(() => expect(imageConversion.fileToNoteImage).toHaveBeenCalledTimes(1));

		if (!registeredClose) throw new Error('Editor close was not registered');
		const closing = registeredClose();
		await Promise.resolve();
		expect(onClose).not.toHaveBeenCalled();
		pending.resolve({
			id: 'slow-photo',
			mime: 'image/webp',
			dataUrl: 'data:image/webp;base64,YWJj',
			thumbUrl: 'data:image/webp;base64,YWJj',
			name: 'slow.webp',
			createdAt: 1,
			contentHash: 'slow-photo-hash',
			byteSize: 3
		});
		await closing;

		expect(onClose).toHaveBeenCalledOnce();
		expect(notesStore.notes[0].images?.map((attachment) => attachment.id)).toEqual(['slow-photo']);
	});

	it('intercepts paste and attaches photo when focused inside BodyEditor', async () => {
		notesStore.notes = [note()];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const bodyEditor = container.querySelector('[data-body-editor]') as HTMLElement;
		expect(bodyEditor).not.toBeNull();

		const photo = new File(['fake-png-content'], 'screenshot.png', { type: 'image/png' });
		const pasteEvent = createClipboardEvent([photo]);

		bodyEditor.dispatchEvent(pasteEvent);
		expect(pasteEvent.defaultPrevented).toBe(true);

		await vi.waitFor(() => {
			expect(container.querySelector('#photo-quality-title')?.textContent).toContain(
				'Photo quality'
			);
		});
	});

	it('intercepts paste and attaches photo when focused inside Title input', async () => {
		notesStore.notes = [note()];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const titleInput = container.querySelector('[placeholder="Title"]') as HTMLElement;
		expect(titleInput).not.toBeNull();

		const photo = new File(['fake-png-content'], 'pic.webp', { type: 'image/webp' });
		const pasteEvent = createClipboardEvent([photo]);

		titleInput.dispatchEvent(pasteEvent);
		expect(pasteEvent.defaultPrevented).toBe(true);

		await vi.waitFor(() => {
			expect(container.querySelector('#photo-quality-title')?.textContent).toContain(
				'Photo quality'
			);
		});
	});

	it('allows plain text paste in BodyEditor without attaching file', async () => {
		notesStore.notes = [note()];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const bodyEditor = container.querySelector('[data-body-editor]') as HTMLElement;
		const line = container.querySelector('[data-editor-line]') as HTMLElement;

		// Set selection range inside the editor line
		const textNode = line.firstChild ?? line;
		const range = document.createRange();
		range.setStart(textNode, 0);
		range.setEnd(textNode, 0);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		const textPaste = createClipboardEvent([], 'Apples');
		bodyEditor.dispatchEvent(textPaste);

		// Plain text paste should NOT show photo quality dialog
		await tick();
		expect(container.querySelector('#photo-quality-title')).toBeNull();
	});

	it('lifts a pasted markdown heading into the title of an empty note', async () => {
		notesStore.notes = [note({ title: '', body: '' })];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const bodyEditor = container.querySelector('[data-body-editor]') as HTMLElement;
		const line = container.querySelector('[data-editor-line]') as HTMLElement;
		const textNode = line.firstChild ?? line;
		const range = document.createRange();
		range.setStart(textNode, 0);
		range.setEnd(textNode, 0);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		const headingPaste = createClipboardEvent([], '# Trip\npacking list');
		bodyEditor.dispatchEvent(headingPaste);

		await vi.waitFor(() => {
			const titleInput = container.querySelector(
				'textarea[placeholder="Title"]'
			) as HTMLTextAreaElement;
			expect(titleInput.value).toBe('Trip');
		});
		const bodyLines = Array.from(container.querySelectorAll('[data-line-text]')).map(
			(el) => el.textContent
		);
		expect(bodyLines).toEqual(['packing list']);
	});

	it('keeps a markdown heading in the body of a note that already has content', async () => {
		notesStore.notes = [note()];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const bodyEditor = container.querySelector('[data-body-editor]') as HTMLElement;
		const line = container.querySelector('[data-editor-line]') as HTMLElement;
		const textNode = line.firstChild ?? line;
		const range = document.createRange();
		range.setStart(textNode, 0);
		range.setEnd(textNode, 0);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		const headingPaste = createClipboardEvent([], '# Pasted heading');
		bodyEditor.dispatchEvent(headingPaste);
		await tick();

		const titleInput = container.querySelector(
			'textarea[placeholder="Title"]'
		) as HTMLTextAreaElement;
		expect(titleInput.value).toBe('Groceries');
		const bodyLines = Array.from(container.querySelectorAll('[data-line-text]')).map(
			(el) => el.textContent
		);
		expect(bodyLines).toEqual(['# Pasted headingMilk']);
	});

	it('lifts a pasted markdown heading into an empty note even without a caret in the body', async () => {
		// Editor just opened: focus/selection has not reached the body editor yet.
		notesStore.notes = [note({ title: '', body: '' })];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const bodyEditor = container.querySelector('[data-body-editor]') as HTMLElement;
		expect(bodyEditor).not.toBeNull();

		const headingPaste = createClipboardEvent([], '# Trip\npacking list\nextra line');
		bodyEditor.dispatchEvent(headingPaste);

		await vi.waitFor(() => {
			const titleInput = container.querySelector(
				'textarea[placeholder="Title"]'
			) as HTMLTextAreaElement;
			expect(titleInput.value).toBe('Trip');
		});
		const bodyLines = Array.from(container.querySelectorAll('[data-line-text]')).map(
			(el) => el.textContent
		);
		expect(bodyLines).toEqual(['packing list', 'extra line']);
	});

	it('seeds an empty note with a paste that carries no heading when nothing is selected', async () => {
		notesStore.notes = [note({ title: '', body: '' })];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const bodyEditor = container.querySelector('[data-body-editor]') as HTMLElement;

		const textPaste = createClipboardEvent([], 'plain text\nsecond line');
		bodyEditor.dispatchEvent(textPaste);
		await tick();

		const titleInput = container.querySelector(
			'textarea[placeholder="Title"]'
		) as HTMLTextAreaElement;
		expect(titleInput.value).toBe('');
		const bodyLines = Array.from(container.querySelectorAll('[data-line-text]')).map(
			(el) => el.textContent
		);
		expect(bodyLines).toEqual(['plain text', 'second line']);
	});

	it('lifts a markdown heading pasted into the title field of an empty note', async () => {
		notesStore.notes = [note({ title: '', body: '' })];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const titleInput = container.querySelector(
			'textarea[placeholder="Title"]'
		) as HTMLTextAreaElement;
		expect(titleInput).not.toBeNull();

		const headingPaste = createClipboardEvent([], '# Trip\npacking list\nextra line');
		titleInput.dispatchEvent(headingPaste);

		await vi.waitFor(() => {
			const title = container.querySelector('textarea[placeholder="Title"]') as HTMLTextAreaElement;
			expect(title.value).toBe('Trip');
		});
		await vi.waitFor(() => {
			const bodyLines = Array.from(container.querySelectorAll('[data-line-text]')).map(
				(el) => el.textContent
			);
			expect(bodyLines).toEqual(['packing list', 'extra line']);
		});
	});

	it('ignores paste events originating from inside CanvasEditor', async () => {
		notesStore.notes = [note()];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});
		const overlay = editorOverlay(container);

		// Simulate a fake element inside .canvas-editor-shell
		const fakeShell = document.createElement('div');
		fakeShell.className = 'canvas-editor-shell';
		const canvasChild = document.createElement('div');
		fakeShell.appendChild(canvasChild);
		overlay.appendChild(fakeShell);

		const photo = new File(['bytes'], 'shot.png', { type: 'image/png' });
		const pasteEvent = createClipboardEvent([photo]);
		canvasChild.dispatchEvent(pasteEvent);

		await tick();
		expect(pasteEvent.defaultPrevented).toBe(false);
		expect(container.querySelector('#photo-quality-title')).toBeNull();
	});
});
