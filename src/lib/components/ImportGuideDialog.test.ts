import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ImportGuideDialog from './ImportGuideDialog.svelte';

describe('ImportGuideDialog', () => {
	it('explains Google Keep Takeout before a file is chosen', () => {
		render(ImportGuideDialog, { props: { onFile: vi.fn(), onClose: vi.fn() } });

		expect(screen.getByRole('heading', { name: 'Import notes' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'takeout.google.com' }).getAttribute('href')).toBe(
			'https://takeout.google.com'
		);
		expect(screen.getByText(/deselect all, then select only keep/i)).toBeTruthy();
		expect(screen.getByText(/titles, text, checklists, colors/i)).toBeTruthy();
		expect(screen.getByText(/reminders \(takeout usually omits them\)/i)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Choose file' })).toBeTruthy();
	});

	it('cancels without importing', async () => {
		const onClose = vi.fn();
		render(ImportGuideDialog, { props: { onFile: vi.fn(), onClose } });

		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onClose).toHaveBeenCalledOnce();
	});
});
