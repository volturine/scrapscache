import { afterEach, describe, expect, it } from 'vitest';
import { modalLayer } from './modalLayer';

function page() {
	document.body.innerHTML = `
		<div id="app">
			<nav id="nav"><button id="opener">Open</button></nav>
			<main id="feed"></main>
			<div data-app-float>
				<div id="bottom-nav"></div>
				<div id="reminder" data-over-modals></div>
				<div id="dialog" tabindex="-1"><button id="inside">Inside</button></div>
			</div>
		</div>
		<div data-app-overlay><div id="undo" role="status"></div><div id="tooltip"></div></div>
	`;
	const byId = (id: string) => document.getElementById(id)!;
	return byId;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('modalLayer', () => {
	it('makes everything outside the dialog inert, keeping portal hosts and live regions live', () => {
		const byId = page();
		const release = modalLayer(byId('dialog'));

		for (const id of ['nav', 'feed', 'bottom-nav', 'tooltip']) {
			expect(byId(id).hasAttribute('inert'), id).toBe(true);
		}
		expect(byId('dialog').hasAttribute('inert')).toBe(false);
		expect(byId('undo').hasAttribute('inert')).toBe(false);
		expect(byId('reminder').hasAttribute('inert')).toBe(false);
		expect(document.querySelector('[data-app-float]')!.hasAttribute('inert')).toBe(false);
		expect(document.querySelector('[data-app-overlay]')!.hasAttribute('inert')).toBe(false);

		release();
		expect(document.querySelectorAll('[inert]')).toHaveLength(0);
	});

	it('moves focus into the dialog and returns it to the opener', () => {
		const byId = page();
		byId('opener').focus();

		const release = modalLayer(byId('dialog'));
		expect(document.activeElement).toBe(byId('dialog'));

		byId('inside').focus();
		release();
		expect(document.activeElement).toBe(byId('opener'));
	});

	it('leaves focus that moved elsewhere on purpose', () => {
		const byId = page();
		byId('opener').focus();
		const release = modalLayer(byId('dialog'));

		const elsewhere = document.createElement('button');
		document.querySelector('[data-app-overlay]')!.append(elsewhere);
		elsewhere.focus();
		release();

		expect(document.activeElement).toBe(elsewhere);
	});

	it('stacks: a nested modal releases only what it made inert', () => {
		const byId = page();
		const releaseEditor = modalLayer(byId('dialog'));
		const photo = document.createElement('div');
		photo.tabIndex = -1;
		document.querySelector('[data-app-overlay]')!.append(photo);

		const releasePhoto = modalLayer(photo);
		expect(byId('dialog').hasAttribute('inert')).toBe(true);
		expect(photo.hasAttribute('inert')).toBe(false);

		releasePhoto();
		expect(byId('dialog').hasAttribute('inert')).toBe(false);
		expect(byId('nav').hasAttribute('inert')).toBe(true);

		releaseEditor();
		expect(document.querySelectorAll('[inert]')).toHaveLength(0);
	});
});
