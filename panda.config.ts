import { defineConfig, defineRecipe, defineSlotRecipe } from '@pandacss/dev';

const tooltipRecipe = defineRecipe({
	className: 'scrapscache-tooltip',
	description: 'Tooltip popup content recipe',
	base: {
		pointerEvents: 'none',
		zIndex: 120,
		rounded: 'md',
		bg: { base: 'rgba(23, 23, 23, 0.9)', _dark: 'rgba(245, 245, 245, 0.9)' },
		color: { base: '#ffffff', _dark: '#171717' },
		px: '0.5rem',
		py: '0.25rem',
		fontSize: 'xs',
		fontWeight: '500',
		boxShadow: 'md',
		backdropFilter: 'blur(4px)',
		transition: 'opacity 150ms ease'
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
		transition:
			'background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
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
				_hover: {
					bg: 'scrapscache.accentHover'
				}
			},
			secondary: {
				bg: 'transparent',
				color: 'scrapscache.text',
				borderWidth: '1px',
				borderColor: 'scrapscache.border',
				_hover: {
					bg: 'scrapscache.interactiveHover'
				}
			},
			quiet: {
				bg: 'transparent',
				color: 'scrapscache.textMuted',
				borderWidth: '1px',
				borderColor: 'transparent',
				_hover: {
					bg: 'scrapscache.interactiveHover',
					color: 'scrapscache.text'
				}
			},
			destructive: {
				bg: 'scrapscache.danger',
				color: 'scrapscache.dangerForeground',
				borderWidth: '1px',
				borderColor: 'transparent',
				_hover: {
					bg: '#b91c1c'
				}
			}
		},
		size: {
			sm: {
				height: '2rem',
				px: '0.75rem',
				fontSize: 'xs',
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
		transition: 'all 120ms ease',
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
				_hover: {
					bg: 'white/20',
					transform: 'scale(1.05)'
				}
			},
			hazeCopied: {
				bg: 'transparent',
				color: 'emerald.400',
				_hover: {
					bg: 'white/20',
					transform: 'scale(1.05)'
				}
			},
			hazePinned: {
				bg: 'transparent',
				color: 'amber.300',
				_hover: {
					bg: 'white/20',
					transform: 'scale(1.05)'
				}
			},
			ghost: {
				bg: 'transparent',
				color: 'scrapscache.textMuted',
				_hover: {
					bg: 'scrapscache.interactiveHover',
					color: 'scrapscache.text'
				}
			}
		},
		size: {
			compact: {
				w: '2rem',
				h: '2rem'
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
			_hover: {
				bg: { base: 'rgba(0, 0, 0, 0.05)', _dark: 'rgba(255, 255, 255, 0.1)' }
			}
		}
	}
});

const noteCardRecipe = defineSlotRecipe({
	className: 'scrapscache-card',
	description: 'Slot recipe for NoteCard components',
	slots: ['streamIn', 'container', 'innerCard', 'title', 'body', 'shield', 'haze', 'actionsRow'],
	base: {
		streamIn: {
			position: 'relative',
			overflow: 'hidden',
			rounded: 'lg'
		},
		container: {
			position: 'relative',
			w: 'full',
			textAlign: 'left',
			userSelect: 'none',
			cursor: 'pointer',
			rounded: 'lg',
			_focusVisible: {
				outline: '2px solid',
				outlineColor: 'scrapscache.focus',
				outlineOffset: '2px'
			}
		},
		innerCard: {
			position: 'relative',
			p: '1rem',
			rounded: 'lg',
			borderWidth: '1px',
			borderColor: { base: 'black/5', _dark: 'white/10' },
			transition: 'box-shadow 150ms ease, border-color 150ms ease, transform 150ms ease',
			_hover: {
				boxShadow: 'md'
			}
		},
		title: {
			fontSize: '0.9375rem',
			fontWeight: '600',
			lineHeight: '1.25',
			mb: '0.5rem',
			color: 'scrapscache.text'
		},
		body: {
			fontSize: '0.875rem',
			color: 'scrapscache.text'
		},
		shield: {
			position: 'absolute',
			inset: 0
		},
		haze: {
			position: 'absolute',
			inset: 0,
			zIndex: 10,
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			bg: 'black/40',
			backdropFilter: 'blur(8px)',
			transition: 'all 200ms ease'
		},
		actionsRow: {
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			gap: '0.625rem'
		}
	},
	variants: {
		pinned: {
			true: {
				innerCard: {
					boxShadow: 'md',
					borderColor: 'amber.400/40',
					ringWidth: '1px',
					ringColor: 'amber.400/50'
				}
			}
		},
		trashed: {
			true: {
				innerCard: {
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

const dialogRecipe = defineSlotRecipe({
	className: 'scrapscache-dialog-recipe',
	description: 'Slot recipe for modal dialogs and alert dialogs',
	slots: ['backdrop', 'panel', 'header', 'title', 'description', 'body', 'footer', 'closeButton'],
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
		closeButton: {
			position: 'absolute',
			top: '1rem',
			right: '1rem',
			color: 'scrapscache.textMuted',
			_hover: {
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

	conditions: {
		extend: {
			dark: '&:where(.dark, .dark *)'
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
						accent: {
							value: { base: '#2563eb', _dark: '#60a5fa' }
						},
						accentHover: {
							value: { base: '#1d4ed8', _dark: '#93c5fd' }
						},
						accentForeground: {
							value: { base: '#ffffff', _dark: '#172554' }
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
					}
				}
			},
			recipes: {
				tooltip: tooltipRecipe,
				button: buttonRecipe,
				iconButton: iconButtonRecipe
			},
			slotRecipes: {
				sectionHeader: sectionHeaderRecipe,
				emptyState: emptyStateRecipe,
				noteCard: noteCardRecipe,
				dialog: dialogRecipe
			}
		}
	},

	// The output directory for your css system
	outdir: 'styled-system'
});
