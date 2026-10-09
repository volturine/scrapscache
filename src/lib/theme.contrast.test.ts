import { describe, expect, it } from 'vitest';
import { recipes } from '../../panda/recipes';
import { noteColors, onNoteColors, palette, scrapscacheColors } from '../../panda/theme';

type Mode = 'base' | '_dark';
type ModeValue = string | { base: string; _dark: string };

const MODES: Mode[] = ['base', '_dark'];

/** A token's value in one theme, with `{colors.palette.*}` references resolved. */
function resolve(value: ModeValue, mode: Mode): string {
	const raw = typeof value === 'string' ? value : value[mode];
	const reference = /^\{colors\.palette\.(\w+)\}$/.exec(raw);
	if (!reference) return raw;
	return palette[reference[1] as keyof typeof palette].value;
}

function rgba(color: string): [number, number, number, number] {
	const hex = /^#([0-9a-f]{6})$/i.exec(color);
	if (hex) {
		const n = parseInt(hex[1], 16);
		return [n >> 16, (n >> 8) & 255, n & 255, 1];
	}
	const fn = /^rgba?\(([^)]+)\)$/.exec(color);
	if (!fn) throw new Error(`unsupported colour ${color}`);
	const [r, g, b, a = '1'] = fn[1].split(',').map((part) => part.trim());
	return [Number(r), Number(g), Number(b), Number(a)];
}

/** Composite a possibly translucent colour over an opaque one. */
function over(top: string, bottom: string): [number, number, number] {
	const [r, g, b, a] = rgba(top);
	const [br, bg, bb] = rgba(bottom);
	return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}

function luminance([r, g, b]: [number, number, number]): number {
	const channel = (value: number) => {
		const c = value / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
	const surface = over(background, '#000000');
	const a = luminance(over(foreground, `rgb(${surface.join(',')})`));
	const b = luminance(surface);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The foregrounds a note of this colour renders with, as the noteSurface recipe scopes them. */
function noteForegrounds(color: keyof typeof noteColors, mode: Mode) {
	const app = (name: keyof typeof scrapscacheColors) =>
		resolve(scrapscacheColors[name].value, mode);
	const own = (name: keyof typeof onNoteColors) => resolve(onNoteColors[name].value, mode);
	const coloured = color !== 'default';
	return {
		text: app('text'),
		muted: coloured ? own('muted') : app('textMuted'),
		badgeText: coloured ? own('badgeText') : app('badgeText'),
		overdue: coloured ? own('overdue') : app('overdue'),
		accent: coloured ? own('accent') : app('accent'),
		focus: coloured ? own('focus') : app('focus')
	};
}

const notes = Object.keys(noteColors) as (keyof typeof noteColors)[];

describe('note surface contrast', () => {
	for (const mode of MODES) {
		for (const color of notes) {
			it(`${color} note (${mode === 'base' ? 'light' : 'dark'}) keeps WCAG AA`, () => {
				const background = resolve(noteColors[color].value, mode);
				const fg = noteForegrounds(color, mode);
				const badge = over(resolve(scrapscacheColors.badgeBg.value, mode), background);
				const ratios = {
					text: contrast(fg.text, background),
					muted: contrast(fg.muted, background),
					overdue: contrast(fg.overdue, background),
					accent: contrast(fg.accent, background),
					badgeText: contrast(fg.badgeText, `rgb(${badge.join(',')})`),
					focus: contrast(fg.focus, background)
				};
				for (const [token, ratio] of Object.entries(ratios)) {
					expect(ratio, `${token} on ${color}`).toBeGreaterThanOrEqual(token === 'focus' ? 3 : 4.5);
				}
			});
		}
	}

	it('re-points the app foregrounds on every coloured note', () => {
		const variants = recipes.noteSurface.variants!.color as Record<string, Record<string, string>>;
		for (const color of notes.filter((name) => name !== 'default')) {
			expect(variants[color]).toMatchObject({
				'--colors-scrapscache-text-muted': 'token(colors.onNote.muted)',
				'--colors-scrapscache-badge-text': 'token(colors.onNote.badgeText)',
				'--colors-scrapscache-overdue': 'token(colors.onNote.overdue)',
				'--colors-scrapscache-accent': 'token(colors.onNote.accent)',
				'--colors-scrapscache-focus': 'token(colors.onNote.focus)'
			});
		}
	});
});
