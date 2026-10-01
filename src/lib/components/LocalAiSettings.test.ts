import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localAiStore, LocalAiStatus } from '$lib/stores/localAi.svelte';
import LocalAiSettings from './LocalAiSettings.svelte';

const ENABLED_STORAGE_KEY = 'scrapscache.localAiEnabled';

beforeEach(() => {
	localStorage.clear();
	localAiStore.enabled = true;
	localAiStore.status = LocalAiStatus.Absent;
	localAiStore.progress = 0;
	localAiStore.error = '';
});

afterEach(() => {
	localStorage.clear();
	localAiStore.enabled = true;
	localAiStore.status = LocalAiStatus.Unsupported;
	localAiStore.progress = 0;
	localAiStore.error = '';
	vi.restoreAllMocks();
});

describe('LocalAiSettings', () => {
	it('hides model controls when AI is disabled and restores them when enabled', async () => {
		const onChoose = vi.fn();
		render(LocalAiSettings, { props: { onChoose } });
		const toggle = screen.getByRole('checkbox', { name: 'AI features' });

		expect(toggle.getAttribute('aria-describedby')).toBe('local-ai-toggle-description');
		expect(screen.getByRole('button', { name: 'Choose a local AI model' })).toBeTruthy();
		await fireEvent.click(toggle);

		expect(localAiStore.enabled).toBe(false);
		expect(localStorage.getItem(ENABLED_STORAGE_KEY)).toBe('false');
		expect(screen.queryByRole('button', { name: 'Choose a local AI model' })).toBeNull();
		expect(screen.getByText('AI controls are hidden in this browser.')).toBeTruthy();

		await fireEvent.click(toggle);
		expect(localAiStore.enabled).toBe(true);
		expect(screen.getByRole('button', { name: 'Choose a local AI model' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Choose a local AI model' }));
		expect(onChoose).toHaveBeenCalledOnce();
	});
});
