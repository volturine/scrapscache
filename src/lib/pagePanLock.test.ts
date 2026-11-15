import { afterEach, describe, expect, it } from 'vitest';
import { pagePanLock } from './pagePanLock';

function touch(type: 'touchstart' | 'touchmove', target: Element, y: number, x = 100): Event {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: y }] });
	target.dispatchEvent(event);
	return event;
}

/** A drag from `from` to `to`; says whether the page was kept from following it. */
function dragStopped(target: Element, from: number, to: number, x = 100): boolean {
	touch('touchstart', target, from);
	return touch('touchmove', target, to, x).defaultPrevented;
}

function page(scroll: { height: number; top: number }) {
	document.body.innerHTML = `
		<div id="sheet"><input id="field" /><div id="list"><div id="row"></div></div></div>
		<div id="column" data-column-stack><button id="place"></button></div>
	`;
	const list = document.getElementById('list')!;
	Object.defineProperty(list, 'clientHeight', { value: 300 });
	Object.defineProperty(list, 'scrollHeight', { value: scroll.height });
	Object.defineProperty(list, 'scrollTop', { value: scroll.top });
	return (id: string) => document.getElementById(id)!;
}

let release: (() => void) | null = null;
afterEach(() => {
	release?.();
	release = null;
	document.body.innerHTML = '';
});

describe('pagePanLock', () => {
	it('stops a drag that starts outside the list', () => {
		const byId = page({ height: 900, top: 100 });
		release = pagePanLock(byId('list'));
		expect(dragStopped(byId('field'), 200, 120)).toBe(true);
		expect(dragStopped(document.body, 200, 120)).toBe(true);
	});

	it('stops a drag on a list too short to scroll, either way', () => {
		const byId = page({ height: 300, top: 0 });
		release = pagePanLock(byId('list'));
		expect(dragStopped(byId('row'), 200, 120)).toBe(true);
		expect(dragStopped(byId('row'), 120, 200)).toBe(true);
	});

	it('lets the list scroll while it has room, and stops at its ends', () => {
		let byId = page({ height: 900, top: 100 });
		release = pagePanLock(byId('list'));
		expect(dragStopped(byId('row'), 200, 120)).toBe(false);
		expect(dragStopped(byId('row'), 120, 200)).toBe(false);
		release();

		byId = page({ height: 900, top: 0 });
		release = pagePanLock(byId('list'));
		expect(dragStopped(byId('row'), 120, 200)).toBe(true);
		expect(dragStopped(byId('row'), 200, 120)).toBe(false);
		release();

		byId = page({ height: 900, top: 600 });
		release = pagePanLock(byId('list'));
		expect(dragStopped(byId('row'), 200, 120)).toBe(true);
		expect(dragStopped(byId('row'), 120, 200)).toBe(false);
	});

	it('stops a sideways drag on the list', () => {
		const byId = page({ height: 900, top: 100 });
		release = pagePanLock(byId('list'));
		expect(dragStopped(byId('row'), 200, 190, 220)).toBe(true);
	});

	it('leaves the column its own scrolling, and a scroll under way alone', () => {
		const byId = page({ height: 300, top: 0 });
		release = pagePanLock(byId('list'));
		expect(dragStopped(byId('place'), 200, 120)).toBe(false);

		touch('touchstart', byId('row'), 200);
		const moving = new Event('touchmove', { bubbles: true, cancelable: false });
		Object.defineProperty(moving, 'touches', { value: [{ clientX: 100, clientY: 120 }] });
		byId('row').dispatchEvent(moving);
		expect(moving.defaultPrevented).toBe(false);
	});

	it('lets go of the page when it is released', () => {
		const byId = page({ height: 300, top: 0 });
		pagePanLock(byId('list'))();
		expect(dragStopped(byId('row'), 200, 120)).toBe(false);
	});
});
