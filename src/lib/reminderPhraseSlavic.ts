// Slovak and Czech reminder phrases. chrono-node has neither language, so this is
// a small grammar of its own: a day, a time or both, in the words people type
// into a reminder ("zajtra o 9", "v piatok večer", "za 2 hodiny", "23. 10. o 14:30").
import type { PhraseReader, PhraseReading } from './reminderPhrase.js';
import { VAGUE_HOURS } from './reminderPhrase.js';

type Vague = keyof typeof VAGUE_HOURS;
type Unit = 'minute' | 'hour' | 'day' | 'week';

/** The words of one language, written without diacritics: input is folded the same way. */
interface Words {
	today: string[];
	tomorrow: string[];
	dayAfter: string[];
	/** Monday first. */
	weekdays: string[][];
	weekdayPrefix: string[];
	next: string[];
	week: string[];
	/** January first: genitive ("októbra") and nominative forms. */
	months: string[][];
	in: string[];
	half: string[];
	units: Record<Unit, string[]>;
	at: string[];
	vague: Record<Vague, string[]>;
	numbers: Record<string, number>;
}

const SLOVAK: Words = {
	today: ['dnes'],
	tomorrow: ['zajtra'],
	dayAfter: ['pozajtra'],
	weekdays: [
		['pondelok', 'pon'],
		['utorok', 'uto'],
		['streda', 'stredu', 'str'],
		['stvrtok', 'stv'],
		['piatok', 'pia'],
		['sobota', 'sobotu', 'sob'],
		['nedela', 'nedelu', 'ned']
	],
	weekdayPrefix: ['v', 'vo', 'na'],
	next: ['buduci', 'buducu', 'buduca', 'dalsi', 'dalsiu'],
	week: ['tyzden'],
	months: [
		['januara', 'januar', 'jan'],
		['februara', 'februar', 'feb'],
		['marca', 'marec', 'mar'],
		['aprila', 'april', 'apr'],
		['maja', 'maj'],
		['juna', 'jun'],
		['jula', 'jul'],
		['augusta', 'august', 'aug'],
		['septembra', 'september', 'sept', 'sep'],
		['oktobra', 'oktober', 'okt'],
		['novembra', 'november', 'nov'],
		['decembra', 'december', 'dec']
	],
	in: ['za'],
	half: ['pol'],
	units: {
		minute: ['minut', 'minuty', 'minutu', 'min'],
		hour: ['hodin', 'hodiny', 'hodinu', 'hod', 'h'],
		day: ['dni', 'den', 'dna'],
		week: ['tyzdnov', 'tyzdne', 'tyzden']
	},
	at: ['o'],
	vague: {
		morning: ['rano', 'rana'],
		noon: ['na obed', 'obed', 'napoludnie', 'poludnie', 'poludni'],
		afternoon: ['poobede', 'popoludni', 'popoludnie'],
		evening: ['vecer', 'vecerom']
	},
	numbers: {
		jeden: 1,
		jedna: 1,
		jednu: 1,
		dva: 2,
		dve: 2,
		tri: 3,
		styri: 4,
		pat: 5,
		sest: 6,
		sedem: 7,
		osem: 8,
		devat: 9,
		desat: 10
	}
};

const CZECH: Words = {
	today: ['dnes'],
	tomorrow: ['zitra'],
	dayAfter: ['pozitri'],
	weekdays: [
		['pondeli', 'pon'],
		['utery', 'ute'],
		['streda', 'stredu', 'str'],
		['ctvrtek', 'ctv'],
		['patek', 'pat'],
		['sobota', 'sobotu', 'sob'],
		['nedele', 'nedeli', 'ned']
	],
	weekdayPrefix: ['v', 've', 'na'],
	next: ['pristi'],
	week: ['tyden'],
	months: [
		['ledna', 'leden', 'led'],
		['unora', 'unor', 'uno'],
		['brezna', 'brezen', 'bre'],
		['dubna', 'duben', 'dub'],
		['kvetna', 'kveten', 'kve'],
		['cervna', 'cerven'],
		['cervence', 'cervenec'],
		['srpna', 'srpen', 'srp'],
		['zari'],
		['rijna', 'rijen', 'rij'],
		['listopadu', 'listopad', 'lis'],
		['prosince', 'prosinec', 'pro']
	],
	in: ['za'],
	half: ['pul'],
	units: {
		minute: ['minut', 'minuty', 'minutu', 'min'],
		hour: ['hodin', 'hodiny', 'hodinu', 'hod', 'h'],
		day: ['dni', 'dny', 'den', 'dnu'],
		week: ['tydnu', 'tydny', 'tyden']
	},
	at: ['v', 've', 'o'],
	vague: {
		morning: ['rano'],
		noon: ['v poledne', 'poledne', 'na obed', 'obed'],
		afternoon: ['odpoledne'],
		evening: ['vecer', 'vecerem']
	},
	numbers: {
		jeden: 1,
		jedna: 1,
		jednu: 1,
		dva: 2,
		dve: 2,
		tri: 3,
		ctyri: 4,
		pet: 5,
		sest: 6,
		sedm: 7,
		osm: 8,
		devet: 9,
		deset: 10
	}
};

const UNIT_MS: Record<Unit, number> = {
	minute: 60_000,
	hour: 3_600_000,
	day: 86_400_000,
	week: 7 * 86_400_000
};

/** Lower case without diacritics, one character for one, so match offsets map back to the input. */
function fold(text: string): string {
	let out = '';
	for (const char of text) {
		const base = char.toLowerCase().normalize('NFD');
		// An astral character takes two code units; keep two so offsets stay aligned.
		out += char.length === 2 ? '__' : (base[0] ?? char);
	}
	return out;
}

function alt(words: string[]): string {
	return [...words]
		.sort((a, b) => b.length - a.length)
		.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
		.join('|');
}

const END = '(?![\\p{L}\\p{N}])';

interface Grammar {
	relative: RegExp;
	nextWeek: RegExp;
	weekday: RegExp;
	casualDay: RegExp;
	numericDate: RegExp;
	monthDate: RegExp;
	time: RegExp;
	vague: RegExp;
	words: Words;
}

function grammar(words: Words): Grammar {
	const sticky = (source: string) => new RegExp(source + END, 'uy');
	const numbers = alt(Object.keys(words.numbers));
	const units = (Object.keys(words.units) as Unit[])
		.map((unit) => `(?<${unit}>${alt(words.units[unit])})`)
		.join('|');
	const vague = (Object.keys(words.vague) as Vague[])
		.map((part) => `(?<${part}>${alt(words.vague[part])})`)
		.join('|');
	const weekdays = words.weekdays.map((names, index) => `(?<d${index}>${alt(names)})`).join('|');
	const months = words.months.map((names, index) => `(?<m${index}>${alt(names)})`).join('|');
	return {
		words,
		relative: sticky(
			`(?:${alt(words.in)})\\s+(?:(?<count>\\d{1,3}|${numbers})\\s+)?(?<half>(?:${alt(words.half)})\\s+)?(?:${units})\\.?`
		),
		nextWeek: sticky(`(?:${alt(words.next)})\\s+(?:${alt(words.week)})`),
		weekday: sticky(
			`(?:(?:${alt(words.weekdayPrefix)})\\s+)?(?<next>(?:${alt(words.next)})\\s+)?(?:${weekdays})\\.?`
		),
		casualDay: sticky(
			`(?<today>${alt(words.today)})|(?<dayAfter>${alt(words.dayAfter)})|(?<tomorrow>${alt(words.tomorrow)})`
		),
		numericDate: sticky(
			`(?<day>\\d{1,2})\\.\\s*(?<month>\\d{1,2})\\.(?:\\s*(?<year>\\d{4}))?|(?<day2>\\d{1,2})\\.(?<month2>\\d{1,2})\\.?(?<year2>\\d{4})`
		),
		monthDate: sticky(`(?<day>\\d{1,2})\\.?\\s*(?:${months})\\.?(?:\\s+(?<year>\\d{4}))?`),
		time: sticky(
			`(?<at>(?:${alt(words.at)})\\s+)?(?<hour>\\d{1,2})(?:[:.](?<minute>\\d{2}))?(?<suffix>\\s*(?:hod|h)\\.?)?(?:\\s+(?:${vague}))?`
		),
		vague: sticky(`(?:(?:${alt([...words.at, 'na'])})\\s+)?(?:${vague})`)
	};
}

function groupIndex(groups: Record<string, string | undefined>, prefix: string): number {
	for (const [name, value] of Object.entries(groups)) {
		if (value !== undefined && name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length))) {
			return Number(name.slice(prefix.length));
		}
	}
	return -1;
}

function vagueOf(groups: Record<string, string | undefined>): Vague | null {
	for (const part of Object.keys(VAGUE_HOURS) as Vague[]) {
		if (groups[part] !== undefined) return part;
	}
	return null;
}

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Monday = 0. */
function weekdayIndex(date: Date): number {
	return (date.getDay() + 6) % 7;
}

/** "za hodinu" is one; a number word this grammar does not know is no number at all. */
function count(words: Words, value: string | undefined): number | null {
	if (value === undefined) return 1;
	return /^\d+$/.test(value) ? Number(value) : (words.numbers[value] ?? null);
}

/** A calendar date, or null when the day does not exist (31. 2.). */
function calendarDate(year: number, month: number, day: number): Date | null {
	const date = new Date(year, month, day);
	return date.getMonth() === month && date.getDate() === day ? date : null;
}

/** A day and month without a year: this year, or next year once it has passed. */
function upcoming(today: Date, month: number, day: number, year: string | undefined): Date | null {
	if (year) return calendarDate(Number(year), month, day);
	const date = calendarDate(today.getFullYear(), month, day);
	if (date && date < today) return calendarDate(today.getFullYear() + 1, month, day);
	return date;
}

type Part =
	| { kind: 'date'; date: Date }
	| { kind: 'moment'; at: Date }
	| { kind: 'time'; hour: number; minute: number };

function readPart(
	g: Grammar,
	text: string,
	at: number,
	now: Date,
	hasDate: boolean
): [Part, number] | null {
	const today = startOfDay(now);
	const exec = (pattern: RegExp) => {
		pattern.lastIndex = at;
		return pattern.exec(text);
	};

	let match = exec(g.relative);
	if (match?.groups) {
		const groups = match.groups;
		const unit = (Object.keys(UNIT_MS) as Unit[]).find((name) => groups[name] !== undefined)!;
		const amount = groups.half ? 0.5 : count(g.words, groups.count);
		// Unreadable beats a wrong time: "za dvacet minut" must not become one minute.
		if (amount === null) return null;
		if (unit === 'minute' || unit === 'hour') {
			return [
				{ kind: 'moment', at: new Date(now.getTime() + amount * UNIT_MS[unit]) },
				match[0].length
			];
		}
		const days = Math.round(amount * (unit === 'week' ? 7 : 1));
		return [{ kind: 'date', date: addDays(today, days) }, match[0].length];
	}

	match = exec(g.nextWeek);
	if (match) return [{ kind: 'date', date: addDays(today, 7) }, match[0].length];

	match = exec(g.weekday);
	if (match?.groups) {
		const target = groupIndex(match.groups, 'd');
		// The next one after today; on the day itself, a week on.
		let ahead = (target - weekdayIndex(today) + 7) % 7 || 7;
		if (match.groups.next !== undefined) {
			// "budúci piatok" is Friday of next week, counted from Monday.
			const nextMonday = 7 - weekdayIndex(today);
			ahead = nextMonday + target;
		}
		return [{ kind: 'date', date: addDays(today, ahead) }, match[0].length];
	}

	match = exec(g.casualDay);
	if (match?.groups) {
		const days = match.groups.today ? 0 : match.groups.tomorrow ? 1 : 2;
		return [{ kind: 'date', date: addDays(today, days) }, match[0].length];
	}

	match = exec(g.numericDate);
	if (match?.groups) {
		const groups = match.groups;
		const day = Number(groups.day ?? groups.day2);
		const month = Number(groups.month ?? groups.month2) - 1;
		const date = upcoming(today, month, day, groups.year ?? groups.year2);
		if (date) return [{ kind: 'date', date }, match[0].length];
	}

	match = exec(g.monthDate);
	if (match?.groups) {
		const date = upcoming(
			today,
			groupIndex(match.groups, 'm'),
			Number(match.groups.day),
			match.groups.year
		);
		if (date) return [{ kind: 'date', date }, match[0].length];
	}

	match = exec(g.time);
	if (match?.groups) {
		const groups = match.groups;
		const part = vagueOf(groups);
		// A lone number is a time only with a cue: "o 9", "9:30", "9h", "9 večer", or after a day.
		const cued = groups.at || groups.minute || groups.suffix || part || hasDate;
		let hour = Number(groups.hour);
		const minute = Number(groups.minute ?? 0);
		if (cued && hour < 24 && minute < 60) {
			if ((part === 'afternoon' || part === 'evening') && hour < 12) hour += 12;
			return [{ kind: 'time', hour, minute }, match[0].length];
		}
	}

	match = exec(g.vague);
	if (match?.groups) {
		const part = vagueOf(match.groups)!;
		return [{ kind: 'time', hour: VAGUE_HOURS[part], minute: 0 }, match[0].length];
	}

	return null;
}

function reader(words: Words): PhraseReader {
	const g = grammar(words);
	return (input, now) => {
		const source = input.normalize('NFC');
		const text = fold(source);
		// Try each word start in turn, so "pripomeň mi zajtra o 9" finds "zajtra o 9".
		for (const start of text.matchAll(/(?<![\p{L}\p{N}])[\p{L}\p{N}]/gu)) {
			let at = start.index;
			let end = at;
			let date: Date | null = null;
			let moment: Date | null = null;
			let time: { hour: number; minute: number } | null = null;
			for (;;) {
				const read = readPart(g, text, at, now, date !== null);
				if (!read) break;
				const [part, length] = read;
				if (part.kind === 'date' && !date && !moment) date = part.date;
				else if (part.kind === 'time' && !time && !moment) time = part;
				else if (part.kind === 'moment' && !date && !time && !moment) moment = part.at;
				else break;
				end = at + length;
				const gap = /[\s,]*/y;
				gap.lastIndex = end;
				gap.exec(text);
				at = gap.lastIndex;
			}
			if (end === start.index) continue;
			const phrase = source.slice(start.index, end);
			if (moment) return { text: phrase, date: moment, timeGiven: true };
			const day = date ?? startOfDay(now);
			const result = new Date(day);
			if (time) result.setHours(time.hour, time.minute, 0, 0);
			// A time with no day is the next one: "o 9" at noon is tomorrow morning.
			if (time && !date && result < now) result.setDate(result.getDate() + 1);
			return { text: phrase, date: result, timeGiven: time !== null } satisfies PhraseReading;
		}
		return null;
	};
}

export const slovak = reader(SLOVAK);
export const czech = reader(CZECH);
