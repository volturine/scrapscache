import { cva, sva } from 'styled-system/css';

export const backlogFilterButton = cva({
	base: { rounded: 'lg' },
	variants: {
		active: {
			true: {
				bg: 'scrapscache.accentSubtle',
				color: 'scrapscache.accentHover'
			}
		}
	}
});

export const kanbanView = sva({
	slots: [
		'controls',
		'selectWrap',
		'select',
		'selectChevron',
		'renameRow',
		'columnsContainer',
		'columnsTrack',
		'column',
		'columnTarget',
		'colHeader',
		'colTitle',
		'cardsList',
		'dropSlot',
		'emptyDrop',
		'backlogGroup',
		'filterIndent',
		'addColWrap',
		'radioOption',
		'checkRow',
		'checkControl',
		'checkMark',
		'checkLabel',
		'filterSummary',
		'menuItem',
		'explain',
		'radioInput',
		'radioTitle',
		'radioSubtitle',
		'tagLabel',
		'emptyTags',
		'tagPickerPositioner',
		'tagPickerContent',
		'dragGhost',
		'dragGhostCard'
	],
	base: {
		controls: {
			mb: '1rem',
			display: 'flex',
			flexWrap: 'wrap',
			alignItems: 'center',
			gap: '0.5rem'
		},
		selectWrap: { position: 'relative', minW: 0, maxW: 'full' },
		select: {
			minW: 0,
			appearance: 'none',
			rounded: 'xl',
			borderWidth: '1px',
			borderColor: 'scrapscache.border',
			bg: 'scrapscache.surface',
			py: '0.5rem',
			pl: '0.75rem',
			pr: '2rem',
			fontSize: 'sm',
			fontWeight: '600',
			color: 'scrapscache.text',
			outline: 'none',
			cursor: 'pointer'
		},
		selectChevron: {
			pointerEvents: 'none',
			position: 'absolute',
			right: '0.625rem',
			top: '50%',
			h: '0.875rem',
			w: '0.875rem',
			transform: 'translateY(-50%)',
			color: 'scrapscache.textMuted'
		},
		renameRow: { mb: '1rem', display: 'flex', maxW: '28rem', gap: '0.5rem' },
		columnsContainer: {
			display: 'block',
			mx: '-1rem',
			overflowX: 'auto',
			overscrollBehaviorX: 'contain',
			WebkitOverflowScrolling: 'touch',
			px: '1rem',
			pb: '1rem'
		},
		columnsTrack: {
			display: 'flex',
			minW: 'max-content',
			alignItems: 'flex-start',
			gap: '0.75rem'
		},
		column: {
			w: 'min(calc(var(--note-card-width) + 1.5rem), calc(100vw - 2rem))',
			flexShrink: 0,
			rounded: '2xl',
			bg: 'scrapscache.surfaceSubtle',
			p: '0.75rem'
		},
		columnTarget: {
			boxShadow:
				'inset 0 0 0 2px color-mix(in srgb, token(colors.scrapscache.accent) 35%, transparent)'
		},
		colHeader: {
			mb: '0.5rem',
			display: 'flex',
			alignItems: 'center',
			gap: '0.5rem',
			px: '0.25rem',
			pt: '0.25rem'
		},
		colTitle: {
			minW: 0,
			flex: '1',
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			whiteSpace: 'nowrap',
			fontSize: 'sm',
			fontWeight: '600',
			color: 'scrapscache.text'
		},
		cardsList: { position: 'relative', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
		dropSlot: {
			rounded: 'lg',
			borderWidth: '2px',
			borderStyle: 'dashed',
			borderColor: 'color-mix(in srgb, token(colors.scrapscache.accent) 45%, transparent)',
			bg: 'color-mix(in srgb, token(colors.scrapscache.accent) 8%, transparent)'
		},
		emptyDrop: {
			rounded: 'xl',
			borderWidth: '1px',
			borderStyle: 'dashed',
			borderColor: 'scrapscache.borderSubtle',
			px: '0.75rem',
			py: '1.25rem',
			textAlign: 'center',
			fontSize: 'xs',
			color: 'scrapscache.textMuted'
		},
		backlogGroup: {
			mb: '0.5rem',
			display: 'flex',
			flexDirection: 'column',
			gap: '0.5rem',
			rounded: 'xl',
			borderWidth: '1px',
			borderColor: 'scrapscache.borderSubtle',
			bg: 'scrapscache.surface',
			p: '0.5rem',
			fontSize: 'xs'
		},
		filterIndent: {
			ml: '0.25rem',
			display: 'flex',
			flexDirection: 'column',
			gap: '0.25rem',
			borderLeftWidth: '2px',
			borderColor: 'scrapscache.borderSubtle',
			pl: '0.5rem'
		},
		addColWrap: {
			position: 'relative',
			w: 'min(calc(var(--note-card-width) + 1.5rem), calc(100vw - 2rem))',
			flexShrink: 0,
			pt: '0.25rem'
		},
		radioOption: {
			display: 'flex',
			cursor: 'pointer',
			alignItems: 'flex-start',
			gap: '0.5rem',
			rounded: 'lg',
			px: '0.25rem',
			py: '0.25rem',
			_hoverable: { bg: 'scrapscache.surfaceSubtle' }
		},
		checkRow: {
			display: 'flex',
			cursor: 'pointer',
			alignItems: 'center',
			gap: '0.5rem',
			rounded: 'lg',
			px: '0.25rem',
			py: '0.25rem',
			_hoverable: { bg: 'scrapscache.surfaceSubtle' }
		},
		checkControl: {
			display: 'flex',
			h: '1rem',
			w: '1rem',
			alignItems: 'center',
			justifyContent: 'center',
			rounded: 'sm',
			borderWidth: '1px',
			borderColor: 'scrapscache.border',
			'&[data-state=checked]': {
				borderColor: 'scrapscache.accent',
				bg: 'scrapscache.accent'
			}
		},
		checkMark: { fontSize: '10px', color: 'scrapscache.accentForeground' },
		checkLabel: { color: 'scrapscache.text' },
		filterSummary: {
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			whiteSpace: 'nowrap',
			px: '0.25rem',
			fontSize: '10px',
			color: 'scrapscache.textMuted'
		},
		menuItem: {
			display: 'block',
			w: 'full',
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			whiteSpace: 'nowrap',
			px: '0.75rem',
			py: '0.5rem',
			textAlign: 'left',
			fontSize: 'sm',
			color: 'scrapscache.text',
			_hoverable: { bg: 'scrapscache.interactiveHover' }
		},
		explain: { fontSize: '11px', lineHeight: 'snug', color: 'scrapscache.textMuted' },
		radioInput: { mt: '0.125rem' },
		radioTitle: { fontWeight: 'medium', color: 'scrapscache.text' },
		radioSubtitle: { mt: '0.125rem', display: 'block', color: 'scrapscache.textMuted' },
		tagLabel: {
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			whiteSpace: 'nowrap',
			color: 'scrapscache.text'
		},
		emptyTags: { px: '0.25rem', py: '0.25rem', color: 'scrapscache.textMuted' },
		tagPickerPositioner: { zIndex: 20, w: 'var(--reference-width)' },
		tagPickerContent: { maxH: '16rem', overflowY: 'auto', py: '0.25rem' },
		dragGhost: {
			position: 'fixed',
			top: 0,
			left: 0,
			zIndex: 200,
			pointerEvents: 'none',
			willChange: 'transform'
		},
		dragGhostCard: {
			rounded: 'lg',
			transform: 'scale(1) rotate(0deg)',
			boxShadow: 'kanbanDrag',
			transition: 'transform 160ms cubic-bezier(0.2, 0.8, 0.3, 1.1), box-shadow 160ms ease',
			'&[data-lifted=true]': {
				transform: 'scale(1.04) rotate(-1.5deg)',
				boxShadow: 'kanbanDragLifted'
			},
			_motionReduce: { transition: 'none' }
		}
	}
});
