// Typed reminder times: "tomorrow 9am", "v piatok večer", "in 2 hours".
// chrono-node reads English and its other languages; Slovak and Czech have our own
// grammar. Each language loads on first use, so only the ones picked in Settings
// reach the device's memory.
import type { Chrono, ParsedResult } from 'chrono-node';

/** What one language made of the text. */
export interface PhraseReading {
	/** The part of the input that was understood. */
	text: string;
	date: Date;
	/** False when only a day was given; the picker's time then stays. */
	timeGiven: boolean;
}

export type PhraseReader = (text: string, now: Date) => PhraseReading | null;

/** The hour a time-of-day word means, in every language. */
export const VAGUE_HOURS = { morning: 8, noon: 12, afternoon: 15, evening: 18 } as const;

export const REMINDER_LANGUAGES = [
	{ code: 'en', name: 'English', example: 'tomorrow 9am' },
	{ code: 'sk', name: 'Slovenčina', example: 'zajtra o 9' },
	{ code: 'cs', name: 'Čeština', example: 'zítra v 9' },
	{ code: 'de', name: 'Deutsch', example: 'morgen um 9' },
	{ code: 'es', name: 'Español', example: 'mañana a las 9' },
	{ code: 'fr', name: 'Français', example: 'demain à 9h' },
	{ code: 'it', name: 'Italiano', example: 'domani alle 9' },
	{ code: 'nl', name: 'Nederlands', example: 'morgen om 9 uur' },
	{ code: 'pt', name: 'Português', example: 'amanhã às 9' },
	{ code: 'sv', name: 'Svenska', example: 'imorgon' },
	{ code: 'fi', name: 'Suomi', example: 'huomenna klo 9' },
	{ code: 'id', name: 'Bahasa Indonesia', example: 'besok jam 9' },
	{ code: 'vi', name: 'Tiếng Việt', example: 'ngày mai 9 giờ' },
	{ code: 'ru', name: 'Русский', example: 'завтра в 9' },
	{ code: 'uk', name: 'Українська', example: 'завтра о 9' },
	{ code: 'ar', name: 'العربية', example: 'غدا الساعة 9' },
	{ code: 'ja', name: '日本語', example: '明日9時' },
	{ code: 'zh', name: '中文', example: '明天9点' }
] as const;

export type ReminderLanguage = (typeof REMINDER_LANGUAGES)[number]['code'];

export function isReminderLanguage(value: unknown): value is ReminderLanguage {
	return REMINDER_LANGUAGES.some((language) => language.code === value);
}

/** The browser's languages this can read, English last if it is not among them. */
export function defaultReminderLanguages(preferred: readonly string[]): ReminderLanguage[] {
	const codes = preferred.map((tag) => tag.toLowerCase().split('-')[0]).filter(isReminderLanguage);
	return [...new Set<ReminderLanguage>([...codes, 'en'])];
}

/** chrono's tags for a time of day it only implied, and the hour we use for each. */
const CHRONO_VAGUE: Record<string, number> = {
	'casualReference/morning': VAGUE_HOURS.morning,
	'casualReference/afternoon': VAGUE_HOURS.afternoon,
	'casualReference/evening': VAGUE_HOURS.evening,
	'casualReference/tonight': VAGUE_HOURS.evening
};

function longest(results: ParsedResult[]): ParsedResult | null {
	return results.reduce<ParsedResult | null>(
		(best, result) => (!best || result.text.length > best.text.length ? result : best),
		null
	);
}

export function chronoReader(chrono: Chrono): PhraseReader {
	return (text, now) => {
		const result = longest(chrono.parse(text, now, { forwardDate: true }));
		if (!result) return null;
		const date = result.start.date();
		if (result.start.isCertain('hour')) {
			if (!result.start.isCertain('minute')) date.setMinutes(0);
			date.setSeconds(0, 0);
			return { text: result.text, date, timeGiven: true };
		}
		for (const tag of result.tags()) {
			const hour = CHRONO_VAGUE[tag];
			if (hour === undefined) continue;
			date.setHours(hour, 0, 0, 0);
			return { text: result.text, date, timeGiven: true };
		}
		return { text: result.text, date, timeGiven: false };
	};
}

const LOADERS: Record<ReminderLanguage, () => Promise<PhraseReader>> = {
	en: () => import('chrono-node/en').then((m) => chronoReader(m.casual)),
	sk: () => import('./reminderPhraseSlavic.js').then((m) => m.slovak),
	cs: () => import('./reminderPhraseSlavic.js').then((m) => m.czech),
	de: () => import('chrono-node/de').then((m) => chronoReader(m.casual)),
	es: () => import('chrono-node/es').then((m) => chronoReader(m.casual)),
	fr: () => import('chrono-node/fr').then((m) => chronoReader(m.casual)),
	it: () => import('chrono-node/it').then((m) => chronoReader(m.casual)),
	nl: () => import('chrono-node/nl').then((m) => chronoReader(m.casual)),
	pt: () => import('chrono-node/pt').then((m) => chronoReader(m.casual)),
	sv: () => import('chrono-node/sv').then((m) => chronoReader(m.casual)),
	fi: () => import('chrono-node/fi').then((m) => chronoReader(m.casual)),
	id: () => import('chrono-node/id').then((m) => chronoReader(m.casual)),
	vi: () => import('chrono-node/vi').then((m) => chronoReader(m.casual)),
	ru: () => import('chrono-node/ru').then((m) => chronoReader(m.casual)),
	uk: () => import('chrono-node/uk').then((m) => chronoReader(m.casual)),
	ar: () => import('chrono-node/ar').then((m) => chronoReader(m.casual)),
	ja: () => import('chrono-node/ja').then((m) => chronoReader(m.casual)),
	zh: () => import('chrono-node/zh').then((m) => chronoReader(m.casual))
};

const loaded = new Map<ReminderLanguage, Promise<PhraseReader>>();

/** The readers for `languages`, in that order. A language that fails to load is left out. */
export async function loadPhraseReaders(
	languages: readonly ReminderLanguage[]
): Promise<PhraseReader[]> {
	const readers = await Promise.all(
		languages.map((code) => {
			let reader = loaded.get(code);
			if (!reader) {
				reader = LOADERS[code]();
				loaded.set(code, reader);
				// A failed chunk load (offline before it was cached) may work next time.
				reader.catch(() => loaded.delete(code));
			}
			return reader.catch(() => null);
		})
	);
	return readers.filter((reader): reader is PhraseReader => reader !== null);
}

export interface ReminderPhrase {
	/** The part of the input that was understood. */
	text: string;
	at: number;
}

/**
 * Read `text` with every reader and keep the reading that understood the most of it,
 * the earlier language winning a tie. A day without a time keeps `time`.
 */
export function readReminderPhrase(
	text: string,
	readers: readonly PhraseReader[],
	now: Date,
	time: { hour: number; minute: number }
): ReminderPhrase | null {
	if (!text.trim()) return null;
	let best: PhraseReading | null = null;
	for (const read of readers) {
		const reading = read(text, now);
		if (reading && (!best || reading.text.length > best.text.length)) best = reading;
	}
	if (!best) return null;
	const date = new Date(best.date);
	if (!best.timeGiven) date.setHours(time.hour, time.minute, 0, 0);
	return { text: best.text.trim(), at: date.getTime() };
}
