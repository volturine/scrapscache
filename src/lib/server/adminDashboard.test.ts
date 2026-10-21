// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let root: string;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), 'dashboard-'));
	mkdirSync(join(root, 'build/admin/assets'), { recursive: true });
	writeFileSync(join(root, 'build/admin/index.html'), '<html>dashboard</html>');
	writeFileSync(join(root, 'build/admin/assets/index-abc.js'), 'console.log(1)');
	writeFileSync(
		join(root, 'build/admin/_headers'),
		"# comment\n/*\n  Content-Security-Policy: default-src 'self'\n  X-Frame-Options: DENY\n"
	);
	writeFileSync(join(root, 'build/secret.txt'), 'not for you');
	vi.spyOn(process, 'cwd').mockReturnValue(root);
});

afterAll(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

const serve = async (path: string) => (await import('./adminDashboard')).adminDashboard(path);

describe('the dashboard on a Node server', () => {
	it('sends the page with the build’s own headers, never cached', async () => {
		const response = (await serve('/admin/'))!;

		expect(await response.text()).toBe('<html>dashboard</html>');
		expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
		expect(response.headers.get('content-security-policy')).toBe("default-src 'self'");
		expect(response.headers.get('x-frame-options')).toBe('DENY');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('caches hashed assets for good', async () => {
		const response = (await serve('/admin/assets/index-abc.js'))!;
		expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
		expect(response.headers.get('cache-control')).toContain('immutable');
	});

	it('moves /admin to /admin/, so the page’s relative asset paths resolve', async () => {
		const response = (await serve('/admin'))!;
		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe('/admin/');
	});

	it('reads only files the build contains', async () => {
		for (const path of [
			'/admin/../secret.txt',
			'/admin/%2e%2e/secret.txt',
			'/admin/missing.js',
			'/admin/_headers',
			'/administrator',
			'/'
		])
			expect(await serve(path), path).toBeNull();
	});

	it('stays off, and says so, when the build carries no security policy', async () => {
		vi.resetModules();
		writeFileSync(join(root, 'build/admin/_headers'), '/*\n  X-Frame-Options: DENY\n');
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		expect(await serve('/admin/')).toBeNull();
		expect(error.mock.calls[0]?.[0]).toContain('admin_dashboard_unprotected');
	});
});
