import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localAiStore } from '$lib/stores/localAi.svelte';
import LocalAiAssistantPanel from './LocalAiAssistantPanel.svelte';

afterEach(() => vi.restoreAllMocks());

describe('LocalAiAssistantPanel', () => {
	it('returns focus to the opener after dismissal', async () => {
		const opener = document.createElement('button');
		document.body.append(opener);
		opener.focus();
		const onDismiss = vi.fn();
		const { unmount } = render(LocalAiAssistantPanel, {
			props: { title: 'Trip', body: '', onApply: vi.fn(), onDismiss }
		});

		const prompt = screen.getByRole('textbox', { name: 'Edit instruction' });
		expect(document.activeElement).toBe(prompt);
		await fireEvent.click(screen.getByRole('button', { name: 'Close assistant' }));
		expect(onDismiss).toHaveBeenCalledOnce();
		unmount();
		expect(document.activeElement).toBe(opener);
		opener.remove();
	});

	it('keeps the prompt focused while sending an edit instruction', async () => {
		let resolve!: (value: string) => void;
		const generate = vi
			.spyOn(localAiStore, 'generate')
			.mockReturnValue(new Promise((res) => (resolve = res)));
		render(LocalAiAssistantPanel, {
			props: { title: 'Trip', body: 'Old note text', onApply: vi.fn(), onDismiss: vi.fn() }
		});

		const prompt = screen.getByRole('textbox', { name: 'Edit instruction' });
		await fireEvent.input(prompt, { target: { value: 'Make this shorter' } });
		const send = screen.getByRole('button', { name: 'Send' });
		send.focus();
		await fireEvent.click(send);

		expect(generate).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(prompt);
		expect((prompt as HTMLInputElement).disabled).toBe(false);
		resolve('Revised note');
		expect(await screen.findByText('Proposal · nothing has changed yet')).toBeTruthy();
		expect(document.activeElement).toBe(prompt);
	});

	it('keeps an edit as a proposal until the user accepts it', async () => {
		const generate = vi.spyOn(localAiStore, 'generate').mockResolvedValue('Revised note');
		const onApply = vi.fn();
		render(LocalAiAssistantPanel, {
			props: { title: 'Trip', body: 'Old note text', onApply, onDismiss: vi.fn() }
		});

		await fireEvent.input(screen.getByRole('textbox', { name: 'Edit instruction' }), {
			target: { value: 'Make this shorter' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

		expect(await screen.findByText('Proposal · nothing has changed yet')).toBeTruthy();
		expect(generate).toHaveBeenCalledOnce();
		expect(onApply).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
		expect(onApply).toHaveBeenCalledWith('Revised note', 'edit');
	});

	it('answers locally, keeps the prompt ready for follow-up, and inserts only on request', async () => {
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
		await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

		expect(await screen.findByText('Meet at 14:10.')).toBeTruthy();
		expect(document.activeElement).toBe(question);
		expect(screen.getByRole('textbox', { name: 'Ask a follow-up' })).toBeTruthy();
		expect(generate).toHaveBeenCalledOnce();
		expect(onApply).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
		expect(onApply).toHaveBeenCalledWith('Meet at 14:10.', 'ask');
	});
});
