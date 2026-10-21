import { describe, expect, it } from 'vitest';
import {
	defaultReminderLanguages,
	loadPhraseReaders,
	readReminderPhrase,
	type ReminderLanguage
} from './reminderPhrase.js';

// Wednesday 21 October 2026, 11:15 local time. The picker's wheels show 12:00.
const NOW = new Date(2026, 9, 21, 11, 15);
const WHEELS = { hour: 12, minute: 0 };

async function reader(...languages: ReminderLanguage[]) {
	const readers = await loadPhraseReaders(languages);
	return (text: string) => {
		const phrase = readReminderPhrase(text, readers, NOW, WHEELS);
		return phrase && { text: phrase.text, at: new Date(phrase.at) };
	};
}

function at(month: number, day: number, hour: number, minute = 0, year = 2026) {
	return new Date(year, month - 1, day, hour, minute);
}

describe('English', async () => {
	const read = await reader('en');

	it.each([
		['tomorrow 9am', at(10, 22, 9)],
		['fri 14:30', at(10, 23, 14, 30)],
		['in 2 hours', at(10, 21, 13, 15)],
		['in 30 min', at(10, 21, 11, 45)],
		['tomorrow morning', at(10, 22, 8)],
		['friday evening', at(10, 23, 18)],
		['tonight', at(10, 21, 18)],
		['noon', at(10, 21, 12)]
	])('reads "%s"', (text, expected) => {
		expect(read(text)?.at).toEqual(expected);
	});

	it('keeps the picked time when only a day is typed', () => {
		expect(read('friday')?.at).toEqual(at(10, 23, 12));
		expect(read('in 2 days')?.at).toEqual(at(10, 23, 12));
	});

	it('finds the time inside a sentence and says which part it read', () => {
		expect(read('call mum tomorrow at 3pm please')).toEqual({
			text: 'tomorrow at 3pm',
			at: at(10, 22, 15)
		});
	});

	it('reads nothing from words without a time', () => {
		expect(read('when I get home')).toBeNull();
		expect(read('   ')).toBeNull();
	});
});

describe('Slovak', async () => {
	const read = await reader('sk');

	it.each([
		['zajtra o 9', at(10, 22, 9)],
		['zajtra o 9:30', at(10, 22, 9, 30)],
		['v piatok večer', at(10, 23, 18)],
		['vo štvrtok ráno', at(10, 22, 8)],
		['pozajtra na obed', at(10, 23, 12)],
		['dnes poobede', at(10, 21, 15)],
		['o 14:30', at(10, 21, 14, 30)],
		['o 8 večer', at(10, 21, 20)],
		['za 2 hodiny', at(10, 21, 13, 15)],
		['za hodinu', at(10, 21, 12, 15)],
		['za pol hodiny', at(10, 21, 11, 45)],
		['za 10 minút', at(10, 21, 11, 25)],
		['za 2 dni o 9', at(10, 23, 9)],
		['23. 10. o 14:30', at(10, 23, 14, 30)],
		['23.10.2027 o 7', at(10, 23, 7, 0, 2027)],
		['24. októbra o 9', at(10, 24, 9)],
		['ZAJTRA VECER', at(10, 22, 18)]
	])('reads "%s"', (text, expected) => {
		expect(read(text)?.at).toEqual(expected);
	});

	it('moves a time already gone today to tomorrow', () => {
		expect(read('o 9')?.at).toEqual(at(10, 22, 9));
		expect(read('ráno')?.at).toEqual(at(10, 22, 8));
	});

	it('keeps the picked time when only a day is typed', () => {
		expect(read('v piatok')?.at).toEqual(at(10, 23, 12));
		expect(read('budúci týždeň')?.at).toEqual(at(10, 28, 12));
		expect(read('23. októbra')?.at).toEqual(at(10, 23, 12));
	});

	it('takes the same weekday as a week on, and "budúci" as next week', () => {
		expect(read('v stredu')?.at).toEqual(at(10, 28, 12));
		expect(read('budúci piatok')?.at).toEqual(at(10, 30, 12));
		expect(read('budúci pondelok')?.at).toEqual(at(10, 26, 12));
	});

	it('puts a day and month already gone this year into next year', () => {
		expect(read('1. 2.')?.at).toEqual(at(2, 1, 12, 0, 2027));
	});

	it('finds the time inside a sentence and says which part it read', () => {
		expect(read('pripomeň mi zajtra o 9 zavolať mame')).toEqual({
			text: 'zajtra o 9',
			at: at(10, 22, 9)
		});
	});

	it('reads nothing from words without a time, a bare number or an impossible date', () => {
		expect(read('keď prídem domov')).toBeNull();
		expect(read('9')).toBeNull();
		expect(read('31. 2.')).toBeNull();
		// A number word it does not know is no number: never "one minute" by default.
		expect(read('za dvadsať minút')).toBeNull();
		expect(read('za tridsať hodín')).toBeNull();
	});
});

describe('Czech', async () => {
	const read = await reader('cs');

	it.each([
		['zítra v 9', at(10, 22, 9)],
		['v pátek odpoledne', at(10, 23, 15)],
		['ve čtvrtek v poledne', at(10, 22, 12)],
		['pozítří ráno', at(10, 23, 8)],
		['za půl hodiny', at(10, 21, 11, 45)],
		['ve středu', at(10, 28, 12)],
		['příští týden', at(10, 28, 12)],
		['24. října ve 13:15', at(10, 24, 13, 15)]
	])('reads "%s"', (text, expected) => {
		expect(read(text)?.at).toEqual(expected);
	});
});

describe('several languages', async () => {
	const read = await reader('sk', 'en');

	it('keeps the reading that understood the most', () => {
		expect(read('tomorrow 9am')?.at).toEqual(at(10, 22, 9));
		expect(read('zajtra o 9')?.at).toEqual(at(10, 22, 9));
	});

	it.each([
		['de', 'morgen um 9'],
		['fr', 'demain à 9h'],
		['es', 'mañana a las 9'],
		['ja', '明日9時']
	] as const)('loads %s on demand', async (language, text) => {
		const other = await reader(language);
		expect(other(text)?.at).toEqual(at(10, 22, 9));
	});
});

describe('time-of-day words in every language', () => {
	it.each([
		['en', 'tomorrow evening', at(10, 22, 18)],
		['de', 'morgen abend', at(10, 22, 18)],
		['fr', 'demain soir', at(10, 22, 18)],
		['it', 'domani sera', at(10, 22, 18)],
		['pt', 'amanhã à noite', at(10, 22, 18)],
		['fi', 'huomenna illalla', at(10, 22, 18)],
		['id', 'besok malam', at(10, 22, 18)],
		['ru', 'завтра вечером', at(10, 22, 18)],
		['uk', 'завтра ввечері', at(10, 22, 18)],
		['ar', 'غدا مساء', at(10, 22, 18)],
		['es', 'mañana por la tarde', at(10, 22, 15)],
		['es', 'mañana por la mañana', at(10, 22, 8)],
		['es', 'mañana', at(10, 22, 12)],
		['nl', 'morgenavond', at(10, 22, 18)],
		['nl', "morgen 's ochtends", at(10, 22, 8)],
		['ja', '明日の夜', at(10, 22, 18)],
		['ja', '明日の朝', at(10, 22, 8)],
		['ja', '今夜', at(10, 21, 18)],
		['zh', '明天晚上', at(10, 22, 18)],
		['zh', '明天下午', at(10, 22, 15)],
		['zh', '今晚', at(10, 21, 18)]
	] as const)('%s reads "%s"', async (language, text, expected) => {
		const read = await reader(language);
		const phrase = read(text);
		expect(phrase?.at).toEqual(expected);
		// What was used is what the line under the field shows.
		expect(phrase?.text).toBe(text);
	});

	it('keeps a clock time over the part of the day', async () => {
		expect((await reader('zh'))('明天上午9点')?.at).toEqual(at(10, 22, 9));
		expect((await reader('es'))('mañana a las 9 de la noche')?.at).toEqual(at(10, 22, 21));
	});
});

describe('defaultReminderLanguages', () => {
	it("starts from the browser's languages and adds English", () => {
		expect(defaultReminderLanguages(['sk-SK', 'cs', 'en-US'])).toEqual(['sk', 'cs', 'en']);
		expect(defaultReminderLanguages(['fr-FR'])).toEqual(['fr', 'en']);
		expect(defaultReminderLanguages(['hu-HU'])).toEqual(['en']);
		expect(defaultReminderLanguages([])).toEqual(['en']);
	});
});
