// Typed repeats: "every day at 9", "každý pondelok o 8", "alle 2 Wochen", "毎週月曜".
// Each language lists its words; the patterns are built from them. The repeat
// words are taken out of the text and the rest is read for the first time, so
// "every monday at 9" repeats weekly on Monday from the next Monday at 9.
import type { ReminderRepeat, RepeatUnit } from '#lib/model/index.js';
import type { ReminderLanguage } from './reminderPhrase.js';

export type TypedRepeat = Omit<ReminderRepeat, 'zone'>;

export type FoundRepeat = { repeat: TypedRepeat; index: number; end: number };

interface RepeatWords {
	/** Written without spaces between words (Japanese, Chinese). */
	tight?: boolean;
	/** "every", in each form it takes before a unit or a day. */
	every: string[];
	/** Count words; "other" counts as 2. Digits always count. */
	numbers?: Record<string, number>;
	/** A word between a count and its unit (Chinese 个). */
	counter?: string[];
	units: Record<RepeatUnit, string[]>;
	/** Sunday first; each day in the forms it takes after "every". */
	days: string[][];
	/** A day is only a day after the word for week (Chinese 每周一, never 每一). */
	dayNeedsWeek?: boolean;
	/** Between the week and its day: "every week on Monday". */
	on?: string[];
	/** Between two days: "Monday and Wednesday". */
	and?: string[];
	/** Monday to Friday. */
	workweek?: string[];
	/** Whole words for a repeat: "daily", "fortnightly", "隔週". */
	phrases?: [words: string[], unit: RepeatUnit, every?: number][];
	/** Whole words for one weekday each, Sunday first: "mondays", "montags", "по понедельникам". */
	dayPhrases?: string[][];
	/** After a count and unit: "2 viikon välein", "2週間ごと". */
	after?: string[];
	/** Parts of the day after "every": the repeat is daily and the part is left for the time. */
	partsOfDay?: string[];
}

const WORKWEEK = [1, 2, 3, 4, 5];

const WORDS: Record<ReminderLanguage, RepeatWords> = {
	en: {
		every: ['every', 'each'],
		numbers: { other: 2, second: 2, two: 2, three: 3, four: 4, five: 5, six: 6 },
		units: {
			day: ['day', 'days'],
			week: ['week', 'weeks'],
			month: ['month', 'months'],
			year: ['year', 'years']
		},
		days: [
			['sunday', 'sun'],
			['monday', 'mon'],
			['tuesday', 'tues', 'tue'],
			['wednesday', 'wed'],
			['thursday', 'thurs', 'thur', 'thu'],
			['friday', 'fri'],
			['saturday', 'sat']
		],
		on: ['on'],
		and: ['and', '&'],
		workweek: [
			'every weekday',
			'every workday',
			'every working day',
			'on weekdays',
			'weekdays',
			'workdays'
		],
		phrases: [
			[['daily', 'everyday'], 'day'],
			[['weekly'], 'week'],
			[['fortnightly', 'biweekly', 'every fortnight'], 'week', 2],
			[['monthly'], 'month'],
			[['yearly', 'annually'], 'year']
		],
		dayPhrases: [
			['sundays'],
			['mondays'],
			['tuesdays'],
			['wednesdays'],
			['thursdays'],
			['fridays'],
			['saturdays']
		],
		partsOfDay: ['morning', 'afternoon', 'evening', 'night']
	},
	sk: {
		every: ['každý', 'každá', 'každé', 'každú', 'každých', 'každom'],
		numbers: { dva: 2, dve: 2, tri: 3, štyri: 4, päť: 5, druhý: 2, druhá: 2, druhé: 2, druhú: 2 },
		units: {
			day: ['deň', 'dni', 'dní', 'dňa'],
			week: ['týždeň', 'týždne', 'týždňov', 'týždňa'],
			month: ['mesiac', 'mesiace', 'mesiacov', 'mesiaca'],
			year: ['rok', 'roky', 'rokov', 'roka']
		},
		days: [
			['nedeľu', 'nedeľa'],
			['pondelok'],
			['utorok'],
			['stredu', 'streda'],
			['štvrtok'],
			['piatok'],
			['sobotu', 'sobota']
		],
		on: ['v', 'vo', 'na'],
		and: ['a'],
		workweek: [
			'každý pracovný deň',
			'každý všedný deň',
			'cez pracovné dni',
			'v pracovné dni',
			'pracovné dni',
			'cez týždeň'
		],
		phrases: [
			[['denne', 'každodenne'], 'day'],
			[['týždenne'], 'week'],
			[['mesačne'], 'month'],
			[['ročne'], 'year']
		],
		dayPhrases: [
			['v nedele'],
			['v pondelky'],
			['v utorky'],
			['v stredy'],
			['vo štvrtky'],
			['v piatky'],
			['v soboty']
		],
		partsOfDay: ['ráno', 'doobedie', 'popoludnie', 'poobedie', 'večer', 'noc']
	},
	cs: {
		every: ['každý', 'každá', 'každé', 'každou', 'každých', 'každém'],
		numbers: { dva: 2, dvě: 2, tři: 3, čtyři: 4, pět: 5, druhý: 2, druhá: 2, druhé: 2, druhou: 2 },
		units: {
			day: ['den', 'dny', 'dní', 'dnů'],
			week: ['týden', 'týdny', 'týdnů'],
			month: ['měsíc', 'měsíce', 'měsíců'],
			year: ['rok', 'roky', 'let', 'roků']
		},
		days: [
			['neděli', 'neděle'],
			['pondělí'],
			['úterý'],
			['středu', 'středa'],
			['čtvrtek'],
			['pátek'],
			['sobotu', 'sobota']
		],
		on: ['v', 've'],
		and: ['a'],
		workweek: [
			'každý pracovní den',
			'každý všední den',
			'v pracovní dny',
			've všední dny',
			'pracovní dny',
			'všední dny'
		],
		phrases: [
			[['denně', 'každodenně'], 'day'],
			[['týdně'], 'week'],
			[['měsíčně'], 'month'],
			[['ročně'], 'year']
		],
		dayPhrases: [
			['v neděle'],
			['v pondělky'],
			['v úterky'],
			['ve středy'],
			['ve čtvrtky'],
			['v pátky'],
			['v soboty']
		],
		partsOfDay: ['ráno', 'dopoledne', 'odpoledne', 'večer', 'noc']
	},
	de: {
		every: ['jeden', 'jede', 'jedes', 'alle'],
		numbers: { zwei: 2, drei: 3, vier: 4, fünf: 5, zweite: 2, zweiten: 2 },
		units: {
			day: ['tag', 'tage'],
			week: ['woche', 'wochen'],
			month: ['monat', 'monate'],
			year: ['jahr', 'jahre']
		},
		days: [
			['sonntag'],
			['montag'],
			['dienstag'],
			['mittwoch'],
			['donnerstag'],
			['freitag'],
			['samstag', 'sonnabend']
		],
		and: ['und'],
		workweek: ['jeden werktag', 'an werktagen', 'werktags', 'wochentags'],
		phrases: [
			[['täglich'], 'day'],
			[['wöchentlich'], 'week'],
			[['monatlich'], 'month'],
			[['jährlich'], 'year']
		],
		dayPhrases: [
			['sonntags'],
			['montags'],
			['dienstags'],
			['mittwochs'],
			['donnerstags'],
			['freitags'],
			['samstags']
		],
		partsOfDay: ['morgen', 'vormittag', 'nachmittag', 'abend']
	},
	es: {
		every: ['cada', 'todos los', 'todas las'],
		numbers: { dos: 2, tres: 3, cuatro: 4, cinco: 5 },
		units: {
			day: ['día', 'días'],
			week: ['semana', 'semanas'],
			month: ['mes', 'meses'],
			year: ['año', 'años']
		},
		days: [
			['domingo', 'domingos'],
			['lunes'],
			['martes'],
			['miércoles'],
			['jueves'],
			['viernes'],
			['sábado', 'sábados']
		],
		and: ['y'],
		workweek: [
			'todos los días laborables',
			'cada día laborable',
			'días laborables',
			'de lunes a viernes',
			'entre semana'
		],
		phrases: [
			[['diariamente', 'a diario'], 'day'],
			[['semanalmente'], 'week'],
			[['mensualmente'], 'month'],
			[['anualmente'], 'year']
		],
		partsOfDay: ['mañana', 'mañanas', 'tarde', 'tardes', 'noche', 'noches']
	},
	fr: {
		every: ['chaque', 'tous les', 'toutes les'],
		numbers: { deux: 2, trois: 3, quatre: 4, cinq: 5 },
		units: {
			day: ['jour', 'jours'],
			week: ['semaine', 'semaines'],
			month: ['mois'],
			year: ['an', 'ans', 'année', 'années']
		},
		days: [
			['dimanche', 'dimanches'],
			['lundi', 'lundis'],
			['mardi', 'mardis'],
			['mercredi', 'mercredis'],
			['jeudi', 'jeudis'],
			['vendredi', 'vendredis'],
			['samedi', 'samedis']
		],
		and: ['et'],
		workweek: [
			'tous les jours ouvrables',
			'chaque jour ouvrable',
			'les jours ouvrables',
			'du lundi au vendredi',
			'en semaine'
		],
		phrases: [
			[['quotidiennement'], 'day'],
			[['hebdomadairement'], 'week'],
			[['mensuellement'], 'month'],
			[['annuellement'], 'year']
		],
		partsOfDay: ['matin', 'matins', 'après-midi', 'soir', 'soirs']
	},
	it: {
		every: ['ogni', 'tutti i', 'tutte le', 'tutti gli'],
		numbers: { due: 2, tre: 3, quattro: 4, cinque: 5 },
		units: {
			day: ['giorno', 'giorni'],
			week: ['settimana', 'settimane'],
			month: ['mese', 'mesi'],
			year: ['anno', 'anni']
		},
		days: [
			['domenica', 'domeniche'],
			['lunedì'],
			['martedì'],
			['mercoledì'],
			['giovedì'],
			['venerdì'],
			['sabato', 'sabati']
		],
		and: ['e'],
		workweek: [
			'ogni giorno feriale',
			'nei giorni feriali',
			'giorni feriali',
			'dal lunedì al venerdì'
		],
		phrases: [
			[['quotidianamente'], 'day'],
			[['settimanalmente'], 'week'],
			[['mensilmente'], 'month'],
			[['annualmente'], 'year']
		],
		partsOfDay: ['mattina', 'mattine', 'pomeriggio', 'sera', 'sere']
	},
	nl: {
		every: ['elke', 'elk', 'iedere', 'ieder', 'om de'],
		numbers: { twee: 2, drie: 3, vier: 4, vijf: 5 },
		units: {
			day: ['dag', 'dagen'],
			week: ['week', 'weken'],
			month: ['maand', 'maanden'],
			year: ['jaar', 'jaren']
		},
		days: [
			['zondag'],
			['maandag'],
			['dinsdag'],
			['woensdag'],
			['donderdag'],
			['vrijdag'],
			['zaterdag']
		],
		and: ['en'],
		workweek: ['elke werkdag', 'op werkdagen', 'doordeweeks'],
		phrases: [
			[['dagelijks'], 'day'],
			[['wekelijks'], 'week'],
			[['maandelijks'], 'month'],
			[['jaarlijks'], 'year']
		],
		dayPhrases: [
			["'s zondags", 'zondags'],
			["'s maandags", 'maandags'],
			["'s dinsdags", 'dinsdags'],
			["'s woensdags", 'woensdags'],
			["'s donderdags", 'donderdags'],
			["'s vrijdags", 'vrijdags'],
			["'s zaterdags", 'zaterdags']
		],
		partsOfDay: ['ochtend', 'middag', 'avond']
	},
	pt: {
		every: ['a cada', 'cada', 'todo', 'toda', 'todos os', 'todas as'],
		numbers: { dois: 2, duas: 2, três: 3, quatro: 4, cinco: 5 },
		units: {
			day: ['dia', 'dias'],
			week: ['semana', 'semanas'],
			month: ['mês', 'meses'],
			year: ['ano', 'anos']
		},
		days: [
			['domingo', 'domingos'],
			['segunda-feira', 'segundas-feiras', 'segunda', 'segundas'],
			['terça-feira', 'terças-feiras', 'terça', 'terças'],
			['quarta-feira', 'quartas-feiras', 'quarta', 'quartas'],
			['quinta-feira', 'quintas-feiras', 'quinta', 'quintas'],
			['sexta-feira', 'sextas-feiras', 'sexta', 'sextas'],
			['sábado', 'sábados']
		],
		and: ['e'],
		workweek: ['todos os dias úteis', 'todo dia útil', 'dias úteis', 'de segunda a sexta'],
		phrases: [
			[['diariamente'], 'day'],
			[['semanalmente'], 'week'],
			[['mensalmente'], 'month'],
			[['anualmente'], 'year']
		],
		partsOfDay: ['manhã', 'manhãs', 'tarde', 'tardes', 'noite', 'noites']
	},
	fi: {
		every: ['joka', 'jokainen'],
		numbers: { toinen: 2, kaksi: 2, kolme: 3 },
		units: {
			day: ['päivä', 'päivän', 'päivää'],
			week: ['viikko', 'viikon', 'viikkoa'],
			month: ['kuukausi', 'kuukauden', 'kuukautta'],
			year: ['vuosi', 'vuoden', 'vuotta']
		},
		days: [
			['sunnuntai'],
			['maanantai'],
			['tiistai'],
			['keskiviikko'],
			['torstai'],
			['perjantai'],
			['lauantai']
		],
		and: ['ja'],
		workweek: ['joka arkipäivä', 'arkipäivisin', 'arkisin'],
		phrases: [
			[['päivittäin'], 'day'],
			[['viikoittain'], 'week'],
			[['kuukausittain'], 'month'],
			[['vuosittain'], 'year']
		],
		dayPhrases: [
			['sunnuntaisin'],
			['maanantaisin'],
			['tiistaisin'],
			['keskiviikkoisin'],
			['torstaisin'],
			['perjantaisin'],
			['lauantaisin']
		],
		after: ['välein'],
		partsOfDay: ['aamu', 'ilta', 'yö']
	},
	id: {
		every: ['setiap', 'tiap'],
		numbers: { dua: 2, tiga: 3, empat: 4, lima: 5 },
		units: {
			day: ['hari'],
			week: ['minggu', 'pekan'],
			month: ['bulan'],
			year: ['tahun']
		},
		// "Minggu" is also the week: Sunday takes "hari" to be told apart.
		days: [
			['hari minggu', 'ahad'],
			['senin', 'hari senin'],
			['selasa', 'hari selasa'],
			['rabu', 'hari rabu'],
			['kamis', 'hari kamis'],
			['jumat', "jum'at", 'hari jumat'],
			['sabtu', 'hari sabtu']
		],
		and: ['dan'],
		workweek: ['setiap hari kerja', 'tiap hari kerja', 'hari kerja'],
		phrases: [
			[['harian'], 'day'],
			[['mingguan'], 'week'],
			[['bulanan'], 'month'],
			[['tahunan'], 'year']
		],
		partsOfDay: ['pagi', 'siang', 'sore', 'malam']
	},
	ru: {
		every: ['каждый', 'каждую', 'каждое', 'каждые', 'каждых'],
		numbers: { два: 2, две: 2, три: 3, четыре: 4, пять: 5 },
		units: {
			day: ['день', 'дня', 'дней', 'дни'],
			week: ['неделю', 'недели', 'недель', 'неделя'],
			month: ['месяц', 'месяца', 'месяцев'],
			year: ['год', 'года', 'лет']
		},
		days: [
			['воскресенье'],
			['понедельник'],
			['вторник'],
			['среду', 'среда'],
			['четверг'],
			['пятницу', 'пятница'],
			['субботу', 'суббота']
		],
		and: ['и'],
		workweek: [
			'каждый будний день',
			'каждый рабочий день',
			'по рабочим дням',
			'по будням',
			'в будни'
		],
		phrases: [
			[['ежедневно'], 'day'],
			[['еженедельно'], 'week'],
			[['ежемесячно'], 'month'],
			[['ежегодно'], 'year']
		],
		dayPhrases: [
			['по воскресеньям'],
			['по понедельникам'],
			['по вторникам'],
			['по средам'],
			['по четвергам'],
			['по пятницам'],
			['по субботам']
		],
		partsOfDay: ['утро', 'вечер', 'день']
	},
	uk: {
		every: ['кожен', 'кожний', 'кожного', 'кожну', 'кожне', 'кожні', 'кожних'],
		numbers: { два: 2, дві: 2, три: 3, чотири: 4, "п'ять": 5 },
		units: {
			day: ['день', 'дні', 'днів', 'дня'],
			week: ['тиждень', 'тижні', 'тижнів', 'тижня'],
			month: ['місяць', 'місяці', 'місяців', 'місяця'],
			year: ['рік', 'роки', 'років', 'року']
		},
		days: [
			['неділю', 'неділі', 'неділя'],
			['понеділок', 'понеділка'],
			['вівторок', 'вівторка'],
			['середу', 'середи', 'середа'],
			['четвер', 'четверга'],
			["п'ятницю", 'пʼятницю', "п'ятниці", 'пʼятниці'],
			['суботу', 'суботи', 'субота']
		],
		and: ['і', 'й', 'та'],
		workweek: ['кожного робочого дня', 'по робочих днях', 'по буднях', 'у будні', 'щобудня'],
		phrases: [
			[['щодня', 'щоденно'], 'day'],
			[['щотижня'], 'week'],
			[['щомісяця'], 'month'],
			[['щороку', 'щорічно'], 'year']
		],
		dayPhrases: [
			['щонеділі', 'по неділях'],
			['щопонеділка', 'по понеділках'],
			['щовівторка', 'по вівторках'],
			['щосереди', 'по середах'],
			['щочетверга', 'по четвергах'],
			["щоп'ятниці", 'щопʼятниці', "по п'ятницях", 'по пʼятницях'],
			['щосуботи', 'по суботах']
		],
		partsOfDay: ['ранку', 'вечора', 'ранок', 'вечір']
	},
	ar: {
		every: ['كل'],
		units: {
			day: ['يوم', 'أيام'],
			week: ['أسبوع', 'أسابيع'],
			month: ['شهر', 'أشهر', 'شهور'],
			year: ['سنة', 'عام', 'سنوات', 'أعوام']
		},
		days: [
			['يوم الأحد', 'الأحد', 'أحد'],
			['يوم الاثنين', 'يوم الإثنين', 'الاثنين', 'الإثنين', 'اثنين'],
			['يوم الثلاثاء', 'الثلاثاء', 'ثلاثاء'],
			['يوم الأربعاء', 'الأربعاء', 'أربعاء'],
			['يوم الخميس', 'الخميس', 'خميس'],
			['يوم الجمعة', 'الجمعة', 'جمعة'],
			['يوم السبت', 'السبت', 'سبت']
		],
		and: ['و'],
		phrases: [
			[['يوميا', 'يومياً'], 'day'],
			[['كل يومين'], 'day', 2],
			[['أسبوعيا', 'أسبوعياً'], 'week'],
			[['كل أسبوعين'], 'week', 2],
			[['شهريا', 'شهرياً'], 'month'],
			[['كل شهرين'], 'month', 2],
			[['سنويا', 'سنوياً'], 'year'],
			[['كل سنتين', 'كل عامين'], 'year', 2]
		],
		partsOfDay: ['صباح', 'مساء', 'ليلة']
	},
	ja: {
		tight: true,
		every: ['毎'],
		numbers: { 二: 2, 三: 3 },
		units: {
			day: ['日'],
			week: ['週', '週間'],
			month: ['月', 'か月', 'ヶ月', 'カ月', 'ヵ月'],
			year: ['年']
		},
		days: [
			['日曜日', '日曜'],
			['月曜日', '月曜'],
			['火曜日', '火曜'],
			['水曜日', '水曜'],
			['木曜日', '木曜'],
			['金曜日', '金曜'],
			['土曜日', '土曜']
		],
		and: ['と', '、'],
		workweek: ['毎平日', '平日'],
		phrases: [
			[['隔日'], 'day', 2],
			[['隔週'], 'week', 2],
			[['隔月'], 'month', 2],
			[['隔年'], 'year', 2]
		],
		after: ['ごと', '毎', 'おき'],
		partsOfDay: ['朝', '晩', '夜', '夕方']
	},
	zh: {
		tight: true,
		every: ['每个', '每個', '每'],
		numbers: { 两: 2, 兩: 2, 二: 2, 三: 3, 四: 4, 五: 5 },
		counter: ['个', '個'],
		units: {
			day: ['天', '日'],
			week: ['周', '週', '星期', '礼拜', '禮拜'],
			month: ['月'],
			year: ['年']
		},
		days: [['日', '天'], ['一'], ['二'], ['三'], ['四'], ['五'], ['六']],
		dayNeedsWeek: true,
		and: ['和', '、'],
		workweek: ['每个工作日', '每個工作日', '工作日', '周一到周五', '週一到週五'],
		phrases: [
			[['隔天', '每隔一天'], 'day', 2],
			[['隔周', '隔週', '每隔一周', '每隔一週'], 'week', 2]
		]
	}
};

const MARK = /^\p{M}$/u;

/**
 * Lowercase without diacritics, and where in the text each folded character came from.
 * A mark typed after its letter (decomposed text) is dropped and its place goes with the letter.
 */
function folding(text: string): { folded: string; from: number[] } {
	let folded = '';
	const from: number[] = [];
	let at = 0;
	for (const char of text) {
		if (!MARK.test(char)) {
			const plain = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
			const lower = char.toLowerCase();
			const kept =
				plain.length === char.length ? plain : lower.length === char.length ? lower : char;
			folded += kept;
			for (let i = 0; i < kept.length; i++) from.push(at + i);
		}
		at += char.length;
	}
	from.push(at);
	return { folded, from };
}

function fold(text: string): string {
	return folding(text).folded;
}

function escape(word: string): string {
	return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
}

/** One alternation of words, longest first, and what each folded word stands for. */
function words<T>(entries: [string[], T][]): { pattern: string; of: Map<string, T> } {
	const of = new Map<string, T>();
	for (const [forms, value] of entries) for (const form of forms) of.set(fold(form), value);
	const sorted = [...of.keys()].sort((left, right) => right.length - left.length);
	return { pattern: sorted.length ? `(?:${sorted.map(escape).join('|')})` : '(?!)', of };
}

type Pattern = { regex: RegExp; read: (match: RegExpExecArray) => TypedRepeat | null };

function compile(lexicon: RepeatWords): Pattern[] {
	const tight = !!lexicon.tight;
	const start = tight ? '' : '(?<![\\p{L}\\p{N}])';
	const stop = tight ? '' : "(?![\\p{L}\\p{N}'ʼ])";
	const gap = tight ? '\\s*' : '\\s+';
	const flags = 'iu';
	const every = words([[lexicon.every, true]]).pattern;
	const numbers = words(Object.entries(lexicon.numbers ?? {}).map(([word, n]) => [[word], n]));
	const count = `(\\d{1,3}|${numbers.pattern})`;
	const counter = lexicon.counter ? `(?:${words([[lexicon.counter, true]]).pattern}\\s*)?` : '';
	const units = words(
		Object.entries(lexicon.units).map(([unit, forms]) => [forms, unit as RepeatUnit])
	);
	const week = words([[lexicon.units.week, true]]).pattern;
	const days = words(lexicon.days.map((forms, day) => [forms, day]));
	const on = lexicon.on?.length ? `(?:${words([[lexicon.on, true]]).pattern}${gap})?` : '';
	const and = `(?:\\s*,\\s*|${gap}${words([[lexicon.and ?? [], true]]).pattern}${gap}|\\s*、\\s*)`;
	const toCount = (word: string | undefined) =>
		word === undefined ? 1 : /^\d+$/.test(word) ? Number(word) : (numbers.of.get(fold(word)) ?? 1);
	const dayList = (text: string) =>
		[...text.matchAll(new RegExp(days.pattern, 'giu'))]
			.map((match) => days.of.get(fold(match[0])))
			.filter((day): day is number => day !== undefined);

	const patterns: Pattern[] = [
		// every 2 weeks, každé 2 týždne, alle 2 Wochen, 每两个月
		{
			regex: new RegExp(
				`${start}${every}${gap}(?:${count}${gap}${counter})?(${units.pattern})${stop}`,
				flags
			),
			read: (match) => {
				const unit = units.of.get(fold(match[2]));
				return unit ? { unit, every: toCount(match[1]) } : null;
			}
		},
		// every Monday and Wednesday, každú stredu, 毎週月曜, 每周一
		{
			regex: new RegExp(
				`${start}${every}${gap}(?:${count}${gap})?(?:${week}${gap}${on})${lexicon.dayNeedsWeek ? '' : '?'}(${days.pattern}(?:${and}${days.pattern})*)${stop}`,
				flags
			),
			read: (match) => {
				const weekdays = [...new Set(dayList(match[2]))].sort((left, right) => left - right);
				return weekdays.length ? { unit: 'week', every: toCount(match[1]), weekdays } : null;
			}
		}
	];
	if (lexicon.workweek?.length) {
		const workweek = words([[lexicon.workweek, true]]).pattern;
		patterns.push({
			regex: new RegExp(`${start}${workweek}${stop}`, flags),
			read: () => ({ unit: 'week', every: 1, weekdays: WORKWEEK })
		});
	}
	if (lexicon.phrases?.length) {
		const phrases = words(
			lexicon.phrases.map(([forms, unit, n]) => [forms, { unit, every: n ?? 1 }])
		);
		patterns.push({
			regex: new RegExp(`${start}${phrases.pattern}${stop}`, flags),
			read: (match) => phrases.of.get(fold(match[0])) ?? null
		});
	}
	if (lexicon.dayPhrases?.length) {
		const dayPhrases = words(lexicon.dayPhrases.map((forms, day) => [forms, day]));
		patterns.push({
			regex: new RegExp(
				`${start}${dayPhrases.pattern}(?:${and}${dayPhrases.pattern})*${stop}`,
				flags
			),
			read: (match) => {
				const weekdays = [...match[0].matchAll(new RegExp(dayPhrases.pattern, 'giu'))]
					.map((day) => dayPhrases.of.get(fold(day[0])))
					.filter((day): day is number => day !== undefined);
				return { unit: 'week', every: 1, weekdays: [...new Set(weekdays)].sort((a, b) => a - b) };
			}
		});
	}
	if (lexicon.after?.length) {
		const after = words([[lexicon.after, true]]).pattern;
		patterns.push({
			regex: new RegExp(
				`${start}${count}${gap}${counter}(${units.pattern})${gap}${after}${stop}`,
				flags
			),
			read: (match) => {
				const unit = units.of.get(fold(match[2]));
				// "1日おき" skips a day: every other day.
				const skips = fold(match[0]).endsWith('おき');
				return unit ? { unit, every: toCount(match[1]) + (skips ? 1 : 0) } : null;
			}
		});
	}
	if (lexicon.partsOfDay?.length) {
		const parts = words([[lexicon.partsOfDay, true]]).pattern;
		// Only "every" is taken: the part of the day stays for the time.
		patterns.push({
			regex: new RegExp(`${start}${every}(?=${gap}${parts}${stop})`, flags),
			read: () => ({ unit: 'day', every: 1 })
		});
	}
	return patterns;
}

const compiled = new Map<ReminderLanguage, Pattern[]>();

/**
 * The repeat typed in `text`, and where. The longest wins, then the earliest.
 * A count of zero or one past the limit is no repeat.
 */
export function findRepeat(text: string, language: ReminderLanguage): FoundRepeat | null {
	let patterns = compiled.get(language);
	if (!patterns) {
		patterns = compile(WORDS[language]);
		compiled.set(language, patterns);
	}
	const { folded, from } = folding(text);
	let best: FoundRepeat | null = null;
	for (const pattern of patterns) {
		const match = pattern.regex.exec(folded);
		if (!match) continue;
		const repeat = pattern.read(match);
		if (!repeat || repeat.every < 1 || repeat.every > 999) continue;
		const found = { repeat, index: from[match.index], end: from[match.index + match[0].length] };
		const length = found.end - found.index;
		if (
			!best ||
			length > best.end - best.index ||
			(length === best.end - best.index && found.index < best.index)
		) {
			best = found;
		}
	}
	return best;
}
