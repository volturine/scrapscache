import { describe, expect, it } from 'vitest';
import { uid } from './uid.js';

describe('uid', () => {
	it('returns a UUID in the default test environment', () => {
		expect(uid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});

	it('is unique across many calls', () => {
		const ids = new Set(Array.from({ length: 200 }, () => uid()));
		expect(ids.size).toBe(200);
	});
});
