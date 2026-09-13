type TokenValue<T> = { value: T };

const tokenGroup = <T extends Record<string, unknown>>(values: T) =>
	Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }])) as {
		[K in keyof T]: TokenValue<T[K]>;
	};

const mode = <T>(base: T, dark: T) => ({ base, _dark: dark });

const palette = tokenGroup({
	background: '#ffffff',
	backgroundDark: '#1a1a1a',
	surface: '#f8f9fa',
	surfaceDark: '#242424',
	accent: '#2563eb',
	accentDark: '#60a5fa',
	accentHover: '#1d4ed8',
	accentHoverDark: '#93c5fd',
	accentForeground: '#ffffff',
	accentForegroundDark: '#172554'
});

const textStyles = tokenGroup({
	body: { fontSize: 'body', fontWeight: 'body', lineHeight: 'body' },
	bodyStrong: { fontSize: 'body', fontWeight: 'heading', lineHeight: 'body' },
	subtitle: { fontSize: 'subtitle', fontWeight: 'interactive', lineHeight: 'body' },
	subtitleStrong: { fontSize: 'subtitle', fontWeight: 'heading', lineHeight: 'tight' },
	bodyMuted: {
		fontSize: 'body',
		fontWeight: 'body',
		lineHeight: 'body',
		color: 'scrapscache.textMuted'
	},
	label: { fontSize: 'label', fontWeight: 'interactive', lineHeight: 'compact' },
	caption: {
		fontSize: 'caption',
		fontWeight: 'body',
		lineHeight: 'caption',
		color: 'scrapscache.textMuted'
	},
	captionStrong: {
		fontSize: 'caption',
		fontWeight: 'interactive',
		lineHeight: 'caption',
		color: 'scrapscache.textMuted'
	},
	title: { fontSize: 'title', fontWeight: 'heading', lineHeight: 'tight' },
	heading: { fontSize: 'heading', fontWeight: 'heading', lineHeight: 'tight' },
	display: { fontSize: 'display', fontWeight: 'heading', lineHeight: 'tight' },
	editorTitle: { fontSize: 'display', fontWeight: 'interactive', lineHeight: 'tight' },
	overline: {
		fontSize: 'label',
		fontWeight: 'heading',
		lineHeight: 'compact',
		letterSpacing: 'wide',
		textTransform: 'uppercase',
		color: 'scrapscache.textMuted'
	},
	button: { fontSize: 'body', fontWeight: 'interactive', lineHeight: 'tight' },
	micro: { fontSize: 'micro', fontWeight: 'heading', lineHeight: 'compact' }
});

const scrapscacheColors = tokenGroup({
	bg: mode('{colors.palette.background}', '{colors.palette.backgroundDark}'),
	surface: mode('{colors.palette.surface}', '{colors.palette.surfaceDark}'),
	text: mode('#202124', '#e8eaed'),
	textMuted: mode('#5f6368', '#9aa0a6'),
	border: mode('#e0e0e0', '#3c4043'),
	borderFaint: mode('rgba(0, 0, 0, 0.05)', 'rgba(255, 255, 255, 0.1)'),
	borderSubtle: mode('rgba(0, 0, 0, 0.1)', 'rgba(255, 255, 255, 0.1)'),
	checklistBorder: mode('rgba(0, 0, 0, 0.4)', 'rgba(255, 255, 255, 0.4)'),
	tooltipBg: mode('rgba(23, 23, 23, 0.9)', 'rgba(245, 245, 245, 0.9)'),
	tooltipText: mode('#ffffff', '#171717'),
	backdropSoft: 'rgba(0, 0, 0, 0.3)',
	backdropMuted: 'rgba(0, 0, 0, 0.4)',
	backdropOverlay: 'rgba(0, 0, 0, 0.45)',
	backdrop: 'rgba(0, 0, 0, 0.5)',
	mediaSurface: '#000000',
	mediaSurfaceStrong: 'rgba(0, 0, 0, 0.85)',
	mediaSurfaceHover: 'rgba(0, 0, 0, 0.7)',
	mediaSurfaceMuted: 'rgba(0, 0, 0, 0.6)',
	mediaSurfaceSoft: 'rgba(0, 0, 0, 0.4)',
	mediaText: '#ffffff',
	mediaTextStrong: 'rgba(255, 255, 255, 0.9)',
	mediaOutline: 'rgba(255, 255, 255, 0.95)',
	mediaTextMuted: 'rgba(255, 255, 255, 0.7)',
	mediaTextSoft: 'rgba(255, 255, 255, 0.8)',
	mediaTextFaint: 'rgba(255, 255, 255, 0.6)',
	mediaBorder: 'rgba(255, 255, 255, 0.1)',
	mediaBorderStrong: 'rgba(255, 255, 255, 0.4)',
	mediaBorderFaint: 'rgba(255, 255, 255, 0.05)',
	mediaControlHover: 'rgba(255, 255, 255, 0.1)',
	mediaControlActive: 'rgba(255, 255, 255, 0.2)',
	mediaSuccess: '#34d399',
	mediaWarning: '#fcd34d',
	mediaAccent: '#93c5fd',
	mediaDanger: '#f87171',
	mediaDangerSubtle: 'rgba(244, 63, 94, 0.3)',
	qrSurface: '#ffffff',
	documentSurface: '#ffffff',
	pinnedBorder: 'rgba(251, 191, 36, 0.4)',
	pinnedRing: 'rgba(251, 191, 36, 0.5)',
	controlSubtle: mode('rgba(0, 0, 0, 0.06)', 'rgba(255, 255, 255, 0.1)'),
	controlSubtleHover: mode('rgba(0, 0, 0, 0.1)', 'rgba(255, 255, 255, 0.15)'),
	surfaceSubtle: mode('rgba(0, 0, 0, 0.035)', 'rgba(255, 255, 255, 0.055)'),
	canvasSurface: mode('#ffffff', '#121212'),
	overdue: mode('#be123c', '#fb7185'),
	overdueStrong: mode('#e11d48', '#f43f5e'),
	accent: mode('{colors.palette.accent}', '{colors.palette.accentDark}'),
	accentHover: mode('{colors.palette.accentHover}', '{colors.palette.accentHoverDark}'),
	accentForeground: mode(
		'{colors.palette.accentForeground}',
		'{colors.palette.accentForegroundDark}'
	),
	accentSubtle: mode(
		'color-mix(in srgb, {colors.palette.accent} 14%, {colors.palette.surface})',
		'color-mix(in srgb, {colors.palette.accentDark} 14%, {colors.palette.surfaceDark})'
	),
	focus: mode('{colors.palette.accentHover}', '{colors.palette.accentHoverDark}'),
	success: mode('#15803d', '#4ade80'),
	successForeground: mode('#ffffff', '#052e16'),
	successSubtle: mode('#dcfce7', '#14351f'),
	warning: mode('#b45309', '#fbbf24'),
	warningSubtle: mode('#fef3c7', '#3d2e0b'),
	danger: mode('#dc2626', '#f87171'),
	dangerHover: mode('#b91c1c', '#ef4444'),
	dangerForeground: mode('#ffffff', '#450a0a'),
	dangerSubtle: mode('#fee2e2', '#3b1717'),
	interactiveHover: mode('rgba(0, 0, 0, 0.05)', 'rgba(255, 255, 255, 0.08)'),
	interactiveActive: mode('rgba(0, 0, 0, 0.1)', 'rgba(255, 255, 255, 0.12)'),
	navigationActive: mode('#fef9c3', 'rgba(202, 138, 4, 0.15)'),
	navigationActiveText: mode('#1a1a1a', '#fde68a')
});

const noteColors = tokenGroup({
	default: mode('#ffffff', '#1f1f1f'),
	red: mode('#f28b82', '#5a3636'),
	orange: mode('#f6aea0', '#5a4a3f'),
	yellow: mode('#f7d875', '#5a5240'),
	green: mode('#b3e2a1', '#3a4a3a'),
	teal: mode('#98e9d9', '#2f4a4a'),
	blue: mode('#a9d5f4', '#2f3a4f'),
	darkblue: mode('#9bb8f3', '#2d3850'),
	purple: mode('#c6b3f2', '#3d3756'),
	pink: mode('#f9c2d8', '#4f3e4e'),
	brown: mode('#d6c5b0', '#4f4a44'),
	gray: mode('#f0f0f0', '#3c3c3c')
});

const shadows = tokenGroup({
	popover: mode('0 8px 24px rgba(0, 0, 0, 0.14)', '0 8px 24px rgba(0, 0, 0, 0.35)'),
	dialog: mode('0 20px 48px rgba(0, 0, 0, 0.24)', '0 20px 48px rgba(0, 0, 0, 0.55)'),
	noteSheet: mode('0 0 24px 2px rgba(0, 0, 0, 0.22)', '0 0 24px 2px rgba(0, 0, 0, 0.55)'),
	kanbanDrag: '0 1px 2px rgba(0, 0, 0, 0.12)',
	kanbanDragLifted: '0 18px 40px -12px rgba(0, 0, 0, 0.45), 0 6px 14px -6px rgba(0, 0, 0, 0.3)',
	cropMask: '0 0 0 9999px rgba(0, 0, 0, 0.65)',
	cropHandle: '0 2px 6px rgba(0, 0, 0, 0.7), 0 0 0 1.5px rgba(0, 0, 0, 0.35)',
	cropKnob: '0 1px 3px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 0, 0, 0.25)'
});

export const theme = {
	extend: {
		keyframes: {
			cardIn: {
				from: { opacity: 0, transform: 'translateY(8px)' },
				to: { opacity: 1, transform: 'none' }
			}
		},
		tokens: {
			colors: { palette },
			fonts: tokenGroup({
				sans: ['"Google Sans"', '"Roboto"', 'system-ui', 'Arial', 'sans-serif']
			}),
			borderWidths: tokenGroup({ hairline: '1px', control: '1.5px', strong: '2px' }),
			fontSizes: tokenGroup({
				body: '0.875rem',
				subtitle: '1rem',
				label: '0.75rem',
				caption: '0.6875rem',
				tiny: '0.5625rem',
				compact: '0.8125rem',
				micro: '0.625rem',
				title: '0.9375rem',
				heading: '1.125rem',
				display: '1.25rem',
				pairing: '1.35rem'
			}),
			fontWeights: tokenGroup({ body: '400', interactive: '500', heading: '600', strong: '700' }),
			lineHeights: tokenGroup({ body: '1.5', caption: '1rem', compact: '1.375' }),
			radii: tokenGroup({
				compact: '0.375rem',
				control: '0.5rem',
				card: '0.75rem',
				dialog: '1rem',
				sheet: '1.5rem',
				row: '0.625rem',
				action: '0.4375rem',
				checkbox: '0.25rem',
				knob: '2px',
				marker: '3px',
				pill: '9999px'
			}),
			spacing: tokenGroup({
				'3xs': '0.125rem',
				'2xs': '0.25rem',
				xs: '0.375rem',
				sm: '0.5rem',
				md: '0.75rem',
				lg: '1rem',
				xl: '1.25rem',
				'2xl': '1.5rem',
				'3xl': '2rem',
				'4xl': '2.5rem',
				list: '0.625rem',
				action: '0.4375rem'
			}),
			sizes: tokenGroup({ indicator: '3px' }),
			letterSpacings: tokenGroup({ eyebrow: '0.14em', status: '0.05em', code: '0.16em' }),
			animations: tokenGroup({ cardIn: 'cardIn 180ms ease-out backwards' })
		},
		textStyles,
		semanticTokens: {
			colors: { scrapscache: scrapscacheColors, note: noteColors },
			shadows
		}
	}
};
