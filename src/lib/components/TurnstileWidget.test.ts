import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import TurnstileWidget from './TurnstileWidget.svelte';

const ORIGIN = 'https://verify.scrapscache.com';

function post(source: MessageEventSource | null, data: unknown, origin = ORIGIN) {
	window.dispatchEvent(new MessageEvent('message', { origin, source, data }));
}

function mount() {
	let token = '';
	const view = render(TurnstileWidget, {
		props: {
			origin: ORIGIN,
			action: 'register',
			get token() {
				return token;
			},
			set token(value: string) {
				token = value;
			}
		}
	});
	const frame = screen.getByTitle('Human verification') as HTMLIFrameElement;
	return { view, frame, token: () => token };
}

describe('Turnstile widget isolation', () => {
	it('accepts a token only from its own frame on the challenge origin', async () => {
		const { frame, token } = mount();

		post(frame.contentWindow, { type: 'scrapscache-turnstile', token: 'real' });
		await tick();

		expect(token()).toBe('real');
	});

	it('ignores the right origin speaking through a different window', async () => {
		const { token } = mount();
		const other = document.createElement('iframe');
		document.body.append(other);

		post(other.contentWindow, { type: 'scrapscache-turnstile', token: 'forged' });
		await tick();

		expect(token()).toBe('');
		other.remove();
	});

	it('ignores its own frame claiming to be another origin', async () => {
		const { frame, token } = mount();

		post(
			frame.contentWindow,
			{ type: 'scrapscache-turnstile', token: 'forged' },
			'https://evil.example'
		);
		await tick();

		expect(token()).toBe('');
	});

	it('ignores messages of any other shape, and oversized tokens', async () => {
		const { frame, token } = mount();

		post(frame.contentWindow, { type: 'something-else', token: 'x' });
		post(frame.contentWindow, { type: 'scrapscache-turnstile', token: 42 });
		post(frame.contentWindow, 'scrapscache-turnstile');
		await tick();
		expect(token()).toBe('');

		post(frame.contentWindow, { type: 'scrapscache-turnstile', token: 'x'.repeat(2049) });
		await tick();
		expect(token()).toBe('');
	});

	it('clears the token when the challenge lapses', async () => {
		const { frame, token } = mount();
		post(frame.contentWindow, { type: 'scrapscache-turnstile', token: 'real' });
		await tick();

		post(frame.contentWindow, { type: 'scrapscache-turnstile', token: '' });
		await tick();

		expect(token()).toBe('');
	});

	it('refuses to frame the challenge from this same origin', () => {
		render(TurnstileWidget, { props: { origin: location.origin, action: 'register' } });

		expect(screen.queryByTitle('Human verification')).toBeNull();
		expect(screen.getByRole('alert').textContent).toMatch(/not configured correctly/);
	});

	it('keeps the frame from reaching this origin', () => {
		const { frame } = mount();
		// allow-same-origin here is the challenge origin's own, which is not ours.
		expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-popups');
		expect(new URL(frame.src).origin).not.toBe(location.origin);
		expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
	});
});
