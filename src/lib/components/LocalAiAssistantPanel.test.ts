import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localAiStore } from '$lib/stores/localAi.svelte';
import LocalAiAssistantPanel from './LocalAiAssistantPanel.svelte';

afterEach(() => vi.restoreAllMocks());

describe('LocalAiAssistantPanel', () => {
	it('keeps an edit as a proposal until the user accepts it', async () => {
		const generate = vi.spyOn(localAiStore, 'generate').mockResolvedValue('Revised note');
		const onApply = vi.fn();
		render(LocalAiAssistantPanel, {
			props: { title: 'Trip', body: 'Old note text', onApply, onDismiss: vi.fn() }
		});

		await fireEvent.input(screen.getByRole('textbox', { name: 'Edit instruction' }), {
			target: { value: 'Make this shorter' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Propose' }));

		expect(await screen.findByText('Proposal · nothing has changed yet')).toBeTruthy();
		expect(generate).toHaveBeenCalledOnce();
		expect(onApply).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
		expect(onApply).toHaveBeenCalledWith('Revised note', 'edit');
	});

	it('answers locally, closes the keyboard, and inserts only after the user chooses Insert', async () => {
		const generate = vi.spyOn(localAiStore, 'generate').mockResolvedValue('Meet at 14:10.');
		const onApply = vi.fn();
		render(LocalAiAssistantPanel, {
			props: { title: 'Trip', body: 'Flight lands at 14:10.', onApply, onDismiss: vi.fn() }
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
		const question = screen.getByRole('textbox', { name: 'Question about this note' });
		await fireEvent.input(question, {
			target: { value: 'When does the flight land?' }
		});
		const askButtons = screen.getAllByRole('button', { name: 'Ask' });
		const submitAsk = askButtons.at(-1);
		if (!submitAsk) throw new Error('Expected the Ask button');
		await fireEvent.click(submitAsk);

		expect(await screen.findByText('Meet at 14:10.')).toBeTruthy();
		await tick();
		expect(document.activeElement).not.toBe(question);
		expect(screen.getByRole('textbox', { name: 'Ask a follow-up' })).toBeTruthy();
		expect(generate).toHaveBeenCalledOnce();
		expect(onApply).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
		expect(onApply).toHaveBeenCalledWith('Meet at 14:10.', 'ask');
	});
});
