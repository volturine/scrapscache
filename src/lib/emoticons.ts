/** Text emoticons rewritten to an emoji when the user types a trailing space. */
const EMOTICON_EMOJI: Record<string, string> = {
	':)': '🙂',
	':-)': '🙂',
	':(': '😞',
	':-(': '😞',
	';)': '😉',
	';-)': '😉',
	':D': '😄',
	':d': '😄',
	':-D': '😄',
	':-d': '😄',
	':P': '😜',
	':p': '😜',
	':-P': '😜',
	':-p': '😜',
	':/': '😕',
	':-/': '😕',
	":'(": '😭',
	':|': '😐',
	':*': '😘',
	':o': '😮',
	':O': '😮',
	':-o': '😮',
	':-O': '😮',
	'D:': '😦',
	'd:': '😦',
	'<3': '❤️',
	'</3': '💔'
};

// Longest first so `:-)` wins over a suffix it would also match.
const TRAILING_EMOTICONS = Object.keys(EMOTICON_EMOJI).sort((a, b) => b.length - a.length);

/**
 * The emoticon `text` ends with, if any, when it starts at a word boundary.
 * Returns the offset where the match starts and the emoji that replaces it.
 */
export function matchTrailingEmoticon(text: string): { start: number; emoji: string } | null {
	for (const emoticon of TRAILING_EMOTICONS) {
		if (!text.endsWith(emoticon)) continue;
		const start = text.length - emoticon.length;
		const before = start > 0 ? text[start - 1] : '';
		if (before && !/[\s([{]/.test(before)) continue;
		return { start, emoji: EMOTICON_EMOJI[emoticon] };
	}
	return null;
}
