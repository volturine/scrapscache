import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * workerd treats every named export of a Worker's entry module as an entrypoint,
 * so anything but a handler or a Durable Object class stops the Worker from
 * starting. Deploys accept it; the failure appears only at runtime.
 */
describe('Worker entry modules', () => {
	it.each(['../../../../cf/reminders', '../../../../cf/cron'])(
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
});
