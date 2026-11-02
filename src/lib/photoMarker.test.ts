import { describe, expect, it } from 'vitest';
import {
	bodyIsOnlyPhotoMarkers,
	isPhotoMarkerLine,
	parsePhotoMarker,
	photoMarker
} from './photoMarker';

describe('photoMarker', () => {
	it('writes a marker line that parses back to the photo', () => {
		const line = photoMarker({ id: 'k3f9x2', name: 'beach.webp' });
		expect(line).toBe('![beach.webp](photo:k3f9x2)');
		expect(parsePhotoMarker(line)).toEqual({ name: 'beach.webp', id: 'k3f9x2' });
	});

	it('keeps syntax characters and line breaks out of the name', () => {
		expect(photoMarker({ id: 'a', name: 'odd]name\nhere' })).toBe('![odd name here](photo:a)');
		expect(photoMarker({ id: 'a' })).toBe('![photo](photo:a)');
	});

	it('only matches a whole line', () => {
		expect(parsePhotoMarker('see ![x](photo:a)')).toBeNull();
		expect(parsePhotoMarker('![x](photo:a) and more')).toBeNull();
		expect(parsePhotoMarker('![x](https://example.com/x.png)')).toBeNull();
		expect(isPhotoMarkerLine('![](photo:a)')).toBe(true);
	});

	it('treats a body of markers and blank lines as empty text', () => {
		expect(bodyIsOnlyPhotoMarkers('')).toBe(true);
		expect(bodyIsOnlyPhotoMarkers('![a](photo:1)\n\n![b](photo:2)')).toBe(true);
		expect(bodyIsOnlyPhotoMarkers('![a](photo:1)\nnotes')).toBe(false);
	});
});
