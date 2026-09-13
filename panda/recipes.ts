import { defineRecipe, defineSlotRecipe } from '@pandacss/dev';

const textRecipe = defineRecipe({
	className: 'scrapscache-text',
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
			danger: { color: 'scrapscache.danger' }
		}
	},
	defaultVariants: { style: 'body' }
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

const buttonRecipe = defineRecipe({
	className: 'scrapscache-btn',
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
		'hazeOverlay',
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
	}
});

const checklistRecipe = defineSlotRecipe({
	className: 'scrapscache-checklist',
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
	}
});

const noteBodyRecipe = defineSlotRecipe({
	className: 'scrapscache-note-body',
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
		spacer: { py: '2xs' },
		addSubtask: { '&::before': { content: '"+  Add sub-task"' } }
	},
	variants: {
		checked: {
			true: { line: { textDecoration: 'line-through', opacity: 0.5 } }
		},
		indented: {
			true: { line: { fontSize: 'compact' } }
		}
	}
});

const choiceCardRecipe = defineSlotRecipe({
	className: 'scrapscache-choice-card',
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
		compact: { true: { root: { minH: '0', px: 'lg', py: 'md' } } }
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
