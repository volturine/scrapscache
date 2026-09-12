// Shared structural styles for fullscreen overlays (photo viewer, attachment preview).
// `photo` is the dark full-bleed viewer; `attachment` is the app-chrome file viewer.
import { sva } from 'styled-system/css';

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
					gap: '0.75rem',
					bgGradient: 'to-b',
					gradientFrom: 'black/75',
					gradientTo: 'transparent',
					px: '0.75rem',
					py: '0.5rem',
					backdropFilter: 'blur(2px)'
				},
				title: {
					minW: 0,
					flex: '1',
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
					fontSize: 'sm',
					fontWeight: 'medium',
					color: 'scrapscache.mediaTextStrong'
				},
				notice: {
					px: '1rem',
					pb: '0.75rem',
					textAlign: 'center',
					fontSize: 'xs',
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
					gap: '0.75rem',
					borderBottomWidth: '1px',
					borderColor: 'scrapscache.border',
					px: '0.75rem',
					py: '0.5rem'
				},
				title: {
					minW: 0,
					flex: '1',
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
					fontSize: 'sm',
					fontWeight: 'medium'
				},
				notice: {
					display: 'grid',
					flex: '1',
					placeItems: 'center',
					p: '1.5rem',
					fontSize: 'sm',
					color: 'scrapscache.textMuted'
				}
			}
		}
	},
	defaultVariants: { theme: 'attachment' }
});
