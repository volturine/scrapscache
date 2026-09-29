import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_AI_MODELS } from '$lib/localAi';
import { localAiStore, LocalAiStatus } from '$lib/stores/localAi.svelte';
import LocalAiModelDialog from './LocalAiModelDialog.svelte';

beforeEach(() => {
	localAiStore.status = LocalAiStatus.Absent;
	localAiStore.progress = 0;
	localAiStore.error = '';
});

afterEach(() => {
	localAiStore.status = LocalAiStatus.Unsupported;
	localAiStore.progress = 0;
	localAiStore.error = '';
	vi.restoreAllMocks();
});

describe('LocalAiModelDialog', () => {
	it('sets up a local WebLLM model without provider or key fields', async () => {
		const onSelect = vi.fn();
		const onClose = vi.fn();
		render(LocalAiModelDialog, { props: { onSelect, onClose } });

		expect(screen.getByRole('heading', { name: 'Set up on-device AI' })).toBeTruthy();
		expect(screen.getByText(/No external AI provider, account, or API key/)).toBeTruthy();
		expect(screen.queryByRole('textbox')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: /Qwen3 1.7B/ }));

		expect(onSelect).toHaveBeenCalledWith(LOCAL_AI_MODELS[0]);
		expect(onClose).not.toHaveBeenCalled();
	});

	it('shows model download progress and lets the user cancel it', async () => {
		localAiStore.status = LocalAiStatus.Downloading;
		localAiStore.progress = 0.42;
		render(LocalAiModelDialog, { props: { onSelect: vi.fn(), onClose: vi.fn() } });

		expect(
			screen
				.getByRole('progressbar', { name: 'Model download progress' })
				.getAttribute('aria-valuenow')
		).toBe('42');
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));
		expect(localAiStore.status).toBe(LocalAiStatus.Absent);
	});
});
