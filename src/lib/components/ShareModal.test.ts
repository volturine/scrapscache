import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '$lib/types';
import ShareModal from './ShareModal.svelte';

describe('ShareModal', () => {
	const sampleNote: Note = {
		id: 'note-1',
		title: 'Secret Meeting Notes',
		body: '- [x] Topic 1\n- [ ] Topic 2\nClassified details.',
		color: 'green',
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
	});

	it('renders dialog with note details and security explanation', () => {
		render(ShareModal, { props: { note: sampleNote, onClose: vi.fn() } });

		expect(screen.getByRole('heading', { name: 'Share Note' })).toBeTruthy();
		expect(screen.getByText(/Zero-knowledge encrypted secret link/i)).toBeTruthy();
		expect(screen.getByText(/Your note is encrypted directly on your device/i)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Create Secret Link' })).toBeTruthy();
	});

	it('creates encrypted share link and renders copy & QR code options', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ id: 'mock-share-id-123', expiresAt: Date.now() + 86400000 })
		});
		vi.stubGlobal('fetch', mockFetch);

		render(ShareModal, { props: { note: sampleNote, onClose: vi.fn() } });

		const createButton = screen.getByRole('button', { name: 'Create Secret Link' });
		await fireEvent.click(createButton);

		await waitFor(() => {
			expect(mockFetch).toHaveBeenCalledWith(
				'/api/share',
				expect.objectContaining({
					method: 'POST'
				})
			);
		});

		const callArgs = mockFetch.mock.calls[0];
		const body = JSON.parse(callArgs[1].body);
		expect(body.ciphertext).toBeDefined();
		expect(body.burnAfterReading).toBe(false);
		expect(body.expiresInMs).toBe(86400000);

		// The link input should contain the share link with hash fragment
		await waitFor(() => {
			const linkInput = screen.getByDisplayValue(/\/share\/mock-share-id-123#/);
			expect(linkInput).toBeTruthy();
		});

		// QR code toggle button
		const qrToggle = screen.getByRole('button', { name: /Show QR code/i });
		await fireEvent.click(qrToggle);

		await waitFor(() => {
			expect(screen.getByRole('button', { name: /Hide QR code/i })).toBeTruthy();
		});
	});

	it('supports toggling burn after reading before link creation', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ id: 'burn-share-id', expiresAt: Date.now() + 3600000 })
		});
		vi.stubGlobal('fetch', mockFetch);

		render(ShareModal, { props: { note: sampleNote, onClose: vi.fn() } });

		// Toggle burn after reading checkbox
		const burnToggle = screen.getByRole('checkbox', { name: /Burn after reading/i });
		await fireEvent.click(burnToggle);

		// Select 1 hour expiration
		const select = screen.getByLabelText(/Link lifetime/i);
		await fireEvent.change(select, { target: { value: '3600000' } });

		const createButton = screen.getByRole('button', { name: 'Create Secret Link' });
		await fireEvent.click(createButton);

		await waitFor(() => {
			expect(mockFetch).toHaveBeenCalled();
		});

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.burnAfterReading).toBe(true);
		expect(body.expiresInMs).toBe(3600000);
	});
});
