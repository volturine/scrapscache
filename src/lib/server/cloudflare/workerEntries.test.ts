import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

/**
 * workerd treats every named export of a Worker's entry module as an entrypoint,
 * so anything but a handler or a Durable Object class stops the Worker from
 * starting. Deploys accept it; the failure appears only at runtime.
 */
describe('Worker entry modules', () => {
	it.each(['../../../../cf/reminders', '../../../../cf/cron', '../../../../cf/admin'])(
		'%s exports only classes and its default handler',
		async (path) => {
			const entry = (await import(path)) as Record<string, unknown>;
			for (const [name, value] of Object.entries(entry)) {
				if (name === 'default') expect(typeof value).toBe('object');
				else expect([name, typeof value]).toEqual([name, 'function']);
			}
		}
	);

	it('re-exports only the coordinator class from the app entry', () => {
		// The app entry imports the generated build, so its exports are read from source.
		const source = readFileSync('cf/app.ts', 'utf8');
		const named = [...source.matchAll(/^export\s+(?!default\b)(.*)$/gm)].map((match) => match[1]);
		expect(named).toEqual(["{ AccountCoordinator } from './accountCoordinator';"]);
	});

	it('sends the maintenance tick as JSON, which SvelteKit does not treat as a form', async () => {
		const { default: cron } = (await import('../../../../cf/cron')) as {
			default: { scheduled(controller: unknown, env: unknown, context: unknown): void };
		};
		const fetch = vi.fn(async (_request: Request) => new Response(null, { status: 200 }));
		const pending: Promise<unknown>[] = [];
		cron.scheduled(
			{},
			{ APP: { fetch }, SCRAPSCACHE_TICK_SECRET: 'secret' },
			{ waitUntil: (promise: Promise<unknown>) => pending.push(promise) }
		);
		await Promise.all(pending);

		const request = fetch.mock.calls[0][0];
		expect(request.method).toBe('POST');
		expect(request.headers.get('content-type')).toBe('application/json');
		expect(request.headers.get('authorization')).toBe('Bearer secret');
	});

	it('hands the app the admin API as it arrived, and nothing else', async () => {
		const { default: admin } = (await import('../../../../cf/admin')) as {
			default: { fetch(request: Request, env: unknown): Promise<Response> | Response };
		};
		const fetch = vi.fn(async (_request: Request) => new Response('from app'));
		const env = { APP: { fetch } };

		const request = new Request('https://admin.example.test/api/admin/status', {
			headers: { 'cf-access-jwt-assertion': 'signed' }
		});
		expect(await (await admin.fetch(request, env)).text()).toBe('from app');
		expect(fetch.mock.calls[0][0]).toBe(request);
		expect(
			await (await admin.fetch(new Request('https://admin.example.test/metrics'), env)).text()
		).toBe('from app');

		for (const path of ['/api/sync/v2/delta', '/api/administer', '/', '/privacy'])
			expect(
				(await admin.fetch(new Request(`https://admin.example.test${path}`), env)).status
			).toBe(404);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
