import { describe, expect, it } from 'vitest';
import { randomWorkspaceName, WORKSPACE_NAME_COMBINATIONS } from './workspaceNames';

/** Every pair the generator can produce, drawn by exhausting it. */
function allNames(): Set<string> {
	const seen = new Set<string>();
	for (let i = 0; i < WORKSPACE_NAME_COMBINATIONS * 40; i += 1) {
		seen.add(randomWorkspaceName());
		if (seen.size === WORKSPACE_NAME_COMBINATIONS) break;
	}
	return seen;
}

describe('randomWorkspaceName', () => {
	it('produces two capitalised words', () => {
		for (let i = 0; i < 200; i += 1) {
			expect(randomWorkspaceName()).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
		}
	});

	it('never repeats a word within one name', () => {
		for (let i = 0; i < 200; i += 1) {
			const [left, right] = randomWorkspaceName().split(' ');
			expect(left).not.toBe(right);
		}
	});

	it('never returns a name already in use', () => {
		// Realistic load: a device with a handful of workspaces.
		const taken: string[] = [];
		for (let i = 0; i < 25; i += 1) {
			const generated = randomWorkspaceName(taken);
			expect(taken).not.toContain(generated);
			taken.push(generated);
		}
		expect(new Set(taken).size).toBe(taken.length);
	});

	it('numbers a name rather than repeating one when every pair is taken', () => {
		const taken = [...allNames()];
		const generated = randomWorkspaceName(taken);

		expect(taken).not.toContain(generated);
		expect(generated).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ 2$/);
	});

	it('keeps counting up when the numbered fallbacks are taken too', () => {
		const names = [...allNames()];
		const taken = [...names, ...names.map((name) => `${name} 2`)];
		const generated = randomWorkspaceName(taken);

		expect(taken).not.toContain(generated);
		expect(generated).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ 3$/);
	});

	it('offers enough pairs that collisions stay unlikely in practice', () => {
		expect(WORKSPACE_NAME_COMBINATIONS).toBeGreaterThanOrEqual(1000);
		expect(allNames().size).toBe(WORKSPACE_NAME_COMBINATIONS);
	});
});
