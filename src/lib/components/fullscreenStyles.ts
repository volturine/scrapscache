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
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
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
				title: {
					minW: 0,
					flex: '1',
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
					fontSize: 'body',
					fontWeight: 'interactive'
				},
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
