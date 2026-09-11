import { sva } from 'styled-system/css';

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
			rounded: 'lg',
			borderWidth: '1px',
			borderColor: { base: 'black/10', _dark: 'white/10' },
			bg: { base: 'white', _dark: 'slate.900' }
		},
		img: { h: 'full', w: 'full' },
		loading: {
			display: 'grid',
			h: 'full',
			w: 'full',
			placeItems: 'center',
			color: 'scrapscache.textMuted'
		},
		caption: {
			position: 'absolute',
			insetX: 0,
			bottom: 0,
			bgGradient: 'to-t',
			gradientFrom: 'black/65',
			gradientTo: 'transparent',
			px: '0.5rem',
			pb: '0.375rem',
			pt: '1.25rem',
			textAlign: 'left',
			color: 'white'
		},
		delBtn: {
			position: 'absolute',
			right: '0.25rem',
			top: '0.25rem',
			rounded: 'full',
			bg: 'black/60',
			px: '0.375rem',
			py: '0.125rem',
			fontSize: 'xs',
			color: 'white',
			touchAction: 'manipulation',
			cursor: 'pointer'
		}
	},
	variants: {
		mode: {
			editor: {
				strip: {
					display: 'flex',
					alignItems: 'center',
					maxH: '11rem',
					gap: '0.5rem',
					overflowX: 'auto',
					px: '0.75rem',
					pb: '0.5rem'
				},
				btn: { touchAction: 'manipulation', cursor: 'pointer' },
				img: { objectFit: 'contain' },
				loading: { fontSize: 'xs' },
				caption: { fontSize: '11px', fontWeight: 'medium' }
			},
			display: {
				strip: { mt: '0.5rem', display: 'grid', gap: '0.375rem' },
				img: { objectFit: 'cover' },
				loading: { fontSize: '11px' },
				caption: { fontSize: '10px', fontWeight: 'semibold' }
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
			display: 'flex',
			alignItems: 'center',
			gap: '0.5rem',
			borderWidth: '1px',
			borderColor: { base: 'black/10', _dark: 'white/10' },
			bg: { base: 'black/5', _dark: 'white/5' },
			px: '0.5rem',
			py: '0.375rem'
		},
		badge: {
			display: 'grid',
			flexShrink: 0,
			placeItems: 'center',
			bg: { base: 'black/10', _dark: 'white/10' },
			fontWeight: 'bold',
			color: 'scrapscache.text'
		},
		title: {
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			whiteSpace: 'nowrap',
			color: 'scrapscache.text'
		},
		size: { fontSize: '10px', color: 'scrapscache.textMuted' },
		openBtn: {
			minW: 0,
			flex: '1',
			textAlign: 'left',
			touchAction: 'manipulation',
			cursor: 'pointer'
		},
		removeBtn: {
			flexShrink: 0,
			rounded: 'full',
			px: '0.375rem',
			py: '0.125rem',
			fontSize: 'xs',
			color: 'scrapscache.textMuted',
			touchAction: 'manipulation',
			cursor: 'pointer',
			_hover: { bg: { base: 'black/5', _dark: 'white/10' } }
		}
	},
	variants: {
		mode: {
			editor: {
				list: {
					maxH: '9rem',
					gap: '0.375rem',
					overflowY: 'auto',
					px: '0.75rem',
					pb: '0.5rem',
					alignItems: 'stretch'
				},
				row: { rounded: 'lg' },
				badge: { h: '2rem', w: '2rem', rounded: 'md', fontSize: '10px', letterSpacing: 'wide' },
				title: { fontSize: 'sm' }
			},
			display: {
				list: { mt: '0.5rem', gap: '0.25rem' },
				row: { w: 'full', rounded: 'md', textAlign: 'left' },
				badge: { h: '1.75rem', w: '1.75rem', rounded: 'sm', fontSize: '9px' },
				title: { minW: 0, flex: '1', fontSize: 'xs' }
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
		btn: { display: 'block', overflow: 'hidden', rounded: 'lg' },
		img: { w: 'auto', objectFit: 'cover' },
		skeleton: {
			flexShrink: 0,
			animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
			rounded: 'lg',
			bg: { base: 'black/10', _dark: 'white/10' }
		},
		delBtn: {
			position: 'absolute',
			right: '0.375rem',
			top: '0.375rem',
			display: 'grid',
			h: '1.5rem',
			w: '1.5rem',
			placeItems: 'center',
			rounded: 'full',
			bg: 'black/60',
			color: 'white',
			touchAction: 'manipulation',
			cursor: 'pointer'
		}
	},
	variants: {
		mode: {
			editor: {
				strip: {
					alignItems: 'center',
					gap: '0.5rem',
					px: '0.75rem',
					pb: '0.5rem'
				},
				wrap: { position: 'relative' },
				btn: { h: '8rem', touchAction: 'manipulation', cursor: 'pointer' },
				img: { h: '8rem', maxW: '15rem' },
				skeleton: { h: '8rem', w: '8rem' }
			},
			display: {
				strip: { mt: '0.5rem', gap: '0.375rem' },
				wrap: { display: 'block', overflow: 'hidden', rounded: 'md' },
				img: { h: '6rem', maxW: '10rem', rounded: 'lg' },
				skeleton: { h: '6rem', w: '6rem' }
			}
		}
	},
	defaultVariants: { mode: 'display' }
});
