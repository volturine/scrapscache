import { defineRecipe, defineSlotRecipe } from '@pandacss/dev';

const textRecipe = defineRecipe({
	className: 'scrapscache-text',
	variants: {
		style: {
			bodyMuted: { textStyle: 'bodyMuted' },
			caption: { textStyle: 'caption' },
			captionStrong: { textStyle: 'captionStrong' },
			heading: { textStyle: 'heading' }
		},
		tone: {
			danger: { color: 'scrapscache.danger' }
		}
	}
});

const mediaHazeButton = (color: string) => ({
	color,
	_hoverable: {
		bg: 'scrapscache.mediaControlActive',
		transform: 'scale(1.05)'
	}
});

const buttonFill = (bg: string, color: string, hover: string) => ({
	bg,
	color,
	borderWidth: 'hairline',
	borderColor: 'transparent',
	_hoverable: { bg: hover }
});

const square = (value: string) => ({ w: value, h: value });
const gestureTarget = {
	cursor: 'pointer',
	touchAction: 'manipulation',
	WebkitTapHighlightColor: 'transparent'
} as const;
const tapTarget = {
	...gestureTarget,
	userSelect: 'none'
} as const;
const rowCenter = { display: 'flex', alignItems: 'center' } as const;
const gridCenter = { display: 'grid', placeItems: 'center' } as const;
const column = { display: 'flex', flexDirection: 'column' } as const;
const cardRadius = { rounded: 'card' } as const;
const swipeAction = {
	position: 'absolute',
	inset: 0,
	...rowCenter,
	...cardRadius
} as const;
const menuItemComfortable = {
	gap: 'md',
	rounded: 'dialog',
	py: 'list',
	textStyle: 'button'
} as const;
const quietButton = { rounded: 'dialog' } as const;
const outlinedTransparentButton = { borderWidth: 'hairline' } as const;
const buttonQuiet = (color: string, hover: string, hoverColor = 'scrapscache.text') => ({
	...quietButton,
	color,
	_hoverable: { bg: hover, color: hoverColor }
});

const menuItemRecipe = defineRecipe({
	className: 'scrapscache-menu-item',
	base: {
		...rowCenter,
		w: 'full',
		textAlign: 'left',
		...gestureTarget,
		outline: 'none',
		transition: 'background-color 120ms ease, color 120ms ease',
		_hoverable: { bg: 'scrapscache.interactiveHover' },
		_active: { bg: 'scrapscache.interactiveActive' },
		_focusVisible: { bg: 'scrapscache.interactiveHover' },
		_disabled: { opacity: 0.55, cursor: 'not-allowed' }
	},
	variants: {
		density: {
			compact: { h: '2rem', gap: 'sm', px: 'md', fontSize: 'body' },
			comfortable: {
				...menuItemComfortable,
				px: 'md'
			},
			sidebar: {
				...menuItemComfortable,
				pl: 'lg',
				pr: 'sm'
			}
		},
		feedback: {
			none: {
				_hoverable: { bg: 'transparent' },
				_active: { bg: 'transparent' },
				_focusVisible: { bg: 'transparent' }
			}
		}
	},
	defaultVariants: { density: 'compact' }
});

const buttonRecipe = defineRecipe({
	className: 'scrapscache-btn',
	base: {
		...rowCenter,
		justifyContent: 'center',
		textStyle: 'button',
		rounded: 'control',
		...tapTarget,
		transition:
			'background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease, transform 120ms ease',
		_focusVisible: {
			outline: '2px solid',
			outlineColor: 'scrapscache.focus',
			outlineOffset: '2px'
		},
		_disabled: {
			opacity: 0.5,
			cursor: 'not-allowed',
			pointerEvents: 'none'
		}
	},
	variants: {
		variant: {
			primary: buttonFill(
				'scrapscache.accent',
				'scrapscache.accentForeground',
				'scrapscache.accentHover'
			),
			secondary: {
				...outlinedTransparentButton,
				bg: 'scrapscache.bg',
				color: 'scrapscache.text',
				borderColor: 'scrapscache.border',
				_hoverable: {
					bg: 'scrapscache.interactiveHover'
				}
			},
			quiet: {
				...outlinedTransparentButton,
				color: 'scrapscache.textMuted',
				borderColor: 'transparent',
				_hoverable: { bg: 'scrapscache.interactiveHover', color: 'scrapscache.text' }
			},
			subtle: {
				bg: 'scrapscache.controlSubtle',
				color: 'scrapscache.text',
				rounded: 'dialog',
				_hoverable: {
					bg: 'scrapscache.controlSubtleHover'
				}
			},
			ghost: buttonQuiet('scrapscache.textMuted', 'scrapscache.interactiveHover'),
			danger: buttonQuiet('scrapscache.danger', 'scrapscache.dangerSubtle', 'scrapscache.danger'),
			destructive: buttonFill(
				'scrapscache.danger',
				'scrapscache.dangerForeground',
				'scrapscache.dangerHover'
			),
			dashed: {
				...outlinedTransparentButton,
				borderStyle: 'dashed',
				borderColor: 'scrapscache.border',
				color: 'scrapscache.textMuted',
				rounded: 'control',
				_hoverable: {
					bg: 'scrapscache.surfaceSubtle',
					color: 'scrapscache.text'
				}
			}
		},
		size: {
			xs: {
				h: '1.75rem',
				px: 'xs',
				fontSize: 'label',
				gap: '2xs'
			},
			sm: {
				h: '2rem',
				px: 'md',
				gap: 'xs'
			},
			md: {
				h: '2.25rem',
				px: 'lg',
				gap: 'sm'
			}
		}
	},
	defaultVariants: {
		variant: 'secondary',
		size: 'md'
	}
});

const iconButtonRecipe = defineRecipe({
	className: 'scrapscache-icon-btn',
	base: {
		...rowCenter,
		justifyContent: 'center',
		rounded: 'pill',
		...tapTarget,
		transition:
			'background-color 150ms ease, color 150ms ease, opacity 150ms ease, transform 150ms ease',
		_focusVisible: {
			outline: '2px solid',
			outlineColor: 'scrapscache.focus',
			outlineOffset: '2px'
		},
		_active: {
			transform: 'scale(0.95)'
		}
	},
	variants: {
		variant: {
			haze: mediaHazeButton('scrapscache.mediaTextStrong'),
			hazeCopied: mediaHazeButton('scrapscache.mediaSuccess'),
			hazePinned: mediaHazeButton('scrapscache.mediaWarning'),
			hazeBlue: mediaHazeButton('scrapscache.mediaAccent'),
			hazeRose: {
				color: 'scrapscache.mediaTextStrong',
				_hoverable: {
					bg: 'scrapscache.mediaDangerSubtle',
					color: 'scrapscache.mediaDanger'
				}
			},
			ghost: {
				color: 'scrapscache.textMuted',
				_hoverable: { bg: 'scrapscache.interactiveHover', color: 'scrapscache.text' }
			},
			danger: {
				color: 'scrapscache.textMuted',
				_hoverable: {
					bg: 'scrapscache.dangerSubtle',
					color: 'scrapscache.danger'
				}
			}
		},
		size: {
			xs: square('1.75rem'),
			compact: square('2rem'),
			sm: square('2.25rem'),
			standard: square('2.5rem'),
			lg: square('3rem')
		}
	},
	defaultVariants: {
		variant: 'ghost',
		size: 'standard'
	}
});

const inputRecipe = defineRecipe({
	className: 'scrapscache-input',
	base: {
		minW: 0,
		caretColor: 'scrapscache.focus',
		outline: 'none',
		transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
		_disabled: { opacity: 0.55 },
		'&[aria-invalid="true"]': { borderColor: 'scrapscache.danger' }
	},
	variants: {
		variant: {
			outline: {
				rounded: 'control',
				borderWidth: 'hairline',
				borderColor: 'scrapscache.border',
				bg: 'scrapscache.bg',
				_focus: { ringWidth: '2px', ringColor: 'scrapscache.focus' }
			},
			unstyled: {
				px: 0,
				py: 0
			}
		},
		size: {
			sm: { px: 'md', py: 'xs', fontSize: 'label' },
			md: { px: 'md', py: 'sm' }
		}
	},
	defaultVariants: {
		variant: 'outline',
		size: 'md'
	}
});

const badgeRecipe = defineRecipe({
	className: 'scrapscache-badge',
	base: {
		...rowCenter,
		justifyContent: 'center',
		userSelect: 'none',
		fontWeight: 'interactive',
		lineHeight: '1'
	},
	variants: {
		variant: {
			subtle: {
				bg: 'scrapscache.interactiveHover',
				color: 'scrapscache.textMuted'
			}
		},
		size: {
			sm: { rounded: 'compact', px: 'xs', py: '3xs', fontSize: 'micro' }
		}
	},
	defaultVariants: {
		variant: 'subtle',
		size: 'sm'
	}
});

const noteSurfaceRecipe = defineRecipe({
	className: 'scrapscache-note-surface',
	variants: {
		color: {
			default: { bg: 'note.default' },
			red: { bg: 'note.red' },
			orange: { bg: 'note.orange' },
			yellow: { bg: 'note.yellow' },
			green: { bg: 'note.green' },
			teal: { bg: 'note.teal' },
			blue: { bg: 'note.blue' },
			darkblue: { bg: 'note.darkblue' },
			purple: { bg: 'note.purple' },
			pink: { bg: 'note.pink' },
			brown: { bg: 'note.brown' },
			gray: { bg: 'note.gray' }
		}
	}
});

const noteCardRecipe = defineSlotRecipe({
	className: 'scrapscache-card',
	slots: [
		'cardOuter',
		'swipeRestore',
		'swipeTrash',
		'cardBody',
		'contentPad',
		'title',
		'labelsRow',
		'metaRow',
		'hazeOverlay',
		'shield'
	],
	base: {
		cardOuter: {
			position: 'relative',
			overflow: 'hidden',
			...cardRadius
		},
		swipeRestore: {
			...swipeAction,
			justifyContent: 'flex-end',
			bg: 'scrapscache.success',
			pr: 'lg',
			color: 'scrapscache.successForeground'
		},
		swipeTrash: {
			...swipeAction,
			justifyContent: 'flex-start',
			bg: 'scrapscache.danger',
			pl: 'lg',
			color: 'scrapscache.dangerForeground'
		},
		cardBody: {
			position: 'relative',
			zIndex: 1,
			...column,
			w: 'full',
			maxH: '320px',
			cursor: 'pointer',
			overflow: 'hidden',
			...cardRadius,
			borderWidth: 'hairline',
			borderColor: 'scrapscache.borderFaint',
			boxShadow: 'sm',
			transition: 'box-shadow 150ms ease',
			_hoverable: {
				boxShadow: 'md'
			}
		},
		contentPad: {
			display: 'block',
			w: 'full',
			p: 'md',
			pb: 'sm',
			textAlign: 'left'
		},
		title: {
			mb: '2xs',
			wordBreak: 'break-word',
			textStyle: 'title',
			letterSpacing: 'tight'
		},
		labelsRow: {
			display: 'flex',
			flexShrink: 0,
			flexWrap: 'nowrap',
			gap: '2xs',
			px: 'md',
			pb: 'md',
			pt: 'sm',
			overflowX: 'auto',
			overflowY: 'hidden',
			// pan-x alone would forbid Android from scrolling the gallery from here.
			touchAction: 'pan-x pan-y',
			overscrollBehaviorX: 'contain',
			'& > *': { flexShrink: 0 }
		},
		metaRow: {
			// Phone gallery has no useful hover; only desktop shows the stamp.
			display: { base: 'none', md: 'block' },
			flexShrink: 0,
			px: 'md',
			pb: 0,
			pt: 0,
			maxHeight: 0,
			textStyle: 'caption',
			color: 'scrapscache.textMuted',
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			whiteSpace: 'nowrap',
			opacity: 0,
			transition: 'max-height 150ms ease, padding 150ms ease, opacity 150ms ease',
			_groupHover: {
				maxHeight: '2.5rem',
				pb: 'md',
				pt: '2xs',
				opacity: 1
			}
		},
		hazeOverlay: {
			position: 'absolute',
			inset: 0,
			zIndex: 20,
			...column,
			alignItems: 'center',
			justifyContent: 'center',
			bg: 'scrapscache.backdropMuted',
			backdropFilter: 'blur(8px)',
			transition: 'opacity 200ms ease, background-color 200ms ease'
		},
		shield: {
			position: 'absolute',
			inset: 0
		}
	},
	variants: {
		pinned: {
			true: {
				cardBody: {
					boxShadow: 'md'
				}
			}
		}
	}
});

const checklistRecipe = defineSlotRecipe({
	className: 'scrapscache-checklist',
	slots: ['root', 'mark'],
	base: {
		root: {
			position: 'relative',
			display: 'inline-grid',
			placeItems: 'center',
			...square('1.125rem'),
			mt: '0.2rem',
			borderWidth: 'control',
			borderColor: 'scrapscache.checklistBorder',
			rounded: 'checkbox',
			lineHeight: 0,
			appearance: 'none',
			touchAction: 'manipulation',
			WebkitTapHighlightColor: 'transparent',
			'&::before': {
				content: '""',
				position: 'absolute',
				inset: '-0.4375rem'
			}
		},
		mark: {
			...square('0.7rem'),
			display: 'block',
			fill: 'none',
			stroke: 'currentColor',
			strokeWidth: '2.25',
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			transform: 'translateY(0.5px)'
		}
	},
	variants: {
		indented: {
			true: {
				root: { ...square('0.9375rem'), mt: '0.22rem' },
				mark: square('0.55rem')
			}
		},
		checked: {
			true: { root: { bg: 'scrapscache.interactiveActive' } }
		}
	}
});

const noteBodyRecipe = defineSlotRecipe({
	className: 'scrapscache-note-body',
	slots: [
		'container',
		'chunk',
		'row',
		'line',
		'check',
		'bullet',
		'paragraph',
		'spacer',
		'addSubtask'
	],
	base: {
		row: {
			display: 'flex',
			alignItems: 'flex-start',
			gap: 'sm',
			py: '3xs'
		},
		line: { minW: 0, flex: '1', wordBreak: 'break-word' },
		check: { flexShrink: 0 },
		bullet: { flexShrink: 0, userSelect: 'none' },
		paragraph: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', py: '3xs' },
		spacer: { py: '2xs' },
		// The button takes its own line under the group, but only its label adds a
		// sub-task; the rest of the line puts the caret back on the group.
		addSubtask: {
			display: 'flex',
			flexBasis: 'full',
			textAlign: 'left',
			textStyle: 'label',
			color: 'scrapscache.textMuted',
			...tapTarget,
			cursor: 'text',
			whiteSpace: 'nowrap',
			'& > span': {
				rounded: 'compact',
				px: '2xs',
				py: '2xs',
				cursor: 'pointer',
				transitionProperty: 'background-color, color',
				transitionDuration: '120ms',
				transitionTimingFunction: 'ease',
				_hoverable: { bg: 'scrapscache.interactiveHover', color: 'scrapscache.text' }
			},
			// Child only. This slot styles the button, so a button ::before paints a second label.
			'& > span::before': { content: '"+  Add sub-task"' }
		}
	},
	variants: {
		mode: {
			editor: {
				container: { display: 'block', w: 'full', minW: 0, lineHeight: 'relaxed', outline: 'none' },
				// iOS WebKit walks the rendered text after the caret on every keystroke.
				// Skipping offscreen chunks keeps typing cost independent of note length.
				// The inline padding keeps focused rows' bleed outside the paint clip.
				chunk: { display: 'block', contentVisibility: 'auto', mx: '-sm', px: 'sm' },
				// Only Add sub-task wraps; it sits right under its task, not a gap away.
				row: { flexWrap: 'wrap', rowGap: 0 },
				line: {
					display: 'block',
					whiteSpace: 'pre-wrap',
					outline: 'none',
					'&[data-placeholder]:empty::before': {
						content: 'attr(data-placeholder)',
						color: 'scrapscache.textMuted',
						pointerEvents: 'none'
					}
				}
			}
		},
		checked: {
			true: { line: { textDecoration: 'line-through', opacity: 0.5 } }
		},
		indented: {
			true: { line: { fontSize: 'compact' }, addSubtask: { pl: 0 } },
			false: { addSubtask: { pl: 'xl' } }
		},
		focused: {
			true: { row: { bg: 'scrapscache.surfaceSubtle' } }
		},
		root: {
			true: { row: { mt: '3xs', borderTopRadius: 'card', pt: '2xs' } }
		},
		last: {
			true: { row: { mb: '3xs', borderBottomRadius: 'card', pb: '2xs' } }
		}
	}
});

const choiceCardRecipe = defineSlotRecipe({
	className: 'scrapscache-choice-card',
	slots: ['root', 'icon', 'body', 'title', 'description', 'badge', 'arrow', 'footer'],
	base: {
		root: {
			w: 'full',
			minH: '5rem',
			px: 'md',
			py: 'md',
			textAlign: 'left'
		},
		icon: {
			...gridCenter,
			w: '2.25rem',
			h: '2.25rem',
			flexShrink: 0,
			rounded: 'control',
			bg: 'scrapscache.accentSubtle',
			color: 'scrapscache.accent'
		},
		body: { minW: 0, flex: '1' },
		title: { display: 'block', textStyle: 'bodyStrong', color: 'scrapscache.text' },
		description: {
			display: 'block',
			mt: '2xs',
			textStyle: 'caption'
		},
		badge: {
			rounded: 'pill',
			bg: 'scrapscache.accentSubtle',
			color: 'scrapscache.accent',
			px: 'xs',
			py: '3xs',
			textStyle: 'captionStrong'
		},
		arrow: {
			flexShrink: 0,
			color: 'scrapscache.textMuted',
			transition: 'transform 120ms ease, color 120ms ease'
		},
		footer: { pt: '2xs' }
	},
	variants: {
		interactive: {
			true: {
				root: {
					display: 'flex',
					alignItems: 'center',
					gap: 'md',
					rounded: 'control',
					borderWidth: 'hairline',
					borderColor: 'scrapscache.border',
					cursor: 'pointer',
					transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
					_hoverable: {
						bg: 'scrapscache.interactiveHover',
						borderColor: 'scrapscache.accent',
						'& .scrapscache-choice-card__arrow': {
							transform: 'translateX(2px)',
							color: 'scrapscache.text'
						}
					},
					_disabled: { opacity: 0.55, cursor: 'not-allowed' }
				}
			}
		},
		danger: {
			true: {
				title: { color: 'scrapscache.danger' },
				icon: { bg: 'scrapscache.dangerSubtle', color: 'scrapscache.danger' },
				arrow: { color: 'scrapscache.danger' },
				root: { _hoverable: { borderColor: 'scrapscache.danger' } }
			}
		},
		compact: { true: { root: { minH: '0', px: 'lg', py: 'md' } } },
		kind: { compressed: { description: { opacity: 0.85 } } }
	}
});

const dialogRecipe = defineSlotRecipe({
	className: 'scrapscache-dialog-recipe',
	slots: [
		'portal',
		'backdrop',
		'positioner',
		'panel',
		'header',
		'title',
		'description',
		'body',
		'footer',
		'error'
	],
	base: {
		backdrop: {
			position: 'fixed',
			inset: 0,
			bg: 'scrapscache.backdrop',
			backdropFilter: 'blur(4px)',
			zIndex: 100,
			...rowCenter,
			justifyContent: 'center',
			p: 'lg'
		},
		panel: {
			position: 'relative',
			w: 'full',
			maxW: '28rem',
			bg: 'scrapscache.surface',
			color: 'scrapscache.text',
			borderWidth: 'hairline',
			borderColor: 'scrapscache.border',
			rounded: 'dialog',
			boxShadow: 'dialog',
			p: '2xl',
			...column,
			gap: 'lg',
			zIndex: 101
		},
		header: {
			...column,
			gap: '2xs'
		},
		title: {
			textStyle: 'heading'
		},
		description: {
			textStyle: 'bodyMuted'
		},
		body: {
			...column,
			gap: 'md'
		},
		footer: {
			...rowCenter,
			justifyContent: 'flex-end',
			flexWrap: 'wrap',
			gap: 'md',
			pt: 'sm'
		},
		error: { color: 'scrapscache.danger' }
	},
	variants: {
		size: {
			sm: { panel: { maxW: '20rem' } }
		},
		presentation: {
			appOverlay: {
				portal: {
					position: 'absolute',
					inset: 0,
					zIndex: 70
				},
				backdrop: {
					position: 'absolute',
					bg: 'scrapscache.backdropOverlay',
					backdropFilter: 'none'
				},
				positioner: {
					position: 'absolute',
					inset: 0,
					display: 'flex',
					alignItems: 'flex-start',
					justifyContent: 'center',
					px: 'lg',
					pb: 'lg',
					pt: 'calc(var(--app-topbar-height) + var(--spacing-sm))'
				},
				panel: { maxW: '24rem', p: 0, gap: 0 },
				header: {
					borderBottomWidth: 'hairline',
					borderColor: 'scrapscache.border',
					px: 'xl',
					py: 'lg'
				},
				body: { px: 'xl', py: 'xl' }
			},
			centeredOverlay: {
				portal: {
					position: 'fixed',
					inset: 0,
					zIndex: 100
				},
				backdrop: {
					position: 'absolute',
					bg: 'scrapscache.backdropMuted',
					backdropFilter: 'none'
				},
				positioner: {
					position: 'absolute',
					inset: 0,
					...rowCenter,
					justifyContent: 'center',
					p: { base: 'sm', sm: 'lg' }
				},
				panel: {
					maxH: 'calc(100dvh - 2rem)',
					overflowX: 'hidden',
					overflowY: 'auto',
					p: { base: 'md', sm: 'xl' }
				},
				header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
				title: { ...rowCenter, gap: 'sm', fontWeight: 'interactive' }
			}
		}
	}
});

export const recipes = {
	text: textRecipe,
	menuItem: menuItemRecipe,
	noteSurface: noteSurfaceRecipe,
	button: buttonRecipe,
	iconButton: iconButtonRecipe,
	input: inputRecipe,
	badge: badgeRecipe
};

export const slotRecipes = {
	noteCard: noteCardRecipe,
	checklist: checklistRecipe,
	noteBody: noteBodyRecipe,
	choiceCard: choiceCardRecipe,
	dialog: dialogRecipe
};
