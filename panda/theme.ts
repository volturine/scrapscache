export const theme = {
	extend: {
		keyframes: {
			cardIn: {
				from: { opacity: 0, transform: 'translateY(8px)' },
				to: { opacity: 1, transform: 'none' }
			}
		},
		tokens: {
			colors: {
				palette: {
					background: { value: '#ffffff' },
					backgroundDark: { value: '#1a1a1a' },
					surface: { value: '#f8f9fa' },
					surfaceDark: { value: '#242424' },
					accent: { value: '#2563eb' },
					accentDark: { value: '#60a5fa' },
					accentHover: { value: '#1d4ed8' },
					accentHoverDark: { value: '#93c5fd' },
					accentForeground: { value: '#ffffff' },
					accentForegroundDark: { value: '#172554' }
				}
			},
			fonts: {
				sans: { value: ['"Google Sans"', '"Roboto"', 'system-ui', 'Arial', 'sans-serif'] },
				roboto: { value: ['"Roboto"', 'system-ui', 'sans-serif'] }
			},
			borderWidths: {
				hairline: { value: '1px' },
				control: { value: '1.5px' },
				strong: { value: '2px' }
			},
			fontSizes: {
				body: { value: '0.875rem' },
				subtitle: { value: '1rem' },
				label: { value: '0.75rem' },
				caption: { value: '0.6875rem' },
				tiny: { value: '0.5625rem' },
				compact: { value: '0.8125rem' },
				micro: { value: '0.625rem' },
				title: { value: '0.9375rem' },
				heading: { value: '1.125rem' },
				display: { value: '1.25rem' },
				pairing: { value: '1.35rem' }
			},
			fontWeights: {
				body: { value: '400' },
				interactive: { value: '500' },
				heading: { value: '600' },
				strong: { value: '700' }
			},
			lineHeights: {
				body: { value: '1.5' },
				caption: { value: '1rem' },
				compact: { value: '1.375' }
			},
			radii: {
				compact: { value: '0.375rem' },
				control: { value: '0.5rem' },
				card: { value: '0.75rem' },
				dialog: { value: '1rem' },
				sheet: { value: '1.5rem' },
				row: { value: '0.625rem' },
				action: { value: '0.4375rem' },
				checkbox: { value: '0.25rem' },
				knob: { value: '2px' },
				marker: { value: '3px' },
				pill: { value: '9999px' }
			},
			spacing: {
				'3xs': { value: '0.125rem' },
				'2xs': { value: '0.25rem' },
				xs: { value: '0.375rem' },
				sm: { value: '0.5rem' },
				md: { value: '0.75rem' },
				lg: { value: '1rem' },
				xl: { value: '1.25rem' },
				'2xl': { value: '1.5rem' },
				'3xl': { value: '2rem' },
				'4xl': { value: '2.5rem' },
				list: { value: '0.625rem' },
				action: { value: '0.4375rem' }
			},
			sizes: {
				indicator: { value: '3px' }
			},
			letterSpacings: {
				eyebrow: { value: '0.14em' },
				status: { value: '0.05em' },
				code: { value: '0.16em' }
			},
			animations: {
				cardIn: { value: 'cardIn 180ms ease-out backwards' }
			}
		},
		textStyles: {
			body: {
				value: { fontSize: 'body', fontWeight: 'body', lineHeight: 'body' }
			},
			bodyStrong: {
				value: { fontSize: 'body', fontWeight: 'heading', lineHeight: 'body' }
			},
			subtitle: {
				value: { fontSize: 'subtitle', fontWeight: 'interactive', lineHeight: 'body' }
			},
			subtitleStrong: {
				value: { fontSize: 'subtitle', fontWeight: 'heading', lineHeight: 'tight' }
			},
			bodyMuted: {
				value: {
					fontSize: 'body',
					fontWeight: 'body',
					lineHeight: 'body',
					color: 'scrapscache.textMuted'
				}
			},
			label: {
				value: { fontSize: 'label', fontWeight: 'interactive', lineHeight: 'compact' }
			},
			caption: {
				value: {
					fontSize: 'caption',
					fontWeight: 'body',
					lineHeight: 'caption',
					color: 'scrapscache.textMuted'
				}
			},
			captionStrong: {
				value: {
					fontSize: 'caption',
					fontWeight: 'interactive',
					lineHeight: 'caption',
					color: 'scrapscache.textMuted'
				}
			},
			title: {
				value: { fontSize: 'title', fontWeight: 'heading', lineHeight: 'tight' }
			},
			heading: {
				value: { fontSize: 'heading', fontWeight: 'heading', lineHeight: 'tight' }
			},
			display: {
				value: { fontSize: 'display', fontWeight: 'heading', lineHeight: 'tight' }
			},
			editorTitle: {
				value: { fontSize: 'display', fontWeight: 'interactive', lineHeight: 'tight' }
			},
			overline: {
				value: {
					fontSize: 'label',
					fontWeight: 'heading',
					lineHeight: 'compact',
					letterSpacing: 'wide',
					textTransform: 'uppercase',
					color: 'scrapscache.textMuted'
				}
			},
			button: {
				value: { fontSize: 'body', fontWeight: 'interactive', lineHeight: 'tight' }
			},
			micro: {
				value: { fontSize: 'micro', fontWeight: 'heading', lineHeight: 'compact' }
			}
		},
		semanticTokens: {
			colors: {
				scrapscache: {
					bg: {
						value: { base: '{colors.palette.background}', _dark: '{colors.palette.backgroundDark}' }
					},
					surface: {
						value: { base: '{colors.palette.surface}', _dark: '{colors.palette.surfaceDark}' }
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
					backdropSoft: {
						value: 'rgba(0, 0, 0, 0.3)'
					},
					backdropMuted: {
						value: 'rgba(0, 0, 0, 0.4)'
					},
					backdropOverlay: {
						value: 'rgba(0, 0, 0, 0.45)'
					},
					backdrop: {
						value: 'rgba(0, 0, 0, 0.5)'
					},
					mediaSurface: {
						value: '#000000'
					},
					mediaSurfaceStrong: {
						value: 'rgba(0, 0, 0, 0.85)'
					},
					mediaSurfaceHover: {
						value: 'rgba(0, 0, 0, 0.7)'
					},
					mediaSurfaceMuted: {
						value: 'rgba(0, 0, 0, 0.6)'
					},
					mediaSurfaceSoft: {
						value: 'rgba(0, 0, 0, 0.4)'
					},
					mediaText: {
						value: '#ffffff'
					},
					mediaTextStrong: {
						value: 'rgba(255, 255, 255, 0.9)'
					},
					mediaOutline: {
						value: 'rgba(255, 255, 255, 0.95)'
					},
					mediaTextMuted: {
						value: 'rgba(255, 255, 255, 0.7)'
					},
					mediaTextSoft: {
						value: 'rgba(255, 255, 255, 0.8)'
					},
					mediaTextFaint: {
						value: 'rgba(255, 255, 255, 0.6)'
					},
					mediaBorder: {
						value: 'rgba(255, 255, 255, 0.1)'
					},
					mediaBorderStrong: {
						value: 'rgba(255, 255, 255, 0.4)'
					},
					mediaBorderFaint: {
						value: 'rgba(255, 255, 255, 0.05)'
					},
					mediaControlHover: {
						value: 'rgba(255, 255, 255, 0.1)'
					},
					mediaControlActive: {
						value: 'rgba(255, 255, 255, 0.2)'
					},
					mediaSuccess: {
						value: '#34d399'
					},
					mediaWarning: {
						value: '#fcd34d'
					},
					mediaAccent: {
						value: '#93c5fd'
					},
					mediaDanger: {
						value: '#f87171'
					},
					mediaDangerSubtle: {
						value: 'rgba(244, 63, 94, 0.3)'
					},
					qrSurface: {
						value: '#ffffff'
					},
					documentSurface: {
						value: '#ffffff'
					},
					pinnedBorder: {
						value: 'rgba(251, 191, 36, 0.4)'
					},
					pinnedRing: {
						value: 'rgba(251, 191, 36, 0.5)'
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
						value: { base: '{colors.palette.accent}', _dark: '{colors.palette.accentDark}' }
					},
					accentHover: {
						value: {
							base: '{colors.palette.accentHover}',
							_dark: '{colors.palette.accentHoverDark}'
						}
					},
					accentForeground: {
						value: {
							base: '{colors.palette.accentForeground}',
							_dark: '{colors.palette.accentForegroundDark}'
						}
					},
					accentSubtle: {
						value: {
							base: 'color-mix(in srgb, {colors.palette.accent} 14%, {colors.palette.surface})',
							_dark:
								'color-mix(in srgb, {colors.palette.accentDark} 14%, {colors.palette.surfaceDark})'
						}
					},
					focus: {
						value: {
							base: '{colors.palette.accentHover}',
							_dark: '{colors.palette.accentHoverDark}'
						}
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
				},
				kanbanDrag: {
					value: '0 1px 2px rgba(0, 0, 0, 0.12)'
				},
				kanbanDragLifted: {
					value: '0 18px 40px -12px rgba(0, 0, 0, 0.45), 0 6px 14px -6px rgba(0, 0, 0, 0.3)'
				},
				cropMask: {
					value: '0 0 0 9999px rgba(0, 0, 0, 0.65)'
				},
				cropHandle: {
					value: '0 2px 6px rgba(0, 0, 0, 0.7), 0 0 0 1.5px rgba(0, 0, 0, 0.35)'
				},
				cropKnob: {
					value: '0 1px 3px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 0, 0, 0.25)'
				}
			}
		}
	}
};
