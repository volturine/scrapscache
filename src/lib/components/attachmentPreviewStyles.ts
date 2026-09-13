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
			rounded: 'card',
			borderWidth: 'hairline',
			borderColor: 'scrapscache.borderSubtle',
			bg: 'scrapscache.bg'
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
					gap: 'sm',
					overflowX: 'auto',
					px: 'md',
					pb: 'sm'
				},
				btn: { touchAction: 'manipulation', cursor: 'pointer' },
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
			display: 'flex',
			alignItems: 'center',
			gap: 'sm',
			borderWidth: 'hairline',
			borderColor: 'scrapscache.borderSubtle',
			bg: 'scrapscache.surfaceSubtle',
			px: 'sm',
			py: 'xs'
		},
		badge: {
			display: 'grid',
			flexShrink: 0,
			placeItems: 'center',
			bg: 'scrapscache.interactiveActive',
			fontWeight: 'strong',
			color: 'scrapscache.text'
		},
		title: {
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			whiteSpace: 'nowrap',
			color: 'scrapscache.text'
		},
		size: { fontSize: 'micro', color: 'scrapscache.textMuted' },
		openBtn: {
			minW: 0,
			flex: '1',
			textAlign: 'left',
			touchAction: 'manipulation',
			cursor: 'pointer'
		},
		removeBtn: {
			flexShrink: 0,
			rounded: 'pill',
			px: 'xs',
			py: '3xs',
			fontSize: 'label',
			color: 'scrapscache.textMuted',
			touchAction: 'manipulation',
			cursor: 'pointer',
			_hoverable: { bg: 'scrapscache.interactiveHover' }
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
