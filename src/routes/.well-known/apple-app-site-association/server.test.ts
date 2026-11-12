import { describe, expect, it } from 'vitest';
import { privateEnv } from '../../../tests/env';
import { GET } from './+server';

type Association = {
	applinks: { details: Array<{ appIDs: string[]; components: Array<Record<string, string>> }> };
};

const read = () => GET({} as Parameters<typeof GET>[0]) as Response;

describe('the file that tells iOS which links open in the iPhone app', () => {
	it('is not there on a server that names no app', async () => {
		expect(read().status).toBe(404);
		privateEnv.SCRAPSCACHE_IOS_APP_IDS = 'not an app id, ,TEAM123456';
		expect(read().status).toBe(404);
	});

	it('names the apps, as JSON', async () => {
		privateEnv.SCRAPSCACHE_IOS_APP_IDS = 'TEAM123456.com.example.notes, TEAM123456.com.example.dev';
		const response = read();
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/json');
		const { applinks } = (await response.json()) as Association;
		expect(applinks.details).toHaveLength(1);
		expect(applinks.details[0].appIDs).toEqual([
			'TEAM123456.com.example.notes',
			'TEAM123456.com.example.dev'
		]);
	});

	it('opens a note link or a pairing link in the app from any view, never an address without one', async () => {
		privateEnv.SCRAPSCACHE_IOS_APP_IDS = 'TEAM123456.com.example.notes';
		const { applinks } = (await read().json()) as Association;
		// No path is named, which matches every path: a pairing link made on
		// /archive opens the app as one made on the home view does. Every
		// component needs its fragment, so no plain address matches.
		expect(applinks.details[0].components.map(({ comment: _comment, ...match }) => match)).toEqual([
			{ '#': '*note=*' },
			{ '#': '*pair=*' }
		]);
	});
});
