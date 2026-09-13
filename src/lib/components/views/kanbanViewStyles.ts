import { css, cva } from 'styled-system/css';

export const backlogFilterButton = cva({
	base: { rounded: 'card' },
	variants: {
		active: {
			true: {
				bg: 'scrapscache.accentSubtle',
				color: 'scrapscache.accentHover'
			}
		}
	}
});

// Kanban is the only consumer of these structural classes, so keep them as
// plain Panda classes instead of creating another slot recipe.
export const kanbanViewStyles = {
	controls: css({
		mb: 'lg',
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'center',
		gap: 'sm'
	}),
	selectWrap: css({ position: 'relative', minW: 0, maxW: 'full' }),
	select: css({
		minW: 0,
		appearance: 'none',
		rounded: 'dialog',
		borderWidth: 'hairline',
		borderColor: 'scrapscache.border',
		bg: 'scrapscache.surface',
		py: 'sm',
		pl: 'md',
		pr: '3xl',
		textStyle: 'bodyStrong',
		color: 'scrapscache.text',
		outline: 'none',
		cursor: 'pointer'
	}),
	selectChevron: css({
		pointerEvents: 'none',
		position: 'absolute',
		right: 'list',
		top: '50%',
		h: '0.875rem',
		w: '0.875rem',
		transform: 'translateY(-50%)',
		color: 'scrapscache.textMuted'
	}),
	renameRow: css({ mb: 'lg', display: 'flex', maxW: '28rem', gap: 'sm' }),
	columnsContainer: css({
		display: 'block',
		mx: '-1rem',
		overflowX: 'auto',
		overscrollBehaviorX: 'contain',
		WebkitOverflowScrolling: 'touch',
		px: 'lg',
		pb: 'lg'
	}),
	columnsTrack: css({
		display: 'flex',
		minW: 'max-content',
		alignItems: 'flex-start',
		gap: 'md'
	}),
	column: css({
		w: 'min(calc(var(--note-card-width) + 1.5rem), calc(100vw - 2rem))',
		flexShrink: 0,
		rounded: 'sheet',
		bg: 'scrapscache.surfaceSubtle',
		p: 'md'
	}),
	columnTarget: css({
		boxShadow:
			'inset 0 0 0 2px color-mix(in srgb, token(colors.scrapscache.accent) 35%, transparent)'
	}),
	colHeader: css({
		mb: 'sm',
		display: 'flex',
		alignItems: 'center',
		gap: 'sm',
		px: '2xs',
		pt: '2xs'
	}),
	colTitle: css({
		minW: 0,
		flex: '1',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		textStyle: 'bodyStrong',
		color: 'scrapscache.text'
	}),
	cardsList: css({ position: 'relative', display: 'flex', flexDirection: 'column', gap: 'md' }),
	dropSlot: css({
		rounded: 'card',
		borderWidth: 'strong',
		borderStyle: 'dashed',
		borderColor: 'color-mix(in srgb, token(colors.scrapscache.accent) 45%, transparent)',
		bg: 'color-mix(in srgb, token(colors.scrapscache.accent) 8%, transparent)'
	}),
	emptyDrop: css({
		rounded: 'card',
		borderWidth: 'hairline',
		borderStyle: 'dashed',
		borderColor: 'scrapscache.borderSubtle',
		px: 'md',
		py: 'xl',
		textAlign: 'center',
		textStyle: 'caption'
	}),
	backlogGroup: css({
		mb: 'sm',
		display: 'flex',
		flexDirection: 'column',
		gap: 'sm',
		rounded: 'card',
		borderWidth: 'hairline',
		borderColor: 'scrapscache.borderSubtle',
		bg: 'scrapscache.surface',
		p: 'sm',
		fontSize: 'label'
	}),
	filterIndent: css({
		ml: '2xs',
		display: 'flex',
		flexDirection: 'column',
		gap: '2xs',
		borderLeftWidth: 'strong',
		borderColor: 'scrapscache.borderSubtle',
		pl: 'sm'
	}),
	addColWrap: css({
		position: 'relative',
		w: 'min(calc(var(--note-card-width) + 1.5rem), calc(100vw - 2rem))',
		flexShrink: 0,
		pt: '2xs'
	}),
	radioOption: css({
		display: 'flex',
		cursor: 'pointer',
		alignItems: 'flex-start',
		gap: 'sm',
		rounded: 'card',
		px: '2xs',
		py: '2xs',
		_hoverable: { bg: 'scrapscache.surfaceSubtle' }
	}),
	checkRow: css({
		display: 'flex',
		cursor: 'pointer',
		alignItems: 'center',
		gap: 'sm',
		rounded: 'card',
		px: '2xs',
		py: '2xs',
		_hoverable: { bg: 'scrapscache.surfaceSubtle' }
	}),
	checkControl: css({
		display: 'flex',
		h: '1rem',
		w: '1rem',
		alignItems: 'center',
		justifyContent: 'center',
		rounded: 'compact',
		borderWidth: 'hairline',
		borderColor: 'scrapscache.border',
		'&[data-state=checked]': {
			borderColor: 'scrapscache.accent',
			bg: 'scrapscache.accent'
		}
	}),
	checkMark: css({ fontSize: 'micro', color: 'scrapscache.accentForeground' }),
	checkLabel: css({ color: 'scrapscache.text' }),
	filterSummary: css({
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		px: '2xs',
		textStyle: 'micro'
	}),
	menuItem: css({
		display: 'block',
		w: 'full',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		px: 'md',
		py: 'sm',
		textAlign: 'left',
		textStyle: 'body',
		color: 'scrapscache.text',
		_hoverable: { bg: 'scrapscache.interactiveHover' }
	}),
	explain: css({ textStyle: 'caption' }),
	radioInput: css({ mt: '3xs' }),
	radioTitle: css({ textStyle: 'button', color: 'scrapscache.text' }),
	radioSubtitle: css({ mt: '3xs', display: 'block', textStyle: 'caption' }),
	tagLabel: css({
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		color: 'scrapscache.text'
	}),
	emptyTags: css({ px: '2xs', py: '2xs', color: 'scrapscache.textMuted' }),
	tagPickerPositioner: css({ zIndex: 20, w: 'var(--reference-width)' }),
	tagPickerContent: css({ maxH: '16rem', overflowY: 'auto', py: '2xs' }),
	dragGhost: css({
		position: 'fixed',
		top: 0,
		left: 0,
		zIndex: 200,
		pointerEvents: 'none',
		willChange: 'transform'
	}),
	dragGhostCard: css({
		rounded: 'card',
		transform: 'scale(1) rotate(0deg)',
		boxShadow: 'kanbanDrag',
		transition: 'transform 160ms cubic-bezier(0.2, 0.8, 0.3, 1.1), box-shadow 160ms ease',
		'&[data-lifted=true]': {
			transform: 'scale(1.04) rotate(-1.5deg)',
			boxShadow: 'kanbanDragLifted'
		},
		_motionReduce: { transition: 'none' }
	})
};
