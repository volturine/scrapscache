import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigationMocks = vi.hoisted(() => ({ goto: vi.fn() }));
const cryptoMocks = vi.hoisted(() => ({
	isEncryptedScrapsCacheBackup: vi.fn(() => true),
	decryptBackup: vi.fn(),
	encryptBackup: vi.fn()
}));

vi.mock('$app/navigation', () => navigationMocks);
vi.mock('$lib/editorContext', () => ({
	useEditorActions: () => ({ startNewNote: vi.fn(), closeNote: vi.fn() })
}));
vi.mock('$lib/backupCrypto', () => cryptoMocks);

import { BackupImportMode } from '$lib/backup';
import { notesStore } from '$lib/stores/notes.svelte';
import Topbar from './Topbar.svelte';

const decryptedBackup = {
	version: 4,
	exportedAt: 1,
	notes: [],
	labels: [],
	boards: [],
	activeBoardId: '',
	tombstones: {},
	labelTombstones: {},
	boardTombstones: {},
	ui: { sidebarOpen: true, dark: null, layout: 'grid', view: 'notes', rawMarkdown: false }
};

function encryptedFile(): File {
	return new File(['{}'], 'backup.scraps-cache-backup', { type: 'application/json' });
}

function assignFile(input: HTMLInputElement, file: File) {
	Object.defineProperty(input, 'files', { configurable: true, value: [file] });
}

describe('Topbar backup import', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('keeps the encrypted backup flow alive through unlock and import mode selection', async () => {
		cryptoMocks.decryptBackup.mockResolvedValue(decryptedBackup);
		const importBackup = vi.spyOn(notesStore, 'importBackup').mockResolvedValue({ success: true });
		render(Topbar);

		await fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
		const importMenuItem = screen.getByRole('menuitem', { name: 'Import backup' });
		await fireEvent.pointerDown(importMenuItem, { pointerType: 'mouse' });
		await fireEvent.click(importMenuItem);
		await waitFor(() => expect(screen.getByRole('heading', { name: 'Import notes' })).toBeTruthy());

		const input = document.querySelector('input[type="file"]');
		if (!(input instanceof HTMLInputElement)) throw new Error('backup file input missing');
		assignFile(input, encryptedFile());
		await fireEvent.change(input);

		await waitFor(() =>
			expect(screen.getByRole('heading', { name: 'Unlock this backup' })).toBeTruthy()
		);
		await fireEvent.input(screen.getByLabelText('Backup passphrase'), {
			target: { value: 'a strong passphrase' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Unlock and import' }));

		await waitFor(() =>
			expect(
				screen.getByRole('heading', { name: 'How should this backup be imported?' })
			).toBeTruthy()
		);
		await fireEvent.click(screen.getByRole('button', { name: /keep local notes/i }));

		await waitFor(() =>
			expect(importBackup).toHaveBeenCalledWith(decryptedBackup, BackupImportMode.Keep)
		);
	});
});
