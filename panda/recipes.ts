import { defineRecipe, defineSlotRecipe } from '@pandacss/dev';

const textRecipe = defineRecipe({
	className: 'scrapscache-text',
	description: 'Shared semantic typography roles',
	base: { fontFamily: 'sans' },
	variants: {
		style: {
			body: { textStyle: 'body' },
			bodyMuted: { textStyle: 'bodyMuted' },
			caption: { textStyle: 'caption' },
			captionStrong: { textStyle: 'captionStrong' },
			heading: { textStyle: 'heading' }
		},
		tone: {
			default: {},
			danger: { color: 'scrapscache.danger' }
		}
	},
	defaultVariants: { style: 'body', tone: 'default' }
});

const viewPageRecipe = defineRecipe({
	className: 'scrapscache-view-page',
	description: 'Shared vertical padding for top-level application views',
	base: { pt: 'lg', pb: '3xl' }
});

const notesShellRecipe = defineRecipe({
	className: 'scrapscache-notes-shell',
	description: 'Shared width contract for note feeds and their section chrome',
	base: {
		w: 'full',
		mx: 'auto',
		px: 0,
		boxSizing: 'border-box'
	},
	variants: {
		layout: {
			grid: {},
			list: { maxW: '720px' }
		}
	},
	defaultVariants: { layout: 'grid' }
});

const tooltipRecipe = defineRecipe({
	className: 'scrapscache-tooltip',
	description: 'Tooltip popup content recipe',
	base: {
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
	}
});

const popoverRecipe = defineRecipe({
	className: 'scrapscache-popover',
	description: 'Floating surface shared by menus and popovers',
	base: {
		borderWidth: 'hairline',
		borderColor: 'scrapscache.border',
		bg: 'scrapscache.surface',
		rounded: 'card',
		boxShadow: 'popover'
	}
});

const mediaHazeButton = (color: string) => ({
	bg: 'transparent',
	color,
	_hoverable: {
		bg: 'scrapscache.mediaControlActive',
		transform: 'scale(1.05)'
	}
});

const menuItemRecipe = defineRecipe({
	className: 'scrapscache-menu-item',
	description: 'Shared interactive row treatment for menus and navigation',
	base: {
		display: 'flex',
		w: 'full',
		alignItems: 'center',
		textAlign: 'left',
		cursor: 'pointer',
		touchAction: 'manipulation',
		WebkitTapHighlightColor: 'transparent',
		color: 'scrapscache.text',
		transition: 'background-color 120ms ease, color 120ms ease',
		_hoverable: { bg: 'scrapscache.interactiveHover' },
		_active: { bg: 'scrapscache.interactiveActive' },
		_disabled: { opacity: 0.55, cursor: 'not-allowed' }
	},
	variants: {
		density: {
			compact: { h: '2rem', gap: 'sm', px: 'md', fontSize: 'body' },
			comfortable: {
				gap: 'md',
				rounded: 'dialog',
				px: 'md',
				py: 'list',
				textStyle: 'button'
			},
			sidebar: {
				gap: 'md',
				rounded: 'dialog',
				py: 'list',
				pl: 'lg',
				pr: 'sm',
				textStyle: 'button'
			}
		}
	},
	defaultVariants: { density: 'compact' }
});

const progressMeterRecipe = defineSlotRecipe({
	className: 'scrapscache-progress-meter',
	description: 'Shared progress meter track and fill treatment',
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

const buttonRecipe = defineRecipe({
	className: 'scrapscache-btn',
	description: 'Interactive button component with variants and sizes',
	base: {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		fontFamily: 'sans',
		textStyle: 'button',
		rounded: 'control',
		cursor: 'pointer',
		userSelect: 'none',
		touchAction: 'manipulation',
		WebkitTapHighlightColor: 'transparent',
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
			primary: {
				bg: 'scrapscache.accent',
				color: 'scrapscache.accentForeground',
				borderWidth: 'hairline',
				borderColor: 'transparent',
				_hoverable: {
					bg: 'scrapscache.accentHover'
				}
			},
			secondary: {
				bg: 'transparent',
				color: 'scrapscache.text',
				borderWidth: 'hairline',
				borderColor: 'scrapscache.border',
				_hoverable: {
					bg: 'scrapscache.interactiveHover'
				}
			},
			quiet: {
				bg: 'transparent',
				color: 'scrapscache.textMuted',
				borderWidth: 'hairline',
				borderColor: 'transparent',
				_hoverable: {
					bg: 'scrapscache.interactiveHover',
					color: 'scrapscache.text'
				}
			},
			subtle: {
				bg: 'scrapscache.controlSubtle',
				color: 'scrapscache.text',
				borderWidth: '0px',
				rounded: 'dialog',
				_hoverable: {
					bg: 'scrapscache.controlSubtleHover'
				}
			},
			ghost: {
				bg: 'transparent',
				color: 'scrapscache.textMuted',
				borderWidth: '0px',
				rounded: 'dialog',
				_hoverable: {
					bg: 'scrapscache.interactiveHover',
					color: 'scrapscache.text'
				}
			},
			danger: {
				bg: 'transparent',
				color: 'scrapscache.danger',
				borderWidth: '0px',
				rounded: 'dialog',
				_hoverable: {
					bg: 'scrapscache.dangerSubtle'
				}
			},
			destructive: {
				bg: 'scrapscache.danger',
				color: 'scrapscache.dangerForeground',
				borderWidth: 'hairline',
				borderColor: 'transparent',
				_hoverable: {
					bg: 'scrapscache.dangerHover'
				}
			},
			dashed: {
				bg: 'transparent',
				borderWidth: 'hairline',
				borderStyle: 'dashed',
				borderColor: 'scrapscache.border',
				color: 'scrapscache.textMuted',
				rounded: 'dialog',
				_hoverable: {
					bg: 'scrapscache.surfaceSubtle',
					color: 'scrapscache.text'
				}
			}
		},
		size: {
			xs: {
				height: '1.75rem',
				px: 'xs',
				fontSize: 'label',
				gap: '2xs'
			},
			sm: {
				height: '2rem',
				px: 'md',
				fontSize: 'body',
				gap: 'xs'
			},
			md: {
				height: '2.25rem',
				px: 'lg',
				fontSize: 'body',
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
	description: 'Circular icon button with states and hover effects',
	base: {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		rounded: 'pill',
		cursor: 'pointer',
		userSelect: 'none',
		touchAction: 'manipulation',
		WebkitTapHighlightColor: 'transparent',
		transition:
			'background-color 150ms ease, color 150ms ease, opacity 150ms ease, transform 150ms ease',
		_focusVisible: {
			outline: 'none',
			ringWidth: '2px',
			ringColor: 'scrapscache.focus'
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
				bg: 'transparent',
				color: 'scrapscache.mediaTextStrong',
				_hoverable: {
					bg: 'scrapscache.mediaDangerSubtle',
					color: 'scrapscache.mediaDanger'
				}
			},
			ghost: {
				bg: 'transparent',
				color: 'scrapscache.textMuted',
				_hoverable: {
					bg: 'scrapscache.interactiveHover',
					color: 'scrapscache.text'
				}
			},
			danger: {
				bg: 'transparent',
				color: 'scrapscache.textMuted',
				_hoverable: {
					bg: 'scrapscache.dangerSubtle',
					color: 'scrapscache.danger'
				}
			}
		},
		size: {
			xs: {
				w: '1.75rem',
				h: '1.75rem'
			},
			compact: {
				w: '2rem',
				h: '2rem'
			},
			sm: {
				w: '2.25rem',
				h: '2.25rem'
			},
			standard: {
				w: '2.5rem',
				h: '2.5rem'
			},
			lg: {
				w: '3rem',
				h: '3rem'
			}
		}
	},
	defaultVariants: {
		variant: 'ghost',
		size: 'standard'
	}
});

const inputRecipe = defineRecipe({
	className: 'scrapscache-input',
	description: 'Text input recipe with variants and sizes',
	base: {
		minW: 0,
		fontFamily: 'sans',
		fontSize: 'body',
		color: 'scrapscache.text',
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
				bg: 'transparent',
				borderWidth: '0px'
			}
		},
		size: {
			sm: { px: 'md', py: 'xs', fontSize: 'label' },
			md: { px: 'md', py: 'sm', fontSize: 'body' }
		}
	},
	compoundVariants: [{ variant: 'unstyled', css: { px: 0, py: 0 } }],
	defaultVariants: {
		variant: 'outline',
		size: 'md'
	}
});

const badgeRecipe = defineRecipe({
	className: 'scrapscache-badge',
	description: 'Badge and pill element recipe',
	base: {
		display: 'inline-flex',
		alignItems: 'center',
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

const statusRecipe = defineRecipe({
	className: 'scrapscache-status',
	description: 'Semantic status treatment',
	base: {
		borderWidth: 'hairline',
		borderColor: 'currentColor'
	},
	variants: {
		tone: {
			accent: {
				bg: 'scrapscache.accentSubtle',
				color: 'scrapscache.accent'
			},
			success: {
				bg: 'scrapscache.successSubtle',
				color: 'scrapscache.success'
			},
			warning: {
				bg: 'scrapscache.warningSubtle',
				color: 'scrapscache.warning'
			}
		}
	}
});

const sectionHeaderRecipe = defineSlotRecipe({
	className: 'scrapscache-section-header',
	description: 'Slot recipe for section headers in feed and views',
	slots: ['row', 'label', 'count', 'spacer'],
	base: {
		row: {
			mb: 'md',
			display: 'flex',
			alignItems: 'center',
			gap: 'md',
			px: 'sm'
		},
		label: {
			textStyle: 'overline'
		},
		count: {
			textStyle: 'caption',
			opacity: 0.6
		},
		spacer: {
			flex: '1'
		}
	}
});

const emptyStateRecipe = defineSlotRecipe({
	className: 'scrapscache-empty-state',
	description: 'Slot recipe for empty state display',
	slots: ['root', 'description', 'action'],
	base: {
		root: {
			mx: 'auto',
			mt: '4xl',
			display: 'flex',
			maxW: '24rem',
			flexDirection: 'column',
			alignItems: 'center',
			px: 'lg',
			textAlign: 'center',
			color: 'scrapscache.textMuted'
		},
		description: {
			mt: 'md',
			textStyle: 'bodyMuted'
		},
		action: {
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
			_hoverable: {
				bg: 'scrapscache.borderFaint'
			}
		}
	}
});

const noteSurfaceRecipe = defineRecipe({
	className: 'scrapscache-note-surface',
	description: 'Canonical note background colors for cards, editors, and palette swatches',
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
	description: 'Slot recipe for NoteCard components',
	slots: [
		'cardOuter',
		'swipeRestore',
		'swipeTrash',
		'cardBody',
		'contentPad',
		'title',
		'body',
		'labelsRow',
		'hazeOverlay',
		'hazeActions',
		'shield'
	],
	base: {
		cardOuter: {
			position: 'relative',
			overflow: 'hidden',
			rounded: 'card'
		},
		swipeRestore: {
			position: 'absolute',
			inset: 0,
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'flex-end',
			rounded: 'card',
			bg: 'scrapscache.success',
			pr: 'lg',
			color: 'scrapscache.successForeground'
		},
		swipeTrash: {
			position: 'absolute',
			inset: 0,
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'flex-start',
			rounded: 'card',
			bg: 'scrapscache.danger',
			pl: 'lg',
			color: 'scrapscache.dangerForeground'
		},
		cardBody: {
			position: 'relative',
			zIndex: 1,
			display: 'flex',
			w: 'full',
			maxH: '320px',
			cursor: 'pointer',
			flexDirection: 'column',
			overflow: 'hidden',
			rounded: 'card',
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
			letterSpacing: 'tight',
			color: 'scrapscache.text'
		},
		body: {
			textStyle: 'body',
			color: 'scrapscache.text'
		},
		labelsRow: {
			display: 'flex',
			flexShrink: 0,
			flexWrap: 'wrap',
			gap: '2xs',
			px: 'md',
			pb: 'md',
			pt: 'sm'
		},
		hazeOverlay: {
			position: 'absolute',
			inset: 0,
			zIndex: 20,
			display: 'flex',
			flexDirection: 'column',
			alignItems: 'center',
			justifyContent: 'center',
			bg: 'scrapscache.backdropMuted',
			backdropFilter: 'blur(8px)',
			transition: 'opacity 200ms ease, background-color 200ms ease'
		},
		hazeActions: {
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			gap: 'list'
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
					boxShadow: 'md',
					borderColor: 'scrapscache.pinnedBorder',
					ringWidth: '1px',
					ringColor: 'scrapscache.pinnedRing'
				}
			}
		},
		trashed: {
			true: {
				cardBody: {
					opacity: 0.65
				}
			}
		}
	},
	defaultVariants: {
		pinned: false,
		trashed: false
	}
});

const checklistRecipe = defineSlotRecipe({
	className: 'scrapscache-checklist',
	description: 'Shared checklist control for note display and editing',
	slots: ['root', 'mark'],
	base: {
		root: {
			boxSizing: 'border-box',
			position: 'relative',
			display: 'inline-grid',
			placeItems: 'center',
			w: '1.125rem',
			h: '1.125rem',
			mt: '0.2rem',
			p: 0,
			borderWidth: 'control',
			borderColor: 'scrapscache.checklistBorder',
			rounded: 'checkbox',
			bg: 'transparent',
			color: 'inherit',
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
			w: '0.7rem',
			h: '0.7rem',
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
				root: { w: '0.9375rem', h: '0.9375rem', mt: '0.22rem' },
				mark: { w: '0.55rem', h: '0.55rem' }
			}
		},
		checked: {
			true: { root: { bg: 'scrapscache.interactiveActive' } }
		}
	},
	defaultVariants: { indented: false, checked: false }
});

const noteBodyRecipe = defineSlotRecipe({
	className: 'scrapscache-note-body',
	description: 'Shared note text, list row, and checklist layout',
	slots: ['container', 'row', 'line', 'check', 'bullet', 'paragraph', 'spacer', 'addSubtask'],
	base: {
		container: { textStyle: 'body', color: 'scrapscache.text' },
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
		spacer: { h: 'sm' },
		addSubtask: { '&::before': { content: '"+  Add sub-task"' } }
	},
	variants: {
		mode: {
			display: {},
			editor: {
				container: {
					display: 'block',
					w: 'full',
					minW: 0,
					lineHeight: 'relaxed',
					outline: 'none'
				},
				row: { flexWrap: 'wrap' },
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
			true: { line: { textDecoration: 'line-through', opacity: 0.5 } },
			false: {}
		},
		indented: {
			true: { line: { fontSize: 'compact' } },
			false: {}
		}
	},
	defaultVariants: { mode: 'display', checked: false, indented: false }
});

const choiceCardRecipe = defineSlotRecipe({
	className: 'scrapscache-choice-card',
	description: 'Shared selectable option card treatment',
	slots: ['root', 'title', 'description', 'footer'],
	base: {
		root: {
			w: 'full',
			minH: '5rem',
			px: 'md',
			py: 'md',
			textAlign: 'left'
		},
		title: { display: 'block', textStyle: 'bodyStrong', color: 'scrapscache.text' },
		description: {
			display: 'block',
			mt: '2xs',
			textStyle: 'caption',
			color: 'scrapscache.textMuted'
		},
		footer: { pt: '2xs' }
	},
	variants: {
		interactive: {
			true: {
				root: {
					rounded: 'control',
					borderWidth: 'hairline',
					borderColor: 'scrapscache.border',
					bg: 'transparent',
					cursor: 'pointer',
					transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
					_hoverable: { bg: 'scrapscache.interactiveHover' },
					_disabled: { opacity: 0.55, cursor: 'not-allowed' }
				}
			}
		},
		danger: { true: { title: { color: 'scrapscache.danger' } } },
		compact: { true: { root: { minH: '0', px: 'lg', py: 'md' } } },
		kind: {
			compressed: { description: { opacity: 0.85 } },
			hd: { description: { color: 'scrapscache.textMuted' } }
		}
	},
	defaultVariants: { interactive: false, danger: false, compact: false }
});

const dialogRecipe = defineSlotRecipe({
	className: 'scrapscache-dialog-recipe',
	description: 'Slot recipe for modal dialogs and alert dialogs',
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
		'error',
		'closeButton'
	],
	base: {
		backdrop: {
			position: 'fixed',
			inset: 0,
			bg: 'scrapscache.backdrop',
			backdropFilter: 'blur(4px)',
			zIndex: 100,
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			p: 'lg'
		},
		panel: {
			position: 'relative',
			w: 'full',
			maxW: '28rem',
			bg: 'scrapscache.surface',
			borderWidth: 'hairline',
			borderColor: 'scrapscache.border',
			rounded: 'dialog',
			boxShadow: 'dialog',
			p: '2xl',
			display: 'flex',
			flexDirection: 'column',
			gap: 'lg',
			zIndex: 101
		},
		header: {
			display: 'flex',
			flexDirection: 'column',
			gap: '2xs'
		},
		title: {
			textStyle: 'heading',
			color: 'scrapscache.text'
		},
		description: {
			textStyle: 'bodyMuted'
		},
		body: {
			display: 'flex',
			flexDirection: 'column',
			gap: 'md'
		},
		footer: {
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'flex-end',
			gap: 'md',
			pt: 'sm'
		},
		error: {
			textStyle: 'body',
			color: 'scrapscache.danger'
		},
		closeButton: {
			position: 'absolute',
			top: 'lg',
			right: 'lg',
			color: 'scrapscache.textMuted',
			_hoverable: {
				color: 'scrapscache.text'
			}
		}
	},
	variants: {
		size: {
			sm: {
				panel: { maxW: '20rem' }
			},
			md: {
				panel: { maxW: '28rem' }
			}
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
					zIndex: 50
				},
				backdrop: {
					position: 'absolute',
					bg: 'scrapscache.backdropMuted',
					backdropFilter: 'none'
				},
				positioner: {
					position: 'absolute',
					inset: 0,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					p: 'lg'
				},
				panel: {
					maxH: 'calc(100dvh - 2rem)',
					overflowX: 'hidden',
					overflowY: 'auto',
					p: 'xl'
				},
				header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
				title: { display: 'flex', alignItems: 'center', gap: 'sm', fontWeight: 'interactive' }
			}
		}
	},
	defaultVariants: {
		size: 'md'
	}
});

export const recipes = {
	viewPage: viewPageRecipe,
	notesShell: notesShellRecipe,
	text: textRecipe,
	tooltip: tooltipRecipe,
	popover: popoverRecipe,
	menuItem: menuItemRecipe,
	progressMeter: progressMeterRecipe,
	noteSurface: noteSurfaceRecipe,
	button: buttonRecipe,
	iconButton: iconButtonRecipe,
	input: inputRecipe,
	badge: badgeRecipe,
	status: statusRecipe
};

export const slotRecipes = {
	sectionHeader: sectionHeaderRecipe,
	emptyState: emptyStateRecipe,
	noteCard: noteCardRecipe,
	checklist: checklistRecipe,
	noteBody: noteBodyRecipe,
	choiceCard: choiceCardRecipe,
	dialog: dialogRecipe
};
