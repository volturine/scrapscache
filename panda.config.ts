import { defineConfig, defineRecipe, defineSlotRecipe } from '@pandacss/dev';

const tooltipRecipe = defineRecipe({
	className: 'scrapscache-tooltip',
	description: 'Tooltip popup content recipe',
	base: {
		pointerEvents: 'none',
		zIndex: 120,
		rounded: 'md',
		bg: 'scrapscache.tooltipBg',
		color: 'scrapscache.tooltipText',
		px: '0.5rem',
		py: '0.25rem',
		fontSize: 'xs',
		fontWeight: '500',
		boxShadow: 'md',
		backdropFilter: 'blur(4px)',
		transition: 'opacity 150ms ease'
	}
});

const popoverRecipe = defineRecipe({
	className: 'scrapscache-popover',
	description: 'Floating surface shared by menus and popovers',
	base: {
		borderWidth: '1px',
		borderColor: 'scrapscache.border',
		bg: 'scrapscache.surface',
		rounded: 'lg',
		boxShadow: 'popover'
	}
});

const buttonRecipe = defineRecipe({
	className: 'scrapscache-btn',
	description: 'Interactive button component with variants and sizes',
	base: {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		fontFamily: 'sans',
		fontWeight: '500',
		rounded: 'md',
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
				borderWidth: '1px',
				borderColor: 'transparent',
				_hoverable: {
					bg: 'scrapscache.accentHover'
				}
			},
			secondary: {
				bg: 'transparent',
				color: 'scrapscache.text',
				borderWidth: '1px',
				borderColor: 'scrapscache.border',
				_hoverable: {
					bg: 'scrapscache.interactiveHover'
				}
			},
			quiet: {
				bg: 'transparent',
				color: 'scrapscache.textMuted',
				borderWidth: '1px',
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
				rounded: 'xl',
				_hoverable: {
					bg: 'scrapscache.controlSubtleHover'
				}
			},
			ghost: {
				bg: 'transparent',
				color: 'scrapscache.textMuted',
				borderWidth: '0px',
				rounded: 'xl',
				_hoverable: {
					bg: 'scrapscache.interactiveHover',
					color: 'scrapscache.text'
				}
			},
			danger: {
				bg: 'transparent',
				color: 'scrapscache.danger',
				borderWidth: '0px',
				rounded: 'xl',
				_hoverable: {
					bg: 'scrapscache.dangerSubtle'
				}
			},
			destructive: {
				bg: 'scrapscache.danger',
				color: 'scrapscache.dangerForeground',
				borderWidth: '1px',
				borderColor: 'transparent',
				_hoverable: {
					bg: 'scrapscache.dangerHover'
				}
			},
			dashed: {
				bg: 'transparent',
				borderWidth: '1px',
				borderStyle: 'dashed',
				borderColor: 'scrapscache.border',
				color: 'scrapscache.textMuted',
				rounded: 'xl',
				_hoverable: {
					bg: 'scrapscache.surfaceSubtle',
					color: 'scrapscache.text'
				}
			}
		},
		size: {
			xs: {
				height: '1.75rem',
				px: '0.375rem',
				fontSize: 'xs',
				gap: '0.25rem'
			},
			sm: {
				height: '2rem',
				px: '0.75rem',
				fontSize: 'sm',
				gap: '0.375rem'
			},
			md: {
				height: '2.25rem',
				px: '1rem',
				fontSize: 'sm',
				gap: '0.5rem'
			},
			lg: {
				height: '2.75rem',
				px: '1.25rem',
				fontSize: 'base',
				gap: '0.625rem'
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
		rounded: 'full',
		cursor: 'pointer',
		userSelect: 'none',
		touchAction: 'manipulation',
		WebkitTapHighlightColor: 'transparent',
		transition:
			'background-color 150ms ease, color 150ms ease, opacity 150ms ease, transform 150ms ease',
		_focusVisible: {
			outline: 'none',
			ringWidth: '2px',
			ringColor: 'white/80'
		},
		_active: {
			transform: 'scale(0.95)'
		}
	},
	variants: {
		variant: {
			haze: {
				bg: 'transparent',
				color: 'white/90',
				_hoverable: {
					bg: 'white/20',
					transform: 'scale(1.05)'
				}
			},
			hazeCopied: {
				bg: 'transparent',
				color: 'emerald.400',
				_hoverable: {
					bg: 'white/20',
					transform: 'scale(1.05)'
				}
			},
			hazePinned: {
				bg: 'transparent',
				color: 'amber.300',
				_hoverable: {
					bg: 'white/20',
					transform: 'scale(1.05)'
				}
			},
			hazeBlue: {
				bg: 'transparent',
				color: 'blue.300',
				_hoverable: {
					bg: 'white/20',
					transform: 'scale(1.05)'
				}
			},
			hazeRose: {
				bg: 'transparent',
				color: 'white/90',
				_hoverable: {
					bg: 'rose.500/30',
					color: 'rose.300'
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
					bg: 'red.500/10',
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
		fontSize: 'sm',
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
				rounded: 'md',
				borderWidth: '1px',
				borderColor: 'scrapscache.border',
				bg: 'scrapscache.bg',
				_focus: { ringWidth: '2px', ringColor: 'blue.400/40' }
			},
			unstyled: {
				bg: 'transparent',
				borderWidth: '0px'
			}
		},
		size: {
			sm: { px: '0.75rem', py: '0.375rem', fontSize: 'xs' },
			md: { px: '0.75rem', py: '0.5rem', fontSize: 'sm' },
			lg: { px: '1rem', py: '0.75rem', fontSize: 'base' }
		}
	},
	compoundVariants: [{ variant: 'unstyled', css: { px: 0, py: 0 } }],
	defaultVariants: {
		variant: 'outline',
		size: 'md'
	}
});

const selectRecipe = defineRecipe({
	className: 'scrapscache-select',
	description: 'Select element recipe',
	base: {
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
	variants: {
		size: {
			sm: { py: '0.375rem', pl: '0.625rem', pr: '1.75rem', fontSize: 'xs' },
			md: { py: '0.5rem', pl: '0.75rem', pr: '2rem', fontSize: 'sm' }
		}
	},
	defaultVariants: {
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
		fontWeight: '500',
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
			sm: { rounded: 'sm', px: '0.375rem', py: '0.125rem', fontSize: '10px' },
			md: { rounded: 'md', px: '0.5rem', py: '0.25rem', fontSize: 'xs' }
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
		borderWidth: '1px',
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
			},
			danger: {
				bg: 'scrapscache.dangerSubtle',
				color: 'scrapscache.danger'
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
			mb: '0.75rem',
			display: 'flex',
			alignItems: 'center',
			gap: '0.75rem',
			px: '0.5rem'
		},
		label: {
			fontSize: 'xs',
			fontWeight: '600',
			textTransform: 'uppercase',
			letterSpacing: 'wide',
			color: 'scrapscache.textMuted'
		},
		count: {
			fontSize: 'xs',
			color: 'scrapscache.textMuted',
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
			mt: '2.5rem',
			display: 'flex',
			maxW: '24rem',
			flexDirection: 'column',
			alignItems: 'center',
			px: '1rem',
			textAlign: 'center',
			color: 'scrapscache.textMuted'
		},
		description: {
			mt: '0.75rem',
			fontSize: 'sm',
			lineHeight: '1.5rem'
		},
		action: {
			display: 'inline-flex',
			alignItems: 'center',
			justifyContent: 'center',
			mt: '0.75rem',
			rounded: 'full',
			borderWidth: '1px',
			borderColor: 'scrapscache.border',
			px: '0.75rem',
			py: '0.375rem',
			fontSize: 'sm',
			fontWeight: '500',
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
		'labelPill',
		'hazeOverlay',
		'hazeActions',
		'shield'
	],
	base: {
		cardOuter: {
			position: 'relative',
			overflow: 'hidden',
			rounded: 'lg'
		},
		swipeRestore: {
			position: 'absolute',
			inset: 0,
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'flex-end',
			rounded: 'lg',
			bg: 'green.500',
			pr: '1rem',
			color: 'white'
		},
		swipeTrash: {
			position: 'absolute',
			inset: 0,
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'flex-start',
			rounded: 'lg',
			bg: 'red.500',
			pl: '1rem',
			color: 'white'
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
			rounded: 'lg',
			borderWidth: '1px',
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
			p: '0.75rem',
			pb: '0.5rem',
			textAlign: 'left'
		},
		title: {
			mb: '0.25rem',
			wordBreak: 'break-word',
			fontSize: '15px',
			fontWeight: '600',
			lineHeight: 'snug',
			letterSpacing: 'tight',
			color: 'scrapscache.text'
		},
		body: {
			fontSize: '0.875rem',
			color: 'scrapscache.text'
		},
		labelsRow: {
			display: 'flex',
			flexShrink: 0,
			flexWrap: 'wrap',
			gap: '0.25rem',
			px: '0.75rem',
			pb: '0.75rem',
			pt: '0.5rem'
		},
		labelPill: {
			rounded: 'sm',
			px: '0.375rem',
			py: '0.125rem',
			fontSize: '10px',
			fontWeight: 'medium',
			bg: 'scrapscache.interactiveHover',
			color: 'scrapscache.textMuted'
		},
		hazeOverlay: {
			position: 'absolute',
			inset: 0,
			zIndex: 20,
			display: 'flex',
			flexDirection: 'column',
			alignItems: 'center',
			justifyContent: 'center',
			bg: 'black/40',
			backdropFilter: 'blur(8px)',
			transition: 'opacity 200ms ease, background-color 200ms ease'
		},
		hazeActions: {
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			gap: '0.625rem'
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
					borderColor: 'amber.400/40',
					ringWidth: '1px',
					ringColor: 'amber.400/50'
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

const kanbanRecipe = defineSlotRecipe({
	className: 'scrapscache-kanban',
	description: 'Slot recipe for Kanban board view',
	slots: [
		'page',
		'controls',
		'selectWrap',
		'selectChevron',
		'renameRow',
		'columnsContainer',
		'columnsTrack',
		'column',
		'colHeader',
		'colTitle',
		'cardsList',
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
		'menuItem'
	],
	base: {
		page: { pt: '1rem', pb: '2rem' },
		controls: {
			mb: '1rem',
			display: 'flex',
			flexWrap: 'wrap',
			alignItems: 'center',
			gap: '0.5rem'
		},
		selectWrap: { position: 'relative', minW: 0, maxW: 'full' },
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
		columnsContainer: { mx: '-1rem', overflowX: 'auto', px: '1rem', pb: '1rem' },
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
		}
	}
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
			bg: 'black/50',
			backdropFilter: 'blur(4px)',
			zIndex: 100,
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			p: '1rem'
		},
		panel: {
			position: 'relative',
			w: 'full',
			maxW: '28rem',
			bg: 'scrapscache.surface',
			borderWidth: '1px',
			borderColor: 'scrapscache.border',
			rounded: 'xl',
			boxShadow: 'dialog',
			p: '1.5rem',
			display: 'flex',
			flexDirection: 'column',
			gap: '1rem',
			zIndex: 101
		},
		header: {
			display: 'flex',
			flexDirection: 'column',
			gap: '0.25rem'
		},
		title: {
			fontSize: 'lg',
			fontWeight: '600',
			color: 'scrapscache.text',
			lineHeight: 'tight'
		},
		description: {
			fontSize: 'sm',
			color: 'scrapscache.textMuted'
		},
		body: {
			display: 'flex',
			flexDirection: 'column',
			gap: '0.75rem'
		},
		footer: {
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'flex-end',
			gap: '0.75rem',
			pt: '0.5rem'
		},
		error: {
			fontSize: 'sm',
			color: 'scrapscache.danger'
		},
		closeButton: {
			position: 'absolute',
			top: '1rem',
			right: '1rem',
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
			},
			lg: {
				panel: { maxW: '36rem' }
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
					bg: 'black/45',
					backdropFilter: 'none'
				},
				positioner: {
					position: 'absolute',
					inset: 0,
					display: 'flex',
					alignItems: 'flex-start',
					justifyContent: 'center',
					px: '1rem',
					pb: '1rem',
					pt: 'calc(var(--app-topbar-height) + 0.5rem)'
				},
				panel: { maxW: '24rem', p: 0, gap: 0 },
				header: {
					borderBottomWidth: '1px',
					borderColor: 'scrapscache.border',
					px: '1.25rem',
					py: '1rem'
				},
				body: { px: '1.25rem', py: '1.25rem' }
			}
		}
	},
	defaultVariants: {
		size: 'md'
	}
});

export default defineConfig({
	// Whether to use css reset
	preflight: true,

	// Where to look for your css declarations
	include: ['./src/**/*.{js,jsx,ts,tsx,svelte}'],

	// Files to exclude
	exclude: [],

	// Note colors are selected from persisted data, so the extractor cannot see
	// the runtime recipe variant. Emit the complete, intentionally bounded set.
	staticCss: {
		recipes: {
			noteSurface: ['*']
		}
	},

	conditions: {
		extend: {
			dark: '&:where(.dark, .dark *)',
			hoverable: ['@media (hover: hover) and (pointer: fine)', '&:hover']
		}
	},

	theme: {
		extend: {
			tokens: {
				fonts: {
					sans: { value: ['"Google Sans"', '"Roboto"', 'system-ui', 'Arial', 'sans-serif'] },
					roboto: { value: ['"Roboto"', 'system-ui', 'sans-serif'] }
				},
				radii: {
					sm: { value: '0.375rem' },
					md: { value: '0.5rem' },
					lg: { value: '0.75rem' },
					xl: { value: '1rem' }
				}
			},
			semanticTokens: {
				colors: {
					scrapscache: {
						bg: {
							value: { base: '#ffffff', _dark: '#1a1a1a' }
						},
						surface: {
							value: { base: '#f8f9fa', _dark: '#242424' }
						},
						text: {
							value: { base: '#202124', _dark: '#e8eaed' }
						},
						textMuted: {
							value: { base: '#5f6368', _dark: '#9aa0a6' }
						},
						border: {
							value: { base: '#e0e0e0', _dark: '#3c4043' }
						},
						borderFaint: {
							value: { base: 'rgba(0, 0, 0, 0.05)', _dark: 'rgba(255, 255, 255, 0.1)' }
						},
						borderSubtle: {
							value: { base: 'rgba(0, 0, 0, 0.1)', _dark: 'rgba(255, 255, 255, 0.1)' }
						},
						checklistBorder: {
							value: { base: 'rgba(0, 0, 0, 0.4)', _dark: 'rgba(255, 255, 255, 0.4)' }
						},
						tooltipBg: {
							value: { base: 'rgba(23, 23, 23, 0.9)', _dark: 'rgba(245, 245, 245, 0.9)' }
						},
						tooltipText: {
							value: { base: '#ffffff', _dark: '#171717' }
						},
						controlSubtle: {
							value: { base: 'rgba(0, 0, 0, 0.06)', _dark: 'rgba(255, 255, 255, 0.1)' }
						},
						controlSubtleHover: {
							value: { base: 'rgba(0, 0, 0, 0.1)', _dark: 'rgba(255, 255, 255, 0.15)' }
						},
						surfaceSubtle: {
							value: {
								base: 'rgba(0, 0, 0, 0.035)',
								_dark: 'rgba(255, 255, 255, 0.055)'
							}
						},
						canvasSurface: {
							value: { base: '#ffffff', _dark: '#121212' }
						},
						overdue: {
							value: { base: '#be123c', _dark: '#fb7185' }
						},
						overdueStrong: {
							value: { base: '#e11d48', _dark: '#f43f5e' }
						},
						accent: {
							value: { base: '#2563eb', _dark: '#60a5fa' }
						},
						accentHover: {
							value: { base: '#1d4ed8', _dark: '#93c5fd' }
						},
						accentForeground: {
							value: { base: '#ffffff', _dark: '#172554' }
						},
						accentSubtle: {
							value: {
								base: 'color-mix(in srgb, {colors.scrapscache.accent} 14%, {colors.scrapscache.surface})',
								_dark:
									'color-mix(in srgb, {colors.scrapscache.accent} 14%, {colors.scrapscache.surface})'
							}
						},
						focus: {
							value: { base: '#1d4ed8', _dark: '#93c5fd' }
						},
						success: {
							value: { base: '#15803d', _dark: '#4ade80' }
						},
						successForeground: {
							value: { base: '#ffffff', _dark: '#052e16' }
						},
						successSubtle: {
							value: { base: '#dcfce7', _dark: '#14351f' }
						},
						warning: {
							value: { base: '#b45309', _dark: '#fbbf24' }
						},
						warningSubtle: {
							value: { base: '#fef3c7', _dark: '#3d2e0b' }
						},
						danger: {
							value: { base: '#dc2626', _dark: '#f87171' }
						},
						dangerHover: {
							value: { base: '#b91c1c', _dark: '#ef4444' }
						},
						dangerForeground: {
							value: { base: '#ffffff', _dark: '#450a0a' }
						},
						dangerSubtle: {
							value: { base: '#fee2e2', _dark: '#3b1717' }
						},
						interactiveHover: {
							value: { base: 'rgba(0, 0, 0, 0.05)', _dark: 'rgba(255, 255, 255, 0.08)' }
						},
						interactiveActive: {
							value: { base: 'rgba(0, 0, 0, 0.1)', _dark: 'rgba(255, 255, 255, 0.12)' }
						},
						navigationActive: {
							value: { base: '#fef9c3', _dark: 'rgba(202, 138, 4, 0.15)' }
						},
						navigationActiveText: {
							value: { base: '#1a1a1a', _dark: '#fde68a' }
						}
					},
					note: {
						default: {
							value: { base: '#ffffff', _dark: '#1f1f1f' }
						},
						red: {
							value: { base: '#f28b82', _dark: '#5a3636' }
						},
						orange: {
							value: { base: '#f6aea0', _dark: '#5a4a3f' }
						},
						yellow: {
							value: { base: '#f7d875', _dark: '#5a5240' }
						},
						green: {
							value: { base: '#b3e2a1', _dark: '#3a4a3a' }
						},
						teal: {
							value: { base: '#98e9d9', _dark: '#2f4a4a' }
						},
						blue: {
							value: { base: '#a9d5f4', _dark: '#2f3a4f' }
						},
						darkblue: {
							value: { base: '#9bb8f3', _dark: '#2d3850' }
						},
						purple: {
							value: { base: '#c6b3f2', _dark: '#3d3756' }
						},
						pink: {
							value: { base: '#f9c2d8', _dark: '#4f3e4e' }
						},
						brown: {
							value: { base: '#d6c5b0', _dark: '#4f4a44' }
						},
						gray: {
							value: { base: '#f0f0f0', _dark: '#3c3c3c' }
						}
					}
				},
				shadows: {
					popover: {
						value: {
							base: '0 8px 24px rgba(0, 0, 0, 0.14)',
							_dark: '0 8px 24px rgba(0, 0, 0, 0.35)'
						}
					},
					dialog: {
						value: {
							base: '0 20px 48px rgba(0, 0, 0, 0.24)',
							_dark: '0 20px 48px rgba(0, 0, 0, 0.55)'
						}
					},
					noteSheet: {
						value: {
							base: '0 0 24px 2px rgba(0, 0, 0, 0.22)',
							_dark: '0 0 24px 2px rgba(0, 0, 0, 0.55)'
						}
					}
				}
			},
			recipes: {
				tooltip: tooltipRecipe,
				popover: popoverRecipe,
				noteSurface: noteSurfaceRecipe,
				button: buttonRecipe,
				iconButton: iconButtonRecipe,
				input: inputRecipe,
				select: selectRecipe,
				badge: badgeRecipe,
				status: statusRecipe
			},
			slotRecipes: {
				sectionHeader: sectionHeaderRecipe,
				emptyState: emptyStateRecipe,
				noteCard: noteCardRecipe,
				kanban: kanbanRecipe,
				dialog: dialogRecipe
			}
		}
	},

	// The output directory for your css system
	outdir: 'styled-system'
});
