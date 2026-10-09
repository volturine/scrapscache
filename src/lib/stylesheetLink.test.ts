import { afterEach, describe, expect, it } from 'vitest';
import { linkStylesheet } from './stylesheetLink';

function links(href: string): HTMLLinkElement[] {
	return Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[href="${href}"]`));
}

describe('linkStylesheet', () => {
	afterEach(() => {
		document.head.querySelectorAll('link').forEach((link) => link.remove());
	});

	it('adds one stylesheet link for repeated calls and resolves when it loads', async () => {
		const href = '/assets/once.css';
		const first = linkStylesheet(href);
		const second = linkStylesheet(href);
		expect(links(href)).toHaveLength(1);
		expect(links(href)[0].rel).toBe('stylesheet');

		links(href)[0].dispatchEvent(new Event('load'));
		await expect(first).resolves.toBeUndefined();
		await expect(second).resolves.toBeUndefined();
		expect(links(href)).toHaveLength(1);
	});

	it('removes a link that failed to load and tries again on the next call', async () => {
		const href = '/assets/retry.css';
		const failed = linkStylesheet(href);
		links(href)[0].dispatchEvent(new Event('error'));
		await expect(failed).rejects.toThrow('Could not load the canvas editor styles.');
		expect(links(href)).toHaveLength(0);

		const retried = linkStylesheet(href);
		expect(links(href)).toHaveLength(1);
		links(href)[0].dispatchEvent(new Event('load'));
		await expect(retried).resolves.toBeUndefined();
	});
});
