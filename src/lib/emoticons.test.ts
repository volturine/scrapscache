import { describe, expect, it } from 'vitest';
import { matchTrailingEmoticon } from './emoticons';

describe('matchTrailingEmoticon', () => {
	it('matches an emoticon at the start of the text', () => {
		expect(matchTrailingEmoticon(':)')).toEqual({ start: 0, emoji: '🙂' });
		expect(matchTrailingEmoticon('<3')).toEqual({ start: 0, emoji: '❤️' });
	});

	it('matches an emoticon after whitespace or an opening bracket', () => {
		expect(matchTrailingEmoticon('hi :)')).toEqual({ start: 3, emoji: '🙂' });
		expect(matchTrailingEmoticon('oh (:)')).toEqual({ start: 4, emoji: '🙂' });
		expect(matchTrailingEmoticon('say ;)')).toEqual({ start: 4, emoji: '😉' });
	});

	it('matches longer emoticon variants', () => {
		expect(matchTrailingEmoticon(':-)')).toEqual({ start: 0, emoji: '🙂' });
		expect(matchTrailingEmoticon(":'(")).toEqual({ start: 0, emoji: '😭' });
	});

	it('ignores an emoticon glued to a word', () => {
		expect(matchTrailingEmoticon('a:)')).toBeNull();
		expect(matchTrailingEmoticon('http://x:)')).toBeNull();
	});

	it('returns null when the text ends with no emoticon', () => {
		expect(matchTrailingEmoticon('hello')).toBeNull();
		expect(matchTrailingEmoticon('')).toBeNull();
	});
});
