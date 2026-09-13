/** Central visual contracts. Keep component styling in Panda and compose these classes in Svelte. */
import { css, cva, sva } from 'styled-system/css';

const truncateText = {
	overflow: 'hidden',
	textOverflow: 'ellipsis',
	whiteSpace: 'nowrap'
} as const;
const iconSm = { h: '1rem', w: '1rem' } as const;
const iconMd = { h: '1.25rem', w: '1.25rem' } as const;
const iconXs = { h: '0.875rem', w: '0.875rem' } as const;
const rowCenter = { display: 'flex', alignItems: 'center' } as const;
const flexCenter = { display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;
const gridCenter = { display: 'grid', placeItems: 'center' } as const;
const clickable = { cursor: 'pointer' } as const;
const interactive = { cursor: 'pointer', touchAction: 'manipulation' } as const;
const mutedText = { color: 'scrapscache.textMuted' } as const;
const textColor = { color: 'scrapscache.text' } as const;
const cardRadius = { rounded: 'card' } as const;
const controlRadius = { rounded: 'control' } as const;
const subtleHover = { _hoverable: { bg: 'scrapscache.interactiveHover' } } as const;
const mediaHover = {
	_hoverable: { bg: 'scrapscache.mediaControlHover', color: 'scrapscache.mediaText' }
} as const;
const border = { borderWidth: 'hairline', borderColor: 'scrapscache.border' } as const;

const iconSmClass = css(iconSm);
const iconMdClass = css(iconMd);

export const truncate = css(truncateText);

// Application layout primitives
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
	...border,
	bg: 'scrapscache.surface',
	...cardRadius,
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
		row: { mb: 'md', ...rowCenter, gap: 'md', px: 'sm' },
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
			compact: {
				track: { h: '0.25rem' },
				bar: { transition: 'width 1000ms linear' }
			}
		}
	}
});

// Attachment preview contracts
export const canvasPreview = sva({
	slots: ['strip', 'wrap', 'btn', 'img', 'loading', 'caption', 'delBtn'],
	base: {
		wrap: { position: 'relative', w: '9rem', flexShrink: 0 },
		btn: {
			position: 'relative',
			display: 'block',
			aspectRatio: '4/3',
			w: 'full',
			overflow: 'hidden',
			...cardRadius,
			borderWidth: 'hairline',
			borderColor: 'scrapscache.borderSubtle',
			bg: 'scrapscache.bg'
		},
		img: { h: 'full', w: 'full' },
		loading: { ...gridCenter, h: 'full', w: 'full', ...mutedText },
		caption: {
			position: 'absolute',
			insetX: 0,
			bottom: 0,
			bgGradient: 'to-t',
			gradientFrom: 'black/65',
			gradientTo: 'transparent',
			px: 'sm',
			pb: 'xs',
			pt: 'xl',
			textAlign: 'left',
			color: 'scrapscache.mediaText'
		},
		delBtn: {
			position: 'absolute',
			right: '2xs',
			top: '2xs',
			rounded: 'pill',
			bg: 'scrapscache.mediaSurfaceMuted',
			px: 'xs',
			py: '3xs',
			fontSize: 'label',
			color: 'scrapscache.mediaText',
			...interactive
		}
	},
	variants: {
		mode: {
			editor: {
				strip: {
					display: 'flex',
					alignItems: 'center',
					maxH: '11rem',
					gap: 'sm',
					overflowX: 'auto',
					px: 'md',
					pb: 'sm'
				},
				btn: { ...interactive },
				img: { objectFit: 'contain' },
				loading: { fontSize: 'label' },
				caption: { fontSize: 'caption', fontWeight: 'interactive' }
			},
			display: {
				strip: { mt: 'sm', display: 'grid', gap: 'xs' },
				img: { objectFit: 'cover' },
				loading: { fontSize: 'caption' },
				caption: { fontSize: 'micro', fontWeight: 'heading' }
			}
		}
	},
	defaultVariants: { mode: 'display' }
});

export const filePreview = sva({
	slots: ['list', 'row', 'badge', 'title', 'size', 'openBtn', 'removeBtn'],
	base: {
		list: { display: 'flex', flexDirection: 'column' },
		row: {
			...rowCenter,
			gap: 'sm',
			borderWidth: 'hairline',
			borderColor: 'scrapscache.borderSubtle',
			bg: 'scrapscache.surfaceSubtle',
			px: 'sm',
			py: 'xs'
		},
		badge: {
			...gridCenter,
			flexShrink: 0,
			bg: 'scrapscache.interactiveActive',
			fontWeight: 'strong',
			color: 'scrapscache.text'
		},
		title: { ...truncateText, ...textColor },
		size: { fontSize: 'micro', ...mutedText },
		openBtn: {
			minW: 0,
			flex: '1',
			textAlign: 'left',
			...interactive
		},
		removeBtn: {
			flexShrink: 0,
			rounded: 'pill',
			px: 'xs',
			py: '3xs',
			fontSize: 'label',
			...mutedText,
			...interactive,
			...subtleHover
		}
	},
	variants: {
		mode: {
			editor: {
				list: {
					maxH: '9rem',
					gap: 'xs',
					overflowY: 'auto',
					px: 'md',
					pb: 'sm',
					alignItems: 'stretch'
				},
				row: { rounded: 'card' },
				badge: {
					h: '2rem',
					w: '2rem',
					rounded: 'control',
					fontSize: 'micro',
					letterSpacing: 'wide'
				},
				title: { fontSize: 'body' }
			},
			display: {
				list: { mt: 'sm', gap: '2xs' },
				row: { w: 'full', rounded: 'control', textAlign: 'left' },
				badge: { h: '1.75rem', w: '1.75rem', rounded: 'compact', fontSize: 'tiny' },
				title: { minW: 0, flex: '1', fontSize: 'label' }
			}
		}
	},
	defaultVariants: { mode: 'display' }
});

export const photoPreview = sva({
	slots: ['strip', 'wrap', 'btn', 'img', 'skeleton', 'delBtn'],
	base: {
		strip: { display: 'flex', overflowX: 'auto' },
		wrap: { flexShrink: 0 },
		btn: { display: 'block', overflow: 'hidden', rounded: 'card' },
		img: { w: 'auto', objectFit: 'cover' },
		skeleton: {
			flexShrink: 0,
			animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
			rounded: 'card',
			bg: 'scrapscache.interactiveActive'
		},
		delBtn: {
			position: 'absolute',
			right: 'xs',
			top: 'xs',
			display: 'grid',
			h: '1.5rem',
			w: '1.5rem',
			placeItems: 'center',
			rounded: 'pill',
			bg: 'scrapscache.mediaSurfaceMuted',
			color: 'scrapscache.mediaText',
			touchAction: 'manipulation',
			cursor: 'pointer'
		}
	},
	variants: {
		mode: {
			editor: {
				strip: {
					alignItems: 'center',
					gap: 'sm',
					px: 'md',
					pb: 'sm'
				},
				wrap: { position: 'relative' },
				btn: { h: '8rem', touchAction: 'manipulation', cursor: 'pointer' },
				img: { h: '8rem', maxW: '15rem' },
				skeleton: { h: '8rem', w: '8rem' }
			},
			display: {
				strip: { mt: 'sm', gap: 'xs' },
				wrap: { display: 'block', overflow: 'hidden', rounded: 'control' },
				img: { h: '6rem', maxW: '10rem', rounded: 'card' },
				skeleton: { h: '6rem', w: '6rem' }
			}
		}
	},
	defaultVariants: { mode: 'display' }
});

// Fullscreen contracts
export const fullscreen = sva({
	slots: ['shell', 'header', 'title', 'notice'],
	variants: {
		theme: {
			photo: {
				shell: {
					position: 'absolute',
					inset: 0,
					zIndex: 80,
					display: 'flex',
					flexDirection: 'column',
					bg: 'scrapscache.mediaSurface',
					color: 'scrapscache.mediaText'
				},
				header: {
					position: 'absolute',
					insetX: 0,
					top: 0,
					zIndex: 20,
					display: 'flex',
					h: '3.5rem',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: 'md',
					bgGradient: 'to-b',
					gradientFrom: 'black/75',
					gradientTo: 'transparent',
					px: 'md',
					py: 'sm',
					backdropFilter: 'blur(2px)'
				},
				title: {
					minW: 0,
					flex: '1',
					...truncateText,
					fontSize: 'body',
					fontWeight: 'interactive',
					color: 'scrapscache.mediaTextStrong'
				},
				notice: {
					px: 'lg',
					pb: 'md',
					textAlign: 'center',
					fontSize: 'label',
					color: 'scrapscache.mediaDanger'
				}
			},
			attachment: {
				shell: {
					position: 'fixed',
					inset: 0,
					zIndex: 80,
					display: 'flex',
					flexDirection: 'column',
					bg: 'scrapscache.bg',
					color: 'scrapscache.text'
				},
				header: {
					display: 'flex',
					flexShrink: 0,
					alignItems: 'center',
					gap: 'md',
					borderBottomWidth: 'hairline',
					borderColor: 'scrapscache.border',
					px: 'md',
					py: 'sm'
				},
				title: { minW: 0, flex: '1', ...truncateText, fontSize: 'body', fontWeight: 'interactive' },
				notice: {
					display: 'grid',
					flex: '1',
					placeItems: 'center',
					p: '2xl',
					fontSize: 'body',
					color: 'scrapscache.textMuted'
				}
			}
		}
	},
	defaultVariants: { theme: 'attachment' }
});

// Kanban view contracts. One slot recipe keeps this view's complete visual API
// central while allowing the individual elements to share the same primitives.
export const kanbanViewStyles = sva({
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
		controls: { mb: 'lg', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'sm' },
		selectWrap: { position: 'relative', minW: 0, maxW: 'full' },
		select: {
			minW: 0,
			appearance: 'none',
			rounded: 'dialog',
			...border,
			bg: 'scrapscache.surface',
			py: 'sm',
			pl: 'md',
			pr: '3xl',
			textStyle: 'bodyStrong',
			...textColor,
			outline: 'none',
			...clickable
		},
		selectChevron: {
			pointerEvents: 'none',
			position: 'absolute',
			right: 'list',
			top: '50%',
			...iconXs,
			transform: 'translateY(-50%)',
			...mutedText
		},
		renameRow: { mb: 'lg', display: 'flex', maxW: '28rem', gap: 'sm' },
		columnsContainer: {
			display: 'block',
			mx: '-1rem',
			overflowX: 'auto',
			overscrollBehaviorX: 'contain',
			WebkitOverflowScrolling: 'touch',
			px: 'lg',
			pb: 'lg'
		},
		columnsTrack: { display: 'flex', minW: 'max-content', alignItems: 'flex-start', gap: 'md' },
		column: {
			w: 'min(calc(var(--note-card-width) + 1.5rem), calc(100vw - 2rem))',
			flexShrink: 0,
			rounded: 'sheet',
			bg: 'scrapscache.surfaceSubtle',
			p: 'md'
		},
		columnTarget: {
			boxShadow:
				'inset 0 0 0 2px color-mix(in srgb, token(colors.scrapscache.accent) 35%, transparent)'
		},
		colHeader: { mb: 'sm', display: 'flex', alignItems: 'center', gap: 'sm', px: '2xs', pt: '2xs' },
		colTitle: { minW: 0, flex: '1', ...truncateText, textStyle: 'bodyStrong', ...textColor },
		cardsList: { position: 'relative', display: 'flex', flexDirection: 'column', gap: 'md' },
		dropSlot: {
			...cardRadius,
			borderWidth: 'strong',
			borderStyle: 'dashed',
			borderColor: 'color-mix(in srgb, token(colors.scrapscache.accent) 45%, transparent)',
			bg: 'color-mix(in srgb, token(colors.scrapscache.accent) 8%, transparent)'
		},
		emptyDrop: {
			...cardRadius,
			borderWidth: 'hairline',
			borderStyle: 'dashed',
			borderColor: 'scrapscache.borderSubtle',
			px: 'md',
			py: 'xl',
			textAlign: 'center',
			textStyle: 'caption'
		},
		backlogGroup: {
			mb: 'sm',
			display: 'flex',
			flexDirection: 'column',
			gap: 'sm',
			...cardRadius,
			borderWidth: 'hairline',
			borderColor: 'scrapscache.borderSubtle',
			bg: 'scrapscache.surface',
			p: 'sm',
			fontSize: 'label'
		},
		filterIndent: {
			ml: '2xs',
			display: 'flex',
			flexDirection: 'column',
			gap: '2xs',
			borderLeftWidth: 'strong',
			borderColor: 'scrapscache.borderSubtle',
			pl: 'sm'
		},
		addColWrap: {
			position: 'relative',
			w: 'min(calc(var(--note-card-width) + 1.5rem), calc(100vw - 2rem))',
			flexShrink: 0,
			pt: '2xs'
		},
		radioOption: {
			display: 'flex',
			alignItems: 'flex-start',
			gap: 'sm',
			...cardRadius,
			px: '2xs',
			py: '2xs',
			...clickable,
			_hoverable: { bg: 'scrapscache.surfaceSubtle' }
		},
		checkRow: {
			display: 'flex',
			alignItems: 'center',
			gap: 'sm',
			...cardRadius,
			px: '2xs',
			py: '2xs',
			...clickable,
			_hoverable: { bg: 'scrapscache.surfaceSubtle' }
		},
		checkControl: {
			...flexCenter,
			...iconSm,
			rounded: 'compact',
			...border,
			'&[data-state=checked]': { borderColor: 'scrapscache.accent', bg: 'scrapscache.accent' }
		},
		checkMark: { fontSize: 'micro', color: 'scrapscache.accentForeground' },
		checkLabel: { ...textColor },
		filterSummary: { ...truncateText, px: '2xs', textStyle: 'micro' },
		menuItem: {
			display: 'block',
			w: 'full',
			...truncateText,
			px: 'md',
			py: 'sm',
			textAlign: 'left',
			textStyle: 'body',
			...textColor,
			...subtleHover
		},
		explain: { textStyle: 'caption' },
		radioInput: { mt: '3xs' },
		radioTitle: { textStyle: 'button', ...textColor },
		radioSubtitle: { mt: '3xs', display: 'block', textStyle: 'caption' },
		tagLabel: { ...truncateText, ...textColor },
		emptyTags: { px: '2xs', py: '2xs', ...mutedText },
		tagPickerPositioner: { zIndex: 20, w: 'var(--reference-width)' },
		tagPickerContent: { maxH: '16rem', overflowY: 'auto', py: '2xs' },
		dragGhost: {
			position: 'fixed',
			top: 0,
			left: 0,
			zIndex: 200,
			pointerEvents: 'none',
			willChange: 'transform'
		},
		dragGhostCard: {
			...cardRadius,
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
})();

export const backlogFilterButton = cva({
	base: { ...cardRadius },
	variants: {
		active: { true: { bg: 'scrapscache.accentSubtle', color: 'scrapscache.accentHover' } }
	}
});

// NoteCard contracts

export const noteCardHazeGroup = cva({
	base: {
		display: 'flex',
		alignItems: 'center',
		filter: 'drop-shadow(0 4px 3px rgb(0 0 0 / 0.07))'
	},
	variants: {
		layout: {
			compact: { justifyContent: 'center', gap: 'xs' },
			column: { flexDirection: 'column', gap: 'list' },
			row: { justifyContent: 'center', gap: 'list' }
		}
	}
});

export const noteCardSuccessIcon = css({ color: 'scrapscache.success' });

// ReminderNotificationSettings contracts

export const reminderSettingsRow = cva({
	base: {
		display: 'flex',
		h: '2rem',
		alignItems: 'center',
		gap: 'list',
		px: 'md'
	},
	variants: {
		interactive: {
			true: {
				w: 'full',
				textAlign: 'left',
				...clickable,
				...subtleHover
			}
		}
	}
});

export const reminderSettingsIcon = css({ ...iconSm, flexShrink: 0, ...textColor });

export const reminderSettingsLabel = css({ minW: 0, flex: '1', textStyle: 'button', ...textColor });

export const reminderSettingsStatus = css({
	flexShrink: 0,
	textStyle: 'captionStrong',
	...mutedText
});

export const reminderSettingsChevron = css({ ...iconSm, flexShrink: 0, ...mutedText });

// WorkspaceRow contracts
export const {
	row: workspaceRow,
	actions: workspaceActions,
	tile: workspaceTile,
	tileUnlink: workspaceTileUnlink,
	tileLabel: workspaceTileLabel,
	frontBase: workspaceFrontBase,
	select: workspaceSelect,
	panel: workspacePanel,
	glyph: workspaceGlyph,
	body: workspaceBody,
	nameText: workspaceNameText,
	captionText: workspaceCaptionText,
	nameField: workspaceNameField,
	panelActions: workspacePanelActions,
	iconButton: workspaceIconButton,
	confirmText: workspaceConfirmText,
	desktopCaption: workspaceDesktopCaption,
	mobileCaption: workspaceMobileCaption,
	successIconButton: workspaceSuccessIconButton
} = sva({
	slots: [
		'row',
		'actions',
		'tile',
		'tileUnlink',
		'tileLabel',
		'frontBase',
		'select',
		'panel',
		'glyph',
		'body',
		'nameText',
		'captionText',
		'nameField',
		'panelActions',
		'iconButton',
		'confirmText',
		'desktopCaption',
		'mobileCaption',
		'successIconButton'
	],
	base: {
		row: {
			position: 'relative',
			rounded: 'row',
			overflow: { base: 'hidden', sm: 'visible' },
			'& button:disabled': { opacity: 0.55 },
			'&:hover .actions, &:focus-within .actions': {
				opacity: { sm: 1 },
				pointerEvents: { sm: 'auto' }
			},
			'&.editing .actions': { display: 'none' },
			'&:not(.dragging) .front': {
				transition: {
					base: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
					_motionReduce: 'none'
				}
			},
			'&:not(.dragging):has(.actions :focus-visible) .front': {
				transform: { base: 'translateX(-152px)' }
			},
			'&.editing .front': { bg: 'scrapscache.interactiveHover' },
			'@media (hover: hover)': { '&:hover .front': { bg: 'scrapscache.interactiveHover' } },
			'&:not(.dragging) .actions': {
				transition: { base: 'width 260ms cubic-bezier(0.22, 1, 0.36, 1)' }
			},
			'&.armed .tile-unlink': {
				bg: { base: 'scrapscache.danger' },
				color: { base: 'scrapscache.dangerForeground' }
			},
			'&.armed .tile:not(.tile-unlink)': { opacity: { base: 0 } }
		},
		actions: {
			position: 'absolute',
			inset: '0 0 0 auto',
			zIndex: { base: 0, sm: 2 },
			display: 'flex',
			alignItems: 'center',
			gap: '3xs',
			pr: { base: 0, sm: 'sm' },
			w: { base: 'max(0px, calc(-1 * var(--swipe-offset)))', sm: 'auto' },
			justifyContent: { base: 'flex-end' },
			overflow: { base: 'hidden' },
			borderTopRightRadius: { base: 'row' },
			borderBottomRightRadius: { base: 'row' },
			opacity: { base: 1, sm: 0 },
			pointerEvents: { base: 'auto', sm: 'none' }
		},
		tile: {
			display: { base: 'flex', sm: 'grid' },
			w: { base: '76px', sm: '30px' },
			h: { base: 'auto', sm: '30px' },
			placeItems: 'center',
			flexDirection: { base: 'column' },
			alignItems: { base: 'center' },
			justifyContent: { base: 'center' },
			gap: { base: '2xs' },
			flexShrink: 0,
			alignSelf: { base: 'stretch' },
			rounded: { base: '0', sm: 'action' },
			fontSize: { base: 'label' },
			color: { base: 'scrapscache.text', sm: 'scrapscache.textMuted' },
			_hoverable: {
				bg: { base: 'transparent', sm: 'scrapscache.interactiveHover' },
				color: { sm: 'scrapscache.text' }
			},
			'& svg': { transform: { base: 'scale(calc(0.8 + 0.2 * var(--swipe-progress)))' } }
		},
		tileUnlink: {
			flex: { base: '1 0 76px' },
			color: { base: 'scrapscache.danger', sm: 'scrapscache.textMuted' },
			_hoverable: { color: { sm: 'scrapscache.danger' } }
		},
		tileLabel: { display: { base: 'block', sm: 'none' } },
		frontBase: {
			position: 'relative',
			zIndex: 1,
			display: 'flex',
			alignItems: 'stretch',
			rounded: 'row',
			bg: 'scrapscache.surface',
			transform: { base: 'translateX(var(--swipe-offset))' }
		},
		select: {
			display: 'flex',
			flex: '1',
			alignItems: 'center',
			gap: 'md',
			minW: 0,
			py: 'md',
			pl: 'md',
			pr: { base: 'md', sm: '76px' },
			textAlign: 'left',
			textStyle: 'body',
			touchAction: 'pan-y'
		},
		panel: {
			display: 'flex',
			flex: '1',
			alignItems: 'center',
			gap: 'md',
			minW: 0,
			p: 'md',
			textAlign: 'left',
			textStyle: 'body',
			'&.confirm': {
				bg: 'scrapscache.dangerSubtle',
				rounded: 'row',
				flexWrap: { base: 'wrap' },
				'& .panel-glyph': { color: 'scrapscache.danger' },
				'& .panel-actions': { w: { base: '100%' }, justifyContent: { base: 'flex-end' } }
			}
		},
		glyph: { ...gridCenter, flexShrink: 0, ...mutedText },
		body: { minW: 0, flex: '1' },
		nameText: { display: 'block', ...truncateText },
		captionText: { display: 'block', mt: '3xs', ...mutedText, textStyle: 'caption' },
		nameField: { w: 'full', font: 'inherit' },
		panelActions: { display: 'flex', alignItems: 'center', gap: 'xs', flexShrink: 0 },
		iconButton: {
			...gridCenter,
			w: '30px',
			h: '30px',
			rounded: 'action',
			...mutedText,
			...subtleHover
		},
		confirmText: { fontSize: 'compact' },
		desktopCaption: { display: { base: 'none', sm: 'inline' } },
		mobileCaption: { display: { base: 'inline', sm: 'none' } },
		successIconButton: { color: 'scrapscache.success' }
	}
})();

export const workspaceFrontActive = cva({
	variants: {
		active: {
			true: {
				bg: 'scrapscache.interactiveHover',
				'&::before': {
					content: '""',
					position: 'absolute',
					top: 'list',
					bottom: 'list',
					left: 0,
					w: '3px',
					borderTopRightRadius: 'marker',
					borderBottomRightRadius: 'marker',
					bg: 'scrapscache.accent'
				}
			}
		}
	}
});

export const workspacePanelBtn = cva({
	base: {
		py: 'action',
		px: 'md',
		rounded: 'action',
		fontSize: 'compact',
		whiteSpace: 'nowrap'
	},
	variants: {
		tone: {
			neutral: { _hoverable: { bg: 'scrapscache.interactiveHover' } },
			danger: {
				bg: 'scrapscache.danger',
				color: 'scrapscache.dangerForeground',
				fontWeight: 'interactive'
			}
		}
	}
});

// BodyEditor contracts

export const bodyEditorTaskShell = cva({
	variants: {
		focused: {
			true: { bg: 'scrapscache.surfaceSubtle' }
		},
		root: {
			true: { mt: '3xs', borderTopRadius: 'card', pt: '2xs' }
		},
		last: {
			true: { mb: '3xs', borderBottomRadius: 'card', pb: '2xs' }
		}
	}
});

export const bodyEditorAddSubtaskBtn = cva({
	base: {
		display: 'flex',
		flexBasis: 'full',
		userSelect: 'none',
		alignItems: 'center',
		rounded: 'compact',
		py: '2xs',
		textAlign: 'left',
		textStyle: 'label',
		color: 'scrapscache.textMuted',
		cursor: 'pointer',
		transition: 'colors 120ms ease',
		touchAction: 'manipulation',
		minH: { base: '32px', sm: 0 },
		_hoverable: {
			bg: 'scrapscache.interactiveHover',
			color: 'scrapscache.text'
		}
	},
	variants: {
		indented: {
			true: { pl: '2xs' },
			false: { pl: '2xl' }
		}
	},
	defaultVariants: { indented: false }
});

// Sidebar contracts

export const sidebarRow = cva({
	variants: {
		navigation: {
			true: { w: 'full', textAlign: 'left', textStyle: 'button', ...clickable }
		},
		active: {
			true: {
				fontWeight: 'heading',
				bg: 'scrapscache.navigationActive',
				color: 'scrapscache.navigationActiveText'
			},
			false: { fontWeight: 'interactive', color: 'scrapscache.textMuted' }
		},
		wide: { true: { pr: 'lg' } },
		editing: { true: { bg: 'scrapscache.interactiveHover' } }
	}
});

export const sidebarIcon = cva({
	base: {
		...gridCenter,
		h: '1.75rem',
		w: '1.75rem',
		flexShrink: 0
	},
	variants: {
		iconTone: {
			nav: { color: 'scrapscache.text' },
			muted: { color: 'scrapscache.textMuted' }
		},
		danger: {
			true: {
				_hoverable: { bg: 'scrapscache.dangerSubtle', color: 'scrapscache.danger' }
			}
		},
		hitPad: {
			delete: {
				position: 'relative',
				_before: { position: 'absolute', inset: '-0.5rem', content: '""' }
			},
			count: { fontSize: 'label', fontVariantNumeric: 'tabular-nums', opacity: 0.7 }
		}
	}
});

export const sidebarNavLabelText = css({ minW: 0, flex: '1', ...truncateText, textAlign: 'left' });

export const sidebarLabelInput = css({
	flex: '1',
	textStyle: 'button',
	_placeholder: { fontWeight: 'body', color: 'scrapscache.textMuted' }
});

// ReminderPicker contracts
export const reminderBadgeChip = cva({
	base: {
		minW: '4.25rem',
		flexShrink: 0,
		rounded: 'pill',
		px: 'sm',
		py: '3xs',
		fontWeight: 'strong',
		textTransform: 'uppercase',
		letterSpacing: 'status'
	},
	variants: {
		status: {
			active: { bg: 'scrapscache.success', color: 'scrapscache.successForeground' },
			edit: { bg: 'scrapscache.warning', color: 'scrapscache.bg' },
			new: { bg: 'scrapscache.accent', color: 'scrapscache.accentForeground' }
		}
	}
});

export const reminderStatusTone = cva({
	base: { borderWidth: 'hairline', borderColor: 'currentColor' },
	variants: {
		tone: {
			accent: { bg: 'scrapscache.accentSubtle', color: 'scrapscache.accent' },
			success: { bg: 'scrapscache.successSubtle', color: 'scrapscache.success' },
			warning: { bg: 'scrapscache.warningSubtle', color: 'scrapscache.warning' }
		}
	}
});

export const reminderDateBtn = cva({
	base: {
		mx: '2xs',
		...flexCenter,
		minW: 0,
		flex: '1',
		rounded: 'card',
		px: 'sm',
		py: 'xs',
		textStyle: 'button',
		...textColor,
		...clickable
	},
	variants: {
		active: {
			true: { bg: 'scrapscache.bg' }
		}
	}
});

export const reminderEllipsis = css({ minW: 0, ...truncateText });

export const reminderWheelDeck = css({
	rounded: 'dialog',
	bg: 'scrapscache.surfaceSubtle',
	px: 'sm',
	py: '2xs'
});

export const reminderTimeWheel = css({ w: '4rem' });

export const reminderColon = css({
	...flexCenter,
	w: '0.75rem',
	flexShrink: 0,
	textStyle: 'display',
	...textColor
});

// BackupPassphraseDialog contracts

export const backupEyebrow = css({
	fontSize: 'caption',
	fontWeight: 'heading',
	textTransform: 'uppercase',
	letterSpacing: 'code',
	...mutedText
});

export const backupDescription = css({ lineHeight: 'relaxed' });

export const backupForm = css({ gap: 'lg' });

export const backupLabel = css({ display: 'block' });

export const backupFieldLabel = css({
	display: 'block',
	mb: 'xs',
	textStyle: 'label',
	...mutedText
});

export const backupFooter = css({ gap: 'sm', pt: '2xs' });

// WheelPicker contracts

export const wheelBand = css({
	pointerEvents: 'none',
	position: 'absolute',
	insetX: 0,
	top: '50%',
	zIndex: 0,
	h: '2.25rem',
	transform: 'translateY(-50%)',
	...cardRadius,
	bg: 'scrapscache.bg'
});

export const wheelViewport = css({
	position: 'absolute',
	inset: 0,
	zIndex: 10,
	overflow: 'hidden',
	outline: 'none',
	touchAction: 'none',
	userSelect: 'none',
	WebkitUserSelect: 'none',
	WebkitMaskImage:
		'linear-gradient(to bottom, transparent 0%, #000 28%, #000 72%, transparent 100%)',
	maskImage: 'linear-gradient(to bottom, transparent 0%, #000 28%, #000 72%, transparent 100%)'
});

export const wheelTrack = css({ willChange: 'transform' });

export const wheelItem = cva({
	base: {
		...flexCenter,
		fontVariantNumeric: 'tabular-nums',
		...clickable
	},
	variants: {
		distance: {
			center: {
				textStyle: 'subtitleStrong',
				color: 'scrapscache.text'
			},
			adjacent: {
				textStyle: 'button',
				color: 'scrapscache.textMuted'
			},
			far: {
				fontSize: 'body',
				color: 'scrapscache.textMuted',
				opacity: 0.4
			}
		}
	},
	defaultVariants: {
		distance: 'far'
	}
});

// ColorPalette contracts

export const colorSwatch = cva({
	base: {
		w: '2.5rem',
		h: '2.5rem',
		rounded: 'pill',
		borderWidth: 'strong',
		borderColor: 'scrapscache.borderSubtle',
		transition: 'transform 150ms ease',
		...clickable,
		_motionReduce: {
			transition: 'none'
		},
		sm: {
			_hoverable: {
				transform: 'scale(1.1)'
			}
		}
	}
});

export const colorCheckmark = cva({
	base: {
		h: 'full',
		w: 'full',
		...flexCenter,
		fontSize: 'body',
		...mutedText
	}
});

// LabelMenu contracts

export const labelMenuIconBox = css({
	...gridCenter,
	h: '1.75rem',
	w: '1.75rem',
	flexShrink: 0,
	...mutedText,
	'&[data-state=checked]': { color: 'scrapscache.accent' }
});

export const labelMenuIcon = iconSmClass;

export const labelMenuLabel = css({ minW: 0, flex: '1', ...truncateText });

export const labelMenuCheckIndicator = css({ flexShrink: 0, color: 'scrapscache.accent' });

export const labelMenuHeading = css({
	minW: 0,
	flex: '1',
	fontSize: 'caption',
	fontWeight: 'heading',
	textTransform: 'uppercase',
	letterSpacing: 'eyebrow',
	...mutedText
});

export const labelMenuSearchWrap = css({ position: 'relative', mb: '2xs' });

export const labelMenuScroller = css({ scrollbarWidth: 'thin' });

export const labelMenuSearchIcon = css({
	pointerEvents: 'none',
	position: 'absolute',
	left: 'md',
	top: '50%',
	...iconSm,
	transform: 'translateY(-50%)',
	...mutedText
});

export const labelMenuSearchInput = css({
	w: 'full',
	pl: '2.25rem',
	_placeholder: { color: 'scrapscache.textMuted' }
});

export const labelMenuEmpty = css({
	px: 'md',
	py: 'lg',
	textAlign: 'center',
	textStyle: 'caption',
	...mutedText
});

// DatePickerViews contracts

export const datePickerPanel = css({
	minH: '16.25rem',
	display: 'flex',
	flexDirection: 'column',
	'& [data-part="view"]:not([hidden])': { display: 'flex', flexDirection: 'column' },
	'& .calendar-table-fill [data-part="table-body"]': { h: '100%' },
	'& .calendar-table-fill [data-part="table-row"]': { h: 'calc(13.5rem / 3)' },
	'& .calendar-table-fill [data-part="table-cell"]': { h: 'inherit', verticalAlign: 'middle' }
});

export const datePickerViewControl = css({
	mb: 'sm',
	display: 'flex',
	h: '2.25rem',
	alignItems: 'center',
	justifyContent: 'space-between'
});

export const datePickerViewButton = css({
	...cardRadius,
	px: 'sm',
	py: '2xs',
	textStyle: 'bodyStrong',
	...textColor,
	...clickable,
	transition: 'colors 150ms ease',
	...subtleHover
});

export const datePickerTable = css({ w: 'full', tableLayout: 'fixed', h: '13.5rem' });

export const datePickerWeekHeader = css({
	h: '1.5rem',
	textAlign: 'center',
	textStyle: 'captionStrong',
	...mutedText
});

export const datePickerWeekRow = css({ textAlign: 'center' });

export const datePickerDayCell = css({
	position: 'relative',
	'&:has([data-in-range])': {
		_before: {
			content: '""',
			position: 'absolute',
			top: '50%',
			left: 0,
			right: 0,
			h: '2rem',
			transform: 'translateY(-50%)',
			bg: 'scrapscache.accent/18'
		}
	},
	'&:has([data-range-start])': { _before: { left: '50%' } },
	'&:has([data-range-end])': { _before: { right: '50%' } }
});

export const datePickerGridBtn = cva({
	base: {
		position: 'relative',
		zIndex: 1,
		mx: 'auto',
		...flexCenter,
		textStyle: 'bodyStrong',
		...clickable,
		transition: 'colors 150ms ease',
		_hoverable: { bg: 'scrapscache.interactiveHover' },
		_selected: {
			bg: 'scrapscache.accent',
			color: 'scrapscache.accentForeground',
			fontWeight: 'heading'
		},
		'&[data-today]:not([data-selected])': {
			borderWidth: 'hairline',
			borderColor: 'scrapscache.textMuted'
		},
		_focusVisible: {
			outline: 'none',
			ringWidth: '2px',
			ringColor: 'scrapscache.accent'
		}
	},
	variants: {
		kind: {
			day: {
				position: 'relative',
				h: '2rem',
				w: '2rem',
				rounded: 'pill',
				'&[data-in-range]:not([data-range-start]):not([data-range-end])': {
					bg: 'transparent',
					color: 'scrapscache.text',
					fontWeight: 'body'
				},
				'&[data-focus]:not([data-selected]):not([data-in-range])': {
					bg: 'transparent !important'
				},
				'&[data-selected] .reminder-dot, &[data-range-start] .reminder-dot, &[data-range-end] .reminder-dot':
					{
						bg: 'scrapscache.accentForeground !important'
					},
				'&[data-outside-range]': {
					opacity: 0.3,
					pointerEvents: 'none'
				}
			},
			month: {
				h: '2.25rem',
				w: '3.5rem',
				rounded: 'card'
			}
		}
	}
});

// SyncModal contracts

export const syncWorkspaceRow = css({
	position: 'relative',
	display: 'flex',
	alignItems: 'center',
	gap: 'md',
	w: 'full',
	...controlRadius,
	p: 'md',
	textStyle: 'body',
	...subtleHover,
	_disabled: { opacity: 0.55 },
	'&.active': { bg: 'scrapscache.interactiveHover' },
	'&.active::before': {
		content: '""',
		position: 'absolute',
		top: 'list',
		bottom: 'list',
		left: 0,
		w: 'indicator',
		borderTopRightRadius: 'marker',
		borderBottomRightRadius: 'marker',
		bg: 'scrapscache.accent'
	}
});

export const syncManageRow = css({
	display: 'flex',
	alignItems: 'center',
	gap: 'md',
	w: 'full',
	...controlRadius,
	py: 'list',
	px: 'sm',
	textAlign: 'left',
	textStyle: 'body',
	...subtleHover,
	_disabled: { opacity: 0.55 },
	'& small': { display: 'block', mt: '3xs', textStyle: 'caption' }
});

export const syncDividerLine = css({ h: 'hairline', flex: '1', bg: 'scrapscache.border' });

export const syncPairingInput = css({
	w: 'full',
	...controlRadius,
	textAlign: 'center',
	fontSize: 'heading',
	fontWeight: 'strong',
	letterSpacing: 'status'
});

export const syncDigits = css({
	fontFamily: 'mono',
	fontSize: 'pairing',
	fontWeight: 'heading',
	letterSpacing: 'eyebrow',
	...textColor
});

export const syncQrCode = css({
	h: '220px',
	w: '220px',
	...cardRadius,
	bg: 'scrapscache.qrSurface',
	p: 'sm'
});

export const syncPairingCode = css({
	rounded: 'dialog',
	...border,
	bg: 'scrapscache.bg',
	px: 'sm',
	py: 'xl'
});

export const syncCopySuccess = css({
	borderColor: 'scrapscache.success',
	bg: 'scrapscache.success',
	color: 'scrapscache.successForeground'
});

export const syncTimerText = css({ fontVariantNumeric: 'tabular-nums', ...textColor });

export const syncFullButton = css({ w: 'full' });

export const syncGrowButton = css({ flex: '1' });

export const syncSpinner = css({ animation: 'spin' });

export const syncBodySpacing = css({ mt: '2xs' });

// ReminderLabel contracts

const overdueLabel = {
	bg: 'scrapscache.overdueStrong',
	fontWeight: 'interactive',
	color: 'scrapscache.mediaText'
} as const;
const inlineOverdueLabel = { fontWeight: 'interactive', color: 'scrapscache.overdue' } as const;

export const reminderRoot = cva({
	base: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '2xs',
		textStyle: 'caption'
	},
	variants: {
		variant: {
			strip: { w: 'full', borderTopRadius: 'lg', px: 'md', py: '2xs' },
			chip: { maxW: 'full', rounded: 'pill', px: 'list', py: '2xs' },
			inline: {}
		},
		overdue: {
			true: {}
		}
	},
	compoundVariants: [
		{
			variant: 'strip',
			overdue: false,
			css: { bg: 'scrapscache.surfaceSubtle', ...mutedText }
		},
		{ variant: 'strip', overdue: true, css: overdueLabel },
		{
			variant: 'chip',
			overdue: false,
			css: { bg: 'scrapscache.interactiveActive', ...mutedText }
		},
		{ variant: 'chip', overdue: true, css: overdueLabel },
		{ variant: 'inline', overdue: false, css: mutedText },
		{ variant: 'inline', overdue: true, css: inlineOverdueLabel }
	]
});

export const reminderIcon = css({ ...iconXs, flexShrink: 0 });

export const reminderText = truncate;

// NoteEditor contracts

export const noteEditorOverlay = css({ position: 'fixed', inset: 0, zIndex: 50 });

export const noteEditorSheetWrap = css({
	position: 'absolute',
	inset: 0,
	display: 'flex',
	alignItems: { base: 'flex-start', md: 'center' },
	justifyContent: 'center',
	px: 'lg',
	pb: 'var(--app-sheet-pad-bottom)'
});

export const noteEditorSheetBox = css({
	h: { base: 'full', md: '72%' },
	maxH: 'full',
	minH: 0,
	w: 'full',
	maxW: '2xl',
	rounded: 'sheet',
	boxShadow: 'noteSheet'
});

export const noteEditorDialogSurface = css({
	position: 'relative',
	display: 'flex',
	h: 'full',
	w: 'full',
	flexDirection: 'column',
	overflow: 'hidden',
	rounded: 'sheet'
});

export const noteEditorHeader = css({
	display: 'flex',
	flexShrink: 0,
	alignItems: 'center',
	gap: 'sm',
	borderBottomWidth: 'hairline',
	borderColor: 'scrapscache.borderFaint',
	px: 'sm',
	py: 'sm'
});

export const noteEditorScroller = css({
	minH: 0,
	flex: '1',
	touchAction: 'pan-y',
	overflowY: 'auto',
	overflowX: 'hidden',
	overscrollBehavior: 'contain',
	px: '2xl',
	pt: 'lg',
	pb: 'md'
});

export const noteEditorTitleStyles = css({
	mb: 'md',
	display: 'block',
	w: 'full',
	resize: 'none',
	overflow: 'hidden',
	wordBreak: 'break-word',
	p: 0,
	textStyle: 'editorTitle',
	_placeholder: mutedText,
	fieldSizing: 'content',
	transition: 'none'
});

export const noteEditorFileDropHint = css({
	pointerEvents: 'none',
	position: 'absolute',
	inset: 0,
	zIndex: 20,
	...gridCenter,
	rounded: 'sheet',
	borderWidth: 'strong',
	borderStyle: 'dashed',
	borderColor: 'scrapscache.accent',
	bg: 'scrapscache.accentSubtle'
});

export const noteEditorSubDialogBackdrop = css({
	bg: 'scrapscache.backdropSoft',
	backdropFilter: 'none',
	zIndex: 60
});

export const noteEditorPopupContent = css({ outline: 'none' });

export const noteEditorReminderButton = css({ minW: 0 });

export const noteEditorReminderTone = cva({
	variants: {
		tone: {
			overdue: { color: 'scrapscache.overdue' },
			active: { color: 'scrapscache.accent' }
		}
	}
});

// NoteEditorFooter contracts
export const noteEditorFooterIconMd = iconMdClass;

// PhotoFullscreen contracts
export const {
	cropRoot: photoCropRoot,
	cropCol: photoCropCol,
	cropHeader: photoCropHeader,
	cropSep: photoCropSep,
	cropRatioDesktop: photoCropRatioDesktop,
	cropRadioRoot: photoCropRadioRoot,
	cropRadioItem: photoCropRadioItem,
	cropReset: photoCropReset,
	cropSave: photoCropSave,
	cropRatioMobile: photoCropRatioMobile,
	cropViewport: photoCropViewport,
	cropImgWrap: photoCropImgWrap,
	cropImg: photoCropImg,
	cropTool: photoCropTool,
	viewerStage: photoViewerStage,
	viewerCenter: photoViewerCenter,
	viewerImage: photoViewerImage,
	viewerBackdrop: photoViewerBackdrop,
	viewerThumbStrip: photoViewerThumbStrip,
	viewerThumbImg: photoViewerThumbImg,
	viewerTitleSize: photoViewerTitleSize
} = sva({
	slots: [
		'cropRoot',
		'cropCol',
		'cropHeader',
		'cropSep',
		'cropRatioDesktop',
		'cropRadioRoot',
		'cropRadioItem',
		'cropReset',
		'cropSave',
		'cropRatioMobile',
		'cropViewport',
		'cropImgWrap',
		'cropImg',
		'cropTool',
		'viewerStage',
		'viewerCenter',
		'viewerImage',
		'viewerBackdrop',
		'viewerThumbStrip',
		'viewerThumbImg',
		'viewerTitleSize'
	],
	base: {
		cropRoot: {
			position: 'relative',
			zIndex: 1,
			display: 'flex',
			minH: 0,
			flex: '1',
			flexDirection: 'column',
			'& [data-part="viewport"]': {
				position: 'relative',
				overflow: 'visible',
				touchAction: 'none',
				userSelect: 'none'
			},
			'& [data-part="image"]': { position: 'absolute', maxWidth: 'none', userSelect: 'none' },
			'& [data-part="selection"]': {
				boxShadow: 'cropMask',
				outlineWidth: '1.5px',
				outlineStyle: 'solid',
				outlineColor: 'scrapscache.mediaOutline'
			},
			'& [data-part="handle"]': {
				...gridCenter,
				zIndex: 10,
				background: 'transparent',
				touchAction: 'none',
				userSelect: 'none',
				WebkitUserSelect: 'none',
				WebkitTapHighlightColor: 'transparent'
			},
			'& [data-part="handle"][data-position="nw"], & [data-part="handle"][data-position="ne"], & [data-part="handle"][data-position="se"], & [data-part="handle"][data-position="sw"]':
				{ w: '3.5rem', h: '3.5rem', zIndex: 20 },
			'& [data-part="handle"][data-position="n"], & [data-part="handle"][data-position="s"]': {
				h: '3.5rem',
				zIndex: 10
			},
			'& [data-part="handle"][data-position="w"], & [data-part="handle"][data-position="e"]': {
				w: '3.5rem',
				zIndex: 10
			},
			'& [data-part="handle"]:hover .crop-knob, & [data-part="handle"]:active .crop-knob': {
				transform: 'scale(1.35)',
				boxShadow: 'cropHandle'
			},
			'& [data-part="grid"][data-axis="horizontal"]': {
				borderBottomWidth: 'hairline',
				borderTopWidth: 'hairline',
				borderColor: 'scrapscache.mediaBorderStrong'
			},
			'& [data-part="grid"][data-axis="vertical"]': {
				borderLeftWidth: 'hairline',
				borderRightWidth: 'hairline',
				borderColor: 'scrapscache.mediaBorderStrong'
			}
		},
		cropCol: { display: 'flex', minH: 0, flex: '1', flexDirection: 'column' },
		cropHeader: {
			position: 'relative',
			display: 'flex',
			flexDirection: 'row',
			alignItems: 'center',
			flexShrink: 0,
			justifyContent: 'space-between',
			gap: 'sm',
			borderBottomWidth: 'hairline',
			borderColor: 'scrapscache.mediaBorder',
			bg: 'scrapscache.mediaSurfaceStrong',
			px: 'md',
			py: 'sm',
			backdropFilter: 'blur(12px)'
		},
		cropSep: {
			mx: { base: '3xs', sm: '2xs' },
			h: '1rem',
			w: '1px',
			bg: 'scrapscache.mediaControlActive'
		},
		cropRatioDesktop: {
			position: 'absolute',
			left: '50%',
			transform: 'translateX(-50%)',
			...flexCenter,
			display: { base: 'none', sm: 'flex' }
		},
		cropRadioRoot: {
			display: 'flex',
			flexDirection: 'row',
			alignItems: 'center',
			gap: '3xs',
			...cardRadius,
			bg: 'scrapscache.mediaControlHover',
			p: '3xs',
			fontSize: 'label'
		},
		cropRadioItem: {
			...clickable,
			rounded: 'compact',
			px: 'list',
			py: '2xs',
			transition: 'colors 120ms ease',
			'&[data-state=checked]': {
				bg: 'scrapscache.mediaText',
				fontWeight: 'heading',
				color: 'scrapscache.mediaSurface',
				boxShadow: 'sm'
			},
			'&[data-state=unchecked]': { color: 'scrapscache.mediaTextSoft', ...mediaHover },
			'&[data-disabled]': { pointerEvents: 'none', opacity: 0.5 }
		},
		cropReset: {
			...controlRadius,
			px: 'list',
			py: 'xs',
			textStyle: 'label',
			color: 'scrapscache.mediaTextMuted',
			transition: 'colors 120ms ease',
			...interactive,
			...mediaHover,
			_disabled: { opacity: 0.3, pointerEvents: 'none' }
		},
		cropSave: { minW: '5.25rem', px: 'md', py: 'xs', textStyle: 'button' },
		cropRatioMobile: {
			...flexCenter,
			display: { base: 'flex', sm: 'none' },
			gap: '2xs',
			flexShrink: 0,
			borderBottomWidth: 'hairline',
			borderColor: 'scrapscache.mediaBorderFaint',
			bg: 'scrapscache.mediaSurfaceMuted',
			px: 'md',
			py: 'xs'
		},
		cropViewport: {
			position: 'relative',
			...flexCenter,
			minH: 0,
			flex: '1',
			p: { base: 'sm', sm: '2xl' },
			overflow: 'hidden'
		},
		cropImgWrap: { position: 'relative', flexShrink: 0, overflow: 'visible', boxShadow: '2xl' },
		cropImg: {
			h: 'full',
			w: 'full',
			objectFit: 'fill',
			display: 'block',
			userSelect: 'none',
			pointerEvents: 'none'
		},
		cropTool: {
			h: '2.25rem',
			w: '2.25rem',
			...controlRadius,
			color: 'scrapscache.mediaTextSoft',
			transition: 'colors 120ms ease',
			...mediaHover,
			_disabled: {
				opacity: 0.35,
				cursor: 'not-allowed',
				pointerEvents: 'auto',
				_hoverable: { bg: 'transparent', color: 'scrapscache.mediaTextSoft' }
			}
		},
		viewerStage: { position: 'relative', minH: 0, flex: '1' },
		viewerCenter: {
			pointerEvents: 'none',
			position: 'relative',
			zIndex: 1,
			...flexCenter,
			h: 'full',
			px: 'lg'
		},
		viewerImage: {
			pointerEvents: 'auto',
			maxH: 'full',
			maxW: 'full',
			userSelect: 'none',
			objectFit: 'contain'
		},
		viewerBackdrop: { position: 'absolute', inset: 0, cursor: 'zoom-out' },
		viewerThumbStrip: {
			position: 'relative',
			zIndex: 1,
			display: 'flex',
			flexShrink: 0,
			gap: 'sm',
			overflowX: 'auto',
			bgGradient: 'to-t',
			gradientFrom: 'black/85',
			gradientTo: 'transparent',
			px: 'lg',
			pb: 'md',
			pt: 'sm'
		},
		viewerThumbImg: { h: 'full', w: 'full', objectFit: 'cover' },
		viewerTitleSize: { ml: '2xs', textStyle: 'caption', color: 'scrapscache.mediaTextFaint' }
	}
})();

export const photoCropKnob = cva({
	base: {
		bg: 'scrapscache.mediaText',
		boxShadow: 'cropKnob',
		pointerEvents: 'none',
		transition: 'transform 0.15s ease, box-shadow 0.15s ease'
	},
	variants: {
		shape: {
			corner: { h: '0.75rem', w: '0.75rem', rounded: 'knob' },
			edgeH: { h: '0.25rem', w: '1.5rem', rounded: 'pill' },
			edgeV: { h: '1.5rem', w: '0.25rem', rounded: 'pill' }
		}
	},
	defaultVariants: { shape: 'corner' }
});

export const photoRatioMobileBtn = cva({
	base: {
		rounded: 'compact',
		px: 'sm',
		py: '3xs',
		fontSize: 'label',
		transition: 'colors 120ms ease',
		cursor: 'pointer'
	},
	variants: {
		active: {
			true: {
				bg: 'scrapscache.mediaText',
				fontWeight: 'heading',
				color: 'scrapscache.mediaSurface'
			},
			false: {
				bg: 'transparent',
				color: 'scrapscache.mediaTextMuted',
				_hoverable: {
					bg: 'scrapscache.mediaControlHover',
					color: 'scrapscache.mediaText'
				}
			}
		}
	}
});

export const photoNavArrow = cva({
	base: {
		position: 'absolute',
		top: '50%',
		transform: 'translateY(-50%)',
		zIndex: 20,
		display: { base: 'none', sm: 'grid' },
		h: '2.75rem',
		w: '2.75rem',
		placeItems: 'center',
		rounded: 'pill',
		bg: 'scrapscache.mediaSurfaceSoft',
		color: 'scrapscache.mediaTextStrong',
		boxShadow: 'md',
		backdropFilter: 'blur(4px)',
		transition: 'colors 120ms ease',
		cursor: 'pointer',
		touchAction: 'manipulation',
		_hoverable: {
			bg: 'scrapscache.mediaSurfaceHover',
			color: 'scrapscache.mediaText'
		}
	},
	variants: {
		side: {
			left: { left: 'md' },
			right: { right: 'md' }
		}
	}
});

export const photoThumbBtn = cva({
	base: {
		h: '3.5rem',
		w: '3.5rem',
		flexShrink: 0,
		overflow: 'hidden',
		rounded: 'control',
		touchAction: 'manipulation',
		transition: 'opacity 120ms ease, box-shadow 120ms ease',
		cursor: 'pointer'
	},
	variants: {
		active: {
			true: { opacity: 1, ringWidth: '2px', ringColor: 'scrapscache.mediaText' },
			false: { opacity: 0.5, _hoverable: { opacity: 0.85 } }
		}
	}
});

// ReminderAlert contracts

export const reminderAlertRoot = css({
	pointerEvents: 'none',
	position: 'fixed',
	insetX: 0,
	zIndex: 70,
	display: 'flex',
	flexDirection: 'column',
	alignItems: 'center',
	gap: 'sm',
	px: 'md'
});

export const reminderAlertCard = css({
	pointerEvents: 'auto',
	display: 'flex',
	w: 'full',
	maxW: '28rem',
	alignItems: 'flex-start',
	gap: 'md',
	rounded: 'sheet',
	borderWidth: 'hairline',
	borderColor: 'scrapscache.border',
	bg: 'scrapscache.surface',
	px: 'md',
	py: 'md',
	boxShadow: '2xl'
});

export const reminderAlertIcon = css({
	mt: '3xs',
	...iconMd,
	flexShrink: 0,
	color: 'scrapscache.accent'
});

export const reminderAlertContent = css({
	minW: 0,
	flex: '1',
	textAlign: 'left',
	cursor: 'pointer'
});

export const reminderAlertTitle = css({
	...truncateText,
	textStyle: 'bodyStrong',
	color: 'scrapscache.text'
});

export const reminderAlertSubtitle = css({ textStyle: 'caption' });

export const reminderAlertDismissIcon = iconSmClass;

// EmptyState contracts
export const emptyStateAction = css({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	mt: 'md',
	rounded: 'pill',
	borderWidth: 'hairline',
	borderColor: 'scrapscache.border',
	px: 'md',
	py: 'xs',
	textStyle: 'button',
	color: 'scrapscache.text',
	cursor: 'pointer',
	transition: 'background-color 150ms ease',
	_hoverable: { bg: 'scrapscache.borderFaint' }
});

// Topbar contracts

export const topbarSearchInput = css({
	h: 'full',
	flex: '1',
	appearance: 'none',
	_placeholder: { color: 'scrapscache.textMuted' }
});

export const topbarSearchIcon = css({ color: 'scrapscache.textMuted' });

export const topbarSyncIcon = css({ display: 'block' });

export const topbarSyncTone = cva({
	variants: {
		status: {
			normal: {},
			warning: { color: 'scrapscache.warning' },
			danger: { color: 'scrapscache.danger' }
		}
	}
});

export const topbarIcon = cva({
	base: { flexShrink: 0 },
	variants: {
		size: {
			sm: iconSm,
			md: iconMd
		}
	}
});

export const topbarMenuPositioner = css({ zIndex: 30 });

export const topbarMenuPopover = css({ w: '16rem', overflow: 'hidden', pt: '2xs' });

export const topbarMenuSeparator = css({
	borderTopWidth: 'hairline',
	borderColor: 'scrapscache.border'
});

export const topbarMenuAlert = css({
	px: 'md',
	pb: 'sm',
	textStyle: 'label',
	color: 'scrapscache.danger'
});
