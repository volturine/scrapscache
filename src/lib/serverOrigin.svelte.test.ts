import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ on: false }));
vi.mock('#lib/native.js', () => ({ isNativeApp: () => native.on }));

import {
	appLinkBase,
	appLinkOrigin,
	DEFAULT_SERVER_ORIGIN,
	normalizeServerOrigin,
	serverSetting,
	serverUrl
} from './serverOrigin.svelte.js';

describe('normalizeServerOrigin', () => {
	it('takes an https origin, with or without the scheme or a trailing slash', () => {
		expect(normalizeServerOrigin('notes.example.org')).toBe('https://notes.example.org');
		expect(normalizeServerOrigin(' https://notes.example.org/ ')).toBe('https://notes.example.org');
		expect(normalizeServerOrigin('HTTPS://Notes.Example.org:8443')).toBe(
			'https://notes.example.org:8443'
		);
	});

	it('refuses anything that is not a bare https origin', () => {
		for (const input of [
			'',
			'   ',
			'not a url',
			'http://notes.example.org',
			'https://notes.example.org/notes',
			'https://notes.example.org/?x=1',
			'https://notes.example.org/#y',
			'https://user:secret@notes.example.org'
		]) {
			expect(normalizeServerOrigin(input), input).toBeNull();
		}
	});
});

describe('the server setting', () => {
	beforeEach(() => {
		localStorage.clear();
		serverSetting.set(DEFAULT_SERVER_ORIGIN);
		native.on = false;
	});

	it('leaves paths relative on the web, whatever it says', () => {
		serverSetting.set('https://self.example');
		expect(serverUrl('/api/sync/register')).toBe('/api/sync/register');
		expect(appLinkOrigin()).toBe(location.origin);
		expect(appLinkBase()).toBe(location.href);
	});

	it('prefixes the server inside the app, and points links at the web app there', () => {
		native.on = true;
		expect(serverUrl('/api/sync/register')).toBe('https://scrapscache.com/api/sync/register');
		expect(serverSetting.set('https://self.example/')).toBe(true);
		expect(serverUrl('/api/sync/events')).toBe('https://self.example/api/sync/events');
		expect(appLinkOrigin()).toBe('https://self.example');
		expect(appLinkBase()).toBe('https://self.example/');
	});

	it('keeps a changed server for next time, and forgets the default', () => {
		serverSetting.set('https://self.example');
		expect(localStorage.getItem('scrapscache-server')).toBe('https://self.example');
		expect(serverSetting.isDefault).toBe(false);
		serverSetting.set(DEFAULT_SERVER_ORIGIN);
		expect(localStorage.getItem('scrapscache-server')).toBeNull();
		expect(serverSetting.isDefault).toBe(true);
	});

	it('keeps what it had when given something unusable', () => {
		serverSetting.set('https://self.example');
		expect(serverSetting.set('ftp://elsewhere')).toBe(false);
		expect(serverSetting.origin).toBe('https://self.example');
	});
});
