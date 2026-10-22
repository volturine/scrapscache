import { describe, expect, it } from 'vitest';
import { firstRepeatTime, localTimeZone } from '#lib/model/index.js';
import { loadPhraseReaders, readReminderPhrase, type ReminderLanguage } from './reminderPhrase.js';
import type { TypedRepeat } from './reminderRepeatWords.js';

// Wednesday 21 October 2026, 11:15 local time. The picker's wheels show 12:00.
const NOW = new Date(2026, 9, 21, 11, 15);
const WHEELS = { hour: 12, minute: 0 };

function at(month: number, day: number, hour: number, minute = 0) {
	return new Date(2026, month - 1, day, hour, minute);
}

async function reader(...languages: ReminderLanguage[]) {
	const readers = await loadPhraseReaders(languages);
	return (text: string) => {
		const phrase = readReminderPhrase(text, readers, NOW, WHEELS);
		if (!phrase) return null;
		// The first time is the one the picker saves: a time gone moves on to the next.
		const first = phrase.repeat
			? firstRepeatTime(phrase.at, { ...phrase.repeat, zone: localTimeZone() }, NOW.getTime())
			: phrase.at;
		return { text: phrase.text, repeat: phrase.repeat, first: new Date(first) };
	};
}

const daily: TypedRepeat = { unit: 'day', every: 1 };
const weekly = (...weekdays: number[]): TypedRepeat => ({ unit: 'week', every: 1, weekdays });
const workweek = weekly(1, 2, 3, 4, 5);

describe('English repeats', async () => {
	const read = await reader('en');

	it.each([
		['every day at 9', daily, at(10, 22, 9)],
		['daily at 7pm', daily, at(10, 21, 19)],
		['every monday at 9am', weekly(1), at(10, 26, 9)],
		['mondays and wednesdays at 9', weekly(1, 3), at(10, 26, 9)],
		['every tue, thu at 18:00', weekly(2, 4), at(10, 22, 18)],
		['every weekday at 8', workweek, at(10, 22, 8)],
		['every 2 weeks', { unit: 'week', every: 2 }, at(10, 21, 12)],
		['every other day', { unit: 'day', every: 2 }, at(10, 21, 12)],
		['fortnightly', { unit: 'week', every: 2 }, at(10, 21, 12)],
		['monthly', { unit: 'month', every: 1 }, at(10, 21, 12)],
		['every year on december 24', { unit: 'year', every: 1 }, at(12, 24, 12)],
		['every morning', daily, at(10, 22, 8)]
	] as const)('reads "%s"', (text, repeat, first) => {
		const phrase = read(text);
		expect(phrase?.repeat).toEqual(repeat);
		expect(phrase?.first).toEqual(first);
	});

	it('finds the repeat and the time inside a sentence', () => {
		expect(read('call mum every sunday at 6pm please')).toMatchObject({
			text: 'every sunday at 6pm',
			repeat: weekly(0),
			first: at(10, 25, 18)
		});
	});

	it('reads no repeat from a single time', () => {
		expect(read('tomorrow at 9')?.repeat).toBeUndefined();
		expect(read('everyone at 9')?.repeat).toBeUndefined();
	});
});

describe('Slovak and Czech repeats', async () => {
	const slovak = await reader('sk');
	const czech = await reader('cs');

	it.each([
		['každý deň o 9', daily, at(10, 22, 9)],
		['denne o 20', daily, at(10, 21, 20)],
		['každý pondelok o 8', weekly(1), at(10, 26, 8)],
		['každú stredu', weekly(3), at(10, 21, 12)],
		['v pondelky a v stredy o 9', weekly(1, 3), at(10, 26, 9)],
		['každý pracovný deň o 7:30', workweek, at(10, 22, 7, 30)],
		['každé 2 týždne', { unit: 'week', every: 2 }, at(10, 21, 12)],
		['každý druhý deň', { unit: 'day', every: 2 }, at(10, 21, 12)],
		['každý mesiac', { unit: 'month', every: 1 }, at(10, 21, 12)],
		['každé ráno', daily, at(10, 22, 8)],
		['KAZDY VECER', daily, at(10, 21, 18)]
	] as const)('Slovak reads "%s"', (text, repeat, first) => {
		const phrase = slovak(text);
		expect(phrase?.repeat).toEqual(repeat);
		expect(phrase?.first).toEqual(first);
	});

	it.each([
		['každý den v 9', daily, at(10, 22, 9)],
		['každé pondělí', weekly(1), at(10, 26, 12)],
		['každou středu v 18', weekly(3), at(10, 21, 18)],
		['ve všední dny v 8', workweek, at(10, 22, 8)],
		['každé 3 týdny', { unit: 'week', every: 3 }, at(10, 21, 12)],
		['týdně', { unit: 'week', every: 1 }, at(10, 21, 12)]
	] as const)('Czech reads "%s"', (text, repeat, first) => {
		const phrase = czech(text);
		expect(phrase?.repeat).toEqual(repeat);
		expect(phrase?.first).toEqual(first);
	});

	it('reads accents typed as separate marks, and gives back the whole of them', () => {
		const decomposed = 'pripomeň každý piatok o 17'.normalize('NFD');
		expect(slovak(decomposed)).toMatchObject({
			text: 'každý piatok o 17'.normalize('NFD'),
			repeat: weekly(5),
			first: at(10, 23, 17)
		});
	});

	it('says which part it read', () => {
		expect(slovak('pripomeň mi každý piatok o 17 zavolať mame')).toMatchObject({
			text: 'každý piatok o 17',
			repeat: weekly(5),
			first: at(10, 23, 17)
		});
	});
});

describe('repeats in the other languages', () => {
	it.each([
		['de', 'jeden Montag um 9', weekly(1)],
		['de', 'alle 2 Wochen', { unit: 'week', every: 2 }],
		['de', 'täglich um 7', daily],
		['de', 'werktags um 8', workweek],
		['de', 'montags und freitags', weekly(1, 5)],
		['es', 'todos los lunes a las 9', weekly(1)],
		['es', 'cada 2 semanas', { unit: 'week', every: 2 }],
		['es', 'todos los días', daily],
		['es', 'de lunes a viernes', workweek],
		['fr', 'tous les lundis à 9h', weekly(1)],
		['fr', 'tous les deux jours', { unit: 'day', every: 2 }],
		['fr', 'chaque mois', { unit: 'month', every: 1 }],
		['fr', 'en semaine', workweek],
		['it', 'ogni lunedì alle 9', weekly(1)],
		['it', 'tutti i giorni', daily],
		['it', 'ogni 2 settimane', { unit: 'week', every: 2 }],
		['nl', 'elke maandag om 9 uur', weekly(1)],
		['nl', 'om de 2 weken', { unit: 'week', every: 2 }],
		['nl', 'dagelijks', daily],
		['pt', 'toda segunda às 9', weekly(1)],
		['pt', 'todos os dias', daily],
		['pt', 'a cada 2 semanas', { unit: 'week', every: 2 }],
		['fi', 'joka maanantai klo 9', weekly(1)],
		['fi', 'joka toinen viikko', { unit: 'week', every: 2 }],
		['fi', '2 viikon välein', { unit: 'week', every: 2 }],
		['fi', 'arkisin', workweek],
		['id', 'setiap senin jam 9', weekly(1)],
		['id', 'setiap hari', daily],
		['id', 'setiap minggu', { unit: 'week', every: 1 }],
		['id', 'setiap hari minggu', weekly(0)],
		['ru', 'каждый понедельник в 9', weekly(1)],
		['ru', 'каждые 2 недели', { unit: 'week', every: 2 }],
		['ru', 'ежедневно', daily],
		['ru', 'по средам', weekly(3)],
		['uk', 'щопонеділка о 9', weekly(1)],
		['uk', 'кожні 2 тижні', { unit: 'week', every: 2 }],
		['uk', 'щодня', daily],
		['ar', 'كل يوم', daily],
		['ar', 'كل يوم الاثنين', weekly(1)],
		['ar', 'كل أسبوعين', { unit: 'week', every: 2 }],
		['ar', 'يومياً', daily],
		['ja', '毎日9時', daily],
		['ja', '毎週月曜', weekly(1)],
		['ja', '隔週', { unit: 'week', every: 2 }],
		['ja', '2週間ごと', { unit: 'week', every: 2 }],
		['ja', '毎朝', daily],
		['zh', '每天9点', daily],
		['zh', '每周一', weekly(1)],
		['zh', '每星期三和五', weekly(3, 5)],
		['zh', '每两个月', { unit: 'month', every: 2 }],
		['zh', '工作日', workweek]
	] as const)('%s reads "%s"', async (language, text, repeat) => {
		const phrase = (await reader(language))(text);
		expect(phrase?.repeat).toEqual(repeat);
		// The line under the field shows what was used.
		expect(phrase?.text).toBe(text);
	});

	it('takes the time typed with the repeat', async () => {
		expect((await reader('de'))('jeden Montag um 9')?.first).toEqual(at(10, 26, 9));
		expect((await reader('ja'))('毎日9時')?.first).toEqual(at(10, 22, 9));
		expect((await reader('zh'))('每周一下午')?.first).toEqual(at(10, 26, 15));
	});
});
