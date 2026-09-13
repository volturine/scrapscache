import { css, sva } from 'styled-system/css';

/** Shared page and feed layout classes. These are layout primitives, not component recipes. */
export const viewPage = css({ pt: 'lg', pb: '3xl' });

const notesShellBase = css({
	w: 'full',
	mx: 'auto',
	px: 0,
	boxSizing: 'border-box'
});
const notesListShell = css({ maxW: '720px' });

export function notesShell(layout: 'grid' | 'list' = 'grid'): string {
	return layout === 'list' ? `${notesShellBase} ${notesListShell}` : notesShellBase;
}

export const popover = css({
	borderWidth: 'hairline',
	borderColor: 'scrapscache.border',
	bg: 'scrapscache.surface',
	rounded: 'card',
	boxShadow: 'popover'
});

export const tooltip = css({
	pointerEvents: 'none',
	zIndex: 120,
	rounded: 'control',
	bg: 'scrapscache.tooltipBg',
	color: 'scrapscache.tooltipText',
	px: 'sm',
	py: '2xs',
	textStyle: 'captionStrong',
	boxShadow: 'md',
	backdropFilter: 'blur(4px)',
	transition: 'opacity 150ms ease'
});

export const sectionHeader = sva({
	slots: ['row', 'label', 'count', 'spacer'],
	base: {
		row: { mb: 'md', display: 'flex', alignItems: 'center', gap: 'md', px: 'sm' },
		label: { textStyle: 'overline' },
		count: { textStyle: 'caption', opacity: 0.6 },
		spacer: { flex: '1' }
	}
});

/** Shared two-slot meter used by the sync progress indicators. */
export const progressMeter = sva({
	slots: ['track', 'bar'],
	base: {
		track: {
			h: '0.375rem',
			overflow: 'hidden',
			rounded: 'pill',
			bg: 'scrapscache.interactiveActive'
		},
		bar: { h: 'full', bg: 'scrapscache.accent', transition: 'width 150ms ease' }
	},
	variants: {
		size: {
			default: {},
			compact: {
				track: { h: '0.25rem' },
				bar: { transition: 'width 1000ms linear' }
			}
		}
	},
	defaultVariants: { size: 'default' }
});
