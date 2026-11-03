import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SERVER_ORIGIN, serverSetting } from '#lib/serverOrigin.svelte.js';
import { syncStore } from '#lib/stores/sync.svelte.js';
import ServerPrompt from './ServerPrompt.svelte';

const CHOSEN_KEY = 'scrapscache-server-chosen';

describe('ServerPrompt', () => {
	let onClose: ReturnType<typeof vi.fn<() => void>>;
	let serverChanged: ReturnType<typeof vi.spyOn>;
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		serverSetting.set(DEFAULT_SERVER_ORIGIN);
		localStorage.clear();
		onClose = vi.fn<() => void>();
		serverChanged = vi.spyOn(syncStore, 'serverChanged').mockImplementation(() => {});
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		serverChanged.mockRestore();
		serverSetting.set(DEFAULT_SERVER_ORIGIN);
	});

	it('offers the hosted service first, and using it answers the question for good', async () => {
		render(ServerPrompt, { props: { onClose } });
		expect(
			screen.getByRole<HTMLInputElement>('radio', { name: /^Scraps Cache scrapscache/ }).checked
		).toBe(true);
		expect(screen.getByRole<HTMLInputElement>('radio', { name: /^My own server/ }).checked).toBe(
			false
		);
		expect(localStorage.getItem(CHOSEN_KEY)).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Use Scraps Cache' }));
		expect(serverSetting.origin).toBe(DEFAULT_SERVER_ORIGIN);
		expect(localStorage.getItem(CHOSEN_KEY)).toBe('1');
		expect(serverChanged).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('is put away by Decide later without answering, so it asks again next launch', async () => {
		render(ServerPrompt, { props: { onClose } });
		await fireEvent.click(screen.getByRole('button', { name: 'Decide later' }));
		expect(onClose).toHaveBeenCalled();
		expect(localStorage.getItem(CHOSEN_KEY)).toBeNull();
		expect(serverSetting.origin).toBe(DEFAULT_SERVER_ORIGIN);
	});

	it('takes an own server by https address, reads its readiness, and switches to it', async () => {
		fetchMock.mockResolvedValue(Response.json({ ready: true }));
		render(ServerPrompt, { props: { onClose } });
		await fireEvent.click(screen.getByRole('radio', { name: /^My own server/ }));
		const field = screen.getByRole('textbox', { name: 'Server address' });
		await fireEvent.input(field, { target: { value: 'notes.example.org' } });
		expect(screen.getByRole('status').textContent).toContain('Checking…');

		await vi.advanceTimersByTimeAsync(600);
		await waitFor(() =>
			expect(screen.getByRole('status').textContent).toContain('Scraps Cache is answering there.')
		);
		expect(fetchMock).toHaveBeenCalledWith(
			'https://notes.example.org/health/ready',
			expect.objectContaining({ cache: 'no-store' })
		);

		await fireEvent.click(screen.getByRole('button', { name: 'Use this server' }));
		expect(serverSetting.origin).toBe('https://notes.example.org');
		expect(localStorage.getItem(CHOSEN_KEY)).toBe('1');
		expect(serverChanged).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalled();
	});

	it('warns when nothing answers there but still allows the address, and refuses what is not https', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
		render(ServerPrompt, { props: { onClose } });
		await fireEvent.click(screen.getByRole('radio', { name: /^My own server/ }));
		const field = screen.getByRole('textbox', { name: 'Server address' });
		const use = screen.getByRole<HTMLButtonElement>('button', { name: 'Use this server' });
		expect(use.disabled).toBe(true);

		await fireEvent.input(field, { target: { value: 'https://quiet.example' } });
		await vi.advanceTimersByTimeAsync(600);
		await waitFor(() =>
			expect(screen.getByRole('status').textContent).toContain(
				'No Scraps Cache server answered there. You can still use it.'
			)
		);
		expect(use.disabled).toBe(false);

		await fireEvent.input(field, { target: { value: 'http://plain.example' } });
		expect(screen.getByRole('alert').textContent).toContain('Enter an https address');
		expect(use.disabled).toBe(true);
		expect(field.getAttribute('aria-invalid')).toBe('true');
	});
});
