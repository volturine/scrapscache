import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSharedNote } from '$lib/shareCrypto';
import type { Note } from '$lib/types';
import SharePage from './[id]/+page.svelte';

vi.mock('$app/state', () => ({
	page: {
		params: { id: 'test-share-id' },
		url: new URL('https://scrapscache.test/share/test-share-id')
	}
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

describe('Share recipient page', () => {
	const sampleNote: Note = {
		id: 'src-1',
		title: 'Project Roadmap',
		body: '- [x] Phase 1\n- [ ] Phase 2\nSecret launch details.',
		color: 'teal',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1700000000000,
		updatedAt: 1700000000000,
		reminder: null,
		labels: [],
		images: [],
		linkPreviews: []
	};

	beforeEach(() => {
		vi.restoreAllMocks();
		window.location.hash = '';
	});

	it('shows error when URL hash decryption key is missing', async () => {
		window.location.hash = '';
		render(SharePage);

		await waitFor(() => {
			expect(screen.getByText('Could not open note')).toBeTruthy();
			expect(screen.getByText(/Missing decryption key in URL/i)).toBeTruthy();
		});
	});

	it('shows unavailable screen when server returns 404 (burned or expired)', async () => {
		const { key } = encryptSharedNote(sampleNote, []);
		window.location.hash = `#${key}`;

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				status: 404,
				ok: false
			})
		);

		render(SharePage);

		await waitFor(() => {
			expect(screen.getByText('Note unavailable')).toBeTruthy();
			expect(screen.getByText(/expired or was already read/i)).toBeTruthy();
		});
	});

	it('decrypts note on client side and renders title, checklists, and e2e badge', async () => {
		const { ciphertext, key } = encryptSharedNote(sampleNote, ['Work', 'Q3']);
		window.location.hash = `#${key}`;

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				status: 200,
				ok: true,
				json: async () => ({
					id: 'test-share-id',
					ciphertext,
					burnAfterReading: false,
					expiresAt: Date.now() + 86400000
				})
			})
		);

		render(SharePage);

		await waitFor(() => {
			expect(screen.getByText('Project Roadmap')).toBeTruthy();
			expect(screen.getByText('Phase 1')).toBeTruthy();
			expect(screen.getByText('Phase 2')).toBeTruthy();
			expect(screen.getByText('Secret launch details.')).toBeTruthy();
			expect(screen.getByText('Work')).toBeTruthy();
			expect(screen.getByText('Q3')).toBeTruthy();
			expect(screen.getByText(/End-to-end encrypted/i)).toBeTruthy();
		});

		// Toggle checklist item
		const checkbox = screen.getByText('Phase 2').closest('button');
		expect(checkbox).toBeTruthy();
		if (checkbox) {
			await fireEvent.click(checkbox);
			expect(screen.getByText('Phase 2').classList.contains('line-through')).toBe(true);
		}
	});

	it('renders burn after reading warning when burnAfterReading is true', async () => {
		const { ciphertext, key } = encryptSharedNote(sampleNote, []);
		window.location.hash = `#${key}`;

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				status: 200,
				ok: true,
				json: async () => ({
					id: 'test-share-id',
					ciphertext,
					burnAfterReading: true,
					expiresAt: Date.now() + 3600000
				})
			})
		);

		render(SharePage);

		await waitFor(() => {
			expect(screen.getByText(/Burn after reading \(deleted from server\)/i)).toBeTruthy();
		});
	});

	it('imports shared note into Scraps Cache and navigates to the imported note', async () => {
		const { ciphertext, key } = encryptSharedNote(sampleNote, ['TestTag']);
		window.location.hash = `#${key}`;

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				status: 200,
				ok: true,
				json: async () => ({
					id: 'test-share-id',
					ciphertext,
					burnAfterReading: false,
					expiresAt: Date.now() + 86400000
				})
			})
		);

		render(SharePage);

		await waitFor(() => {
			expect(screen.getByText('Import to Scraps Cache')).toBeTruthy();
		});

		const importButton = screen.getByRole('button', { name: /Import to Scraps Cache/i });
		await fireEvent.click(importButton);

		await waitFor(() => {
			expect(screen.getByText(/Imported to Scraps Cache!/i)).toBeTruthy();
		});
	});
});
