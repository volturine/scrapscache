import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNC_DELTA_PATH, SYNC_PROTOCOL_VERSION } from '#lib/model/protocol.js';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { CANVAS_MIME } from '#lib/canvasAttachment.js';
import type { Note } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { syncStore, SYNC_VERSION_MISMATCH_MESSAGE } from '#lib/stores/sync.svelte.js';
import CanvasEditor from './CanvasEditor.svelte';
import NoteEditor from './NoteEditor.svelte';

const canvasModule = vi.hoisted(() => ({ mountExcalidraw: vi.fn() }));

vi.mock('#lib/excalidrawHost.js', () => canvasModule);

type Reply = { status: number; body: Record<string, unknown> };

let replies: Reply[] = [];

class FakeXhr {
	status = 0;
	responseText = '';
	timeout = 0;
	upload = { onprogress: null };
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	ontimeout: (() => void) | null = null;
	onabort: (() => void) | null = null;
	onprogress: (() => void) | null = null;

	open(): void {}

	setRequestHeader(): void {}

	getResponseHeader(): null {
		return null;
	}

	send(): void {
		const reply = replies.shift() ?? { status: 200, body: {} };
		queueMicrotask(() => {
			this.status = reply.status;
			this.responseText = JSON.stringify(reply.body);
			this.onload?.();
		});
	}
}

type SyncTransport = {
	sendSyncRequest(
		path: string,
		payload: string,
		uploadBytes: number,
		indicate: boolean
	): Promise<{ success: boolean; status?: number; error?: string }>;
	accessToken(account: unknown): Promise<string>;
};

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Title',
		body: 'Body',
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

function caretAtEnd(container: HTMLElement) {
	const text = container.querySelector('[data-line-text]')!;
	const range = document.createRange();
	range.selectNodeContents(text);
	range.collapse(false);
	window.getSelection()?.removeAllRanges();
	window.getSelection()?.addRange(range);
}

async function typeBody(container: HTMLElement, value: string) {
	const editor = container.querySelector('[data-body-editor]') as HTMLElement;
	caretAtEnd(container);
	for (const data of value) {
		editor.dispatchEvent(
			new InputEvent('beforeinput', {
				bubbles: true,
				cancelable: true,
				inputType: 'insertText',
				data
			})
		);
	}
	await tick();
}

function storedNote(): Note {
	return notesStore.notes.find((item) => item.id === 'note-1')!;
}

async function requestMismatch() {
	const transport = syncStore as unknown as SyncTransport;
	vi.spyOn(transport, 'accessToken').mockResolvedValue('token');
	return transport.sendSyncRequest(SYNC_DELTA_PATH, '{}', 2, false);
}

function stubReload() {
	const reload = vi.fn();
	const locationWithReload = new Proxy(window.location, {
		get(target, property) {
			if (property === 'reload') return reload;
			const value = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
	vi.stubGlobal('location', locationWithReload);
	return reload;
}

beforeEach(() => {
	vi.stubGlobal('XMLHttpRequest', FakeXhr);
	replies = [
		{
			status: 409,
			body: {
				error: 'Sync protocol version mismatch.',
				requiredVersion: String(Number(SYNC_PROTOCOL_VERSION) + 1)
			}
		}
	];
	syncStore.account = createSyncIdentity();
	syncStore.lastError = null;
	notesStore.notes = [note()];
	vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
	vi.spyOn(notesStore, 'flushNote').mockResolvedValue();
	vi.spyOn(notesStore, 'discardIfEmpty').mockResolvedValue();
	vi.spyOn(notesStore, 'syncPendingChanges').mockResolvedValue(false);
	canvasModule.mountExcalidraw.mockImplementation(async (node: HTMLElement) => {
		const surface = document.createElement('div');
		surface.dataset.testid = 'fake-canvas-surface';
		node.append(surface);
		return {
			destroy: vi.fn(),
			snapshot: vi.fn(() => ({
				elements: [{ id: 'shape-1', type: 'rectangle', x: 10, y: 20, width: 100, height: 50 }],
				appState: {}
			})),
			thumbnail: vi.fn(async () => ({
				dataUrl: 'data:image/webp;base64,AA==',
				width: 480,
				height: 360
			})),
			showLibrary: vi.fn()
		};
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	syncStore.account = null;
	syncStore.lastError = null;
	syncStore.onSyncStart = null;
	syncStore.onSyncEnd = null;
	notesStore.notes = [];
});

describe('sync version mismatch while an editor is open', () => {
	it('keeps an uncommitted text draft open so it can be saved normally', async () => {
		const reload = stubReload();
		let closeEditor = async () => {};
		const { container } = render(NoteEditor, {
			props: {
				noteId: 'note-1',
				onClose: () => {},
				registerClose: (close: () => Promise<void>) => {
					closeEditor = close;
				}
			}
		});

		await typeBody(container, '!');
		expect(storedNote().body).toBe('Body');

		await expect(requestMismatch()).resolves.toMatchObject({
			success: false,
			status: 409,
			error: SYNC_VERSION_MISMATCH_MESSAGE
		});

		expect(container.querySelector('[data-body-editor]')).not.toBeNull();
		expect(reload).not.toHaveBeenCalled();
		await closeEditor();
		expect(storedNote().body).toBe('Body!');
		expect(notesStore.flushNote).toHaveBeenCalledWith('note-1');
	});

	it('keeps a dirty canvas open through mismatch and lets it save', async () => {
		const reload = stubReload();
		const onSave = vi.fn();
		const onClose = vi.fn();
		const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
		render(CanvasEditor, { props: { onSave, onClose } });
		await vi.waitFor(() => expect(canvasModule.mountExcalidraw).toHaveBeenCalledOnce());
		await fireEvent.pointerDown(screen.getByTestId('fake-canvas-surface'));
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel canvas editing' }));
		expect(confirm).toHaveBeenCalledWith('Discard your unsaved canvas changes?');
		expect(onClose).not.toHaveBeenCalled();

		await expect(requestMismatch()).resolves.toMatchObject({
			success: false,
			status: 409,
			error: SYNC_VERSION_MISMATCH_MESSAGE
		});

		expect(screen.getByRole('dialog', { name: 'New canvas' })).toBeTruthy();
		expect(reload).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
		await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
		expect(onSave.mock.calls[0][0]).toMatchObject({ mime: CANVAS_MIME });
		expect(onClose).toHaveBeenCalledOnce();
	});
});
