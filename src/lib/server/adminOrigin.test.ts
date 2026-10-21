import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateEnv } from '../../tests/env';
import { adminRouting, isAdminRoute } from './adminOrigin';

const APP = 'https://notes.example';
const ADMIN = 'https://admin.notes.example';

const at = (origin: string, path: string) => adminRouting(new URL(path, origin));

describe('admin origin', () => {
	afterEach(() => vi.restoreAllMocks());

	it('names the dashboard, its API and the scrape as admin routes', () => {
		for (const path of ['/admin', '/admin/', '/api/admin/status', '/metrics'])
			expect(isAdminRoute(path), path).toBe(true);
		for (const path of [
			'/',
			'/administrator',
			'/api/administer',
			'/api/sync/v2/delta',
			'/metricsx'
		])
			expect(isAdminRoute(path), path).toBe(false);
	});

	it('sees the admin routes through percent-encoding, as the router does', () => {
		for (const path of ['/%61dmin', '/api/%61dmin/status', '/%6detrics', '/%E0%A4%A'])
			expect(isAdminRoute(path), path).toBe(true);
		expect(isAdminRoute('/notes/100%25')).toBe(false);
	});

	it('serves everything on one origin when no admin origin is set', () => {
		expect(at(APP, '/admin')).toBe('serve');
		expect(at(APP, '/api/admin/status')).toBe('serve');
		expect(at(APP, '/')).toBe('serve');
	});

	it('serves the admin routes only on the admin origin, and nothing else there', () => {
		privateEnv.SCRAPSCACHE_ADMIN_ORIGIN = `${ADMIN}/`;

		expect(at(ADMIN, '/admin')).toBe('serve');
		expect(at(ADMIN, '/api/admin/accounts')).toBe('serve');
		expect(at(ADMIN, '/metrics')).toBe('serve');
		expect(at(ADMIN, '/api/sync/v2/delta')).toBe('not-found');
		expect(at(ADMIN, '/privacy')).toBe('not-found');
		expect(at(ADMIN, '/')).toBe('dashboard');

		expect(at(APP, '/admin')).toBe('not-found');
		expect(at(APP, '/api/admin/settings')).toBe('not-found');
		expect(at(APP, '/metrics')).toBe('not-found');
		expect(at(APP, '/api/%61dmin/status')).toBe('not-found');
		expect(at(APP, '/')).toBe('serve');
		expect(at(APP, '/api/sync/v2/delta')).toBe('serve');
	});

	it('matches the admin origin regardless of case', () => {
		privateEnv.SCRAPSCACHE_ADMIN_ORIGIN = 'https://Admin.Notes.example';
		expect(at(ADMIN, '/admin')).toBe('serve');
	});

	it('turns the admin routes off everywhere, and says so, when the origin is malformed', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		for (const value of ['admin.notes.example', `${ADMIN}/admin`, 'ftp://admin.notes.example']) {
			privateEnv.SCRAPSCACHE_ADMIN_ORIGIN = value;
			expect(at(APP, '/admin'), value).toBe('not-found');
			expect(at(ADMIN, '/api/admin/status'), value).toBe('not-found');
			expect(at(APP, '/'), value).toBe('serve');
		}
		expect(error.mock.calls.some(([line]) => String(line).includes('admin_origin_invalid'))).toBe(
			true
		);
	});
});
