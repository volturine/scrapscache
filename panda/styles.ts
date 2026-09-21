/** Central visual contracts. Keep component styling in Panda and compose these classes in Svelte. */
import { css, cva } from 'styled-system/css';
import { center, flex, hstack, vstack } from 'styled-system/patterns';

const truncateText = {
	overflow: 'hidden',
	textOverflow: 'ellipsis',
	whiteSpace: 'nowrap'
} as const;
const square = <T extends string>(value: T) => ({ h: value, w: value });
const fullSize = square('full');
const flexFill = { minW: 0, flex: '1' } as const;
const flexPane = { minH: 0, flex: '1' } as const;
const column = { display: 'flex', flexDirection: 'column' } as const;
const iconSm = square('1rem');
const iconMd = square('1.25rem');
const iconXs = square('0.875rem');
const rowCenter = { display: 'flex', alignItems: 'center' } as const;
const rowGapSm = { ...rowCenter, gap: 'sm' } as const;
const rowGapMd = { ...rowCenter, gap: 'md' } as const;
const flexCenter = { display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;
const gridCenter = { display: 'grid', placeItems: 'center' } as const;
const clickable = { cursor: 'pointer' } as const;
const interactive = { cursor: 'pointer', touchAction: 'manipulation' } as const;
// Horizontal strips inside vertical scrollers must opt back into sideways touch pans.
const sidewaysScroller = {
	overflowX: 'auto',
	overscrollBehaviorX: 'contain',
	touchAction: 'pan-x pan-y'
} as const;
const mutedText = { color: 'scrapscache.textMuted' } as const;
const cardRadius = { rounded: 'card' } as const;
const controlRadius = { rounded: 'control' } as const;
const subtleHover = { _hoverable: { bg: 'scrapscache.interactiveHover' } } as const;
const mediaHover = {
	_hoverable: { bg: 'scrapscache.mediaControlHover', color: 'scrapscache.mediaText' }
} as const;
const border = { borderWidth: 'hairline', borderColor: 'scrapscache.border' } as const;
const subtleBorder = {
	borderWidth: 'hairline',
	borderColor: 'scrapscache.borderSubtle'
} as const;
const colorTransition = { transition: 'colors 120ms ease' } as const;
const mediaInteractive = { ...colorTransition, ...mediaHover } as const;
const absoluteCenterY = {
	position: 'absolute',
	top: '50%',
	transform: 'translateY(-50%)'
} as const;
const fullscreenShell = { inset: 0, zIndex: 80, ...column } as const;
const flexTruncate = { ...flexFill, ...truncateText } as const;
const flexTruncateClass = css(flexTruncate);
const kanbanColumnSize = {
	w: 'min(calc(var(--note-card-width) + 1.5rem), calc(100vw - 2rem))',
	flexShrink: 0
} as const;
const filterOption = {
	display: 'flex',
	gap: 'sm',
	...cardRadius,
	px: '2xs',
	py: '2xs',
	...clickable,
	_hoverable: { bg: 'scrapscache.surfaceSubtle' }
} as const;
const workspaceContent = {
	...rowGapMd,
	...flexFill,
	textAlign: 'left'
} as const;
const iconSmClass = css(iconSm);
const iconMdClass = css(iconMd);

export const iconSizeSm = iconSmClass;
export const iconSizeMd = iconMdClass;
export const iconSizeXs = css(iconXs);

export const truncate = css(truncateText);

// Application layout primitives
/** Shared page and feed layout classes. These are layout primitives, not component recipes. */
export const viewPage = css({ pt: 'lg', pb: '3xl' });

/** One width for the mobile drawer and the safe-area strip that continues it. */
const DRAWER_WIDTH = '18rem';

export const appLayout = {
	shell: css({
		...column,
		h: 'full',
		w: 'full',
		overflow: 'hidden',
		bg: 'scrapscache.bg',
		color: 'scrapscache.text'
	}),
	body: css({
		display: 'flex',
		flexDirection: 'row',
		minH: 0,
		minW: 0,
		flex: '1'
	}),
	// Catches taps outside the drawer without tinting the page behind it.
	backdrop: css({
		position: 'fixed',
		top: 'var(--app-topbar-height)',
		bottom: 0,
		left: 0,
		right: 0,
		zIndex: 20
	}),
	drawerPositioner: css({
		position: 'fixed',
		top: 'var(--app-topbar-height)',
		bottom: 0,
		left: 0,
		zIndex: 30,
		h: 'calc(100% - var(--app-topbar-height))'
	}),
	// No edge of its own: the surface is what sets the panel apart from the body,
	// and a border would stop where the frame does while the surface carries on.
	drawer: css({
		h: 'full',
		w: DRAWER_WIDTH,
		bg: 'scrapscache.surface'
	}),
	// The app frame stops at the safe rect, so an open drawer stops short of the
	// home indicator. This carries its surface the rest of the way down, across
	// the drawer's width only, so the panel reads as one piece.
	drawerSafeArea: css({
		position: 'fixed',
		left: 0,
		bottom: 0,
		w: `calc(${DRAWER_WIDTH} + var(--app-inset-left))`,
		h: 'var(--app-inset-bottom)',
		bg: 'scrapscache.surface',
		zIndex: 40,
		pointerEvents: 'none'
	}),
	// Same panel as the drawer on a phone: its surface is what sets it apart.
	sidebar: css({
		w: '16rem',
		flexShrink: 0,
		bg: 'scrapscache.surface'
	}),
	column: css({ ...column, minH: 0, minW: 0, flex: '1' }),
	canvas: css({ position: 'relative', minH: 0, minW: 0, flex: '1' }),
	feed: css({
		h: 'full',
		minH: 0,
		overflowY: 'auto',
		overflowX: 'hidden',
		px: 'lg',
		pb: { base: '3xl', md: '2xl' }
	})
};

const publicHeaderBase = {
	position: 'sticky',
	top: 0,
	zIndex: 20,
	borderBottomWidth: 'hairline',
	borderColor: 'scrapscache.border',
	bg: 'scrapscache.surface',
	backdropFilter: 'blur(4px)'
} as const;

const publicBadgeBase = {
	...rowCenter,
	gap: 'sm',
	...cardRadius,
	borderWidth: 'hairline',
	px: 'md',
	py: '2xs',
	fontSize: 'label',
	fontWeight: 'interactive'
} as const;

/** Shared contracts for the standalone legal, error, and support pages. */
export const publicPageStyles = {
	root: css({ minH: '100vh', bg: 'scrapscache.bg', color: 'scrapscache.text' }),
	header: css(publicHeaderBase),
	headerInner: hstack({
		mx: 'auto',
		w: 'full',
		maxW: '4xl',
		justifyContent: 'space-between',
		px: { base: 'lg', sm: 'xl' },
		py: 'sm'
	}),
	backLink: hstack({
		gap: 'sm',
		fontSize: 'body',
		fontWeight: 'interactive',
		...mutedText,
		...clickable,
		transition: 'color 120ms ease',
		_hoverable: { color: 'scrapscache.text' }
	}),
	iconSm: iconSmClass,
	mutedIcon: css({ ...iconSm, ...mutedText }),
	iconXs: css(iconXs),
	brand: css({ textStyle: 'overline', ...mutedText }),
	wideMain: css({
		mx: 'auto',
		w: 'full',
		maxW: '4xl',
		px: { base: 'lg', sm: 'xl' },
		py: { base: '4xl', sm: '6xl' }
	}),
	narrowMain: css({
		mx: 'auto',
		w: 'full',
		maxW: '2xl',
		px: { base: 'lg', sm: 'xl' },
		py: { base: 'page', sm: 'pageWide' },
		textAlign: 'center'
	}),
	intro: vstack({ gap: 'sm' }),
	privacyBadge: css({
		...publicBadgeBase,
		borderColor: 'scrapscache.success/20',
		bg: 'scrapscache.successSubtle',
		color: 'scrapscache.success'
	}),
	termsBadge: css({
		...publicBadgeBase,
		borderColor: 'scrapscache.accent/20',
		bg: 'scrapscache.accentSubtle',
		color: 'scrapscache.accent'
	}),
	badgeIcon: css({ ...iconXs, flexShrink: 0 }),
	warningIcon: css({ color: 'scrapscache.warning' }),
	pageTitle: css({
		mt: '2xs',
		fontSize: { base: 'pageTitle', sm: 'pageTitleWide' },
		fontWeight: 'strong',
		letterSpacing: 'tight'
	}),
	updated: css({ fontSize: 'body', ...mutedText }),
	sections: css({
		mt: '3xl',
		display: 'grid',
		gap: '3xl',
		fontSize: { base: 'body', sm: 'subtitle' },
		lineHeight: 'relaxed'
	}),
	section: css({
		...cardRadius,
		...border,
		bg: 'scrapscache.surface',
		p: { base: '2xl', sm: '3xl' }
	}),
	sectionHeading: hstack({
		gap: 'sm',
		fontSize: 'pageSection',
		fontWeight: 'heading',
		color: 'scrapscache.text'
	}),
	sectionIcon: css({ ...iconMd, flexShrink: 0, color: 'scrapscache.accent' }),
	sectionCopy: css({ mt: 'md', ...mutedText }),
	sectionList: css({
		mt: 'sm',
		display: 'grid',
		gap: '2xs',
		listStyleType: 'disc',
		listStylePosition: 'inside',
		...mutedText
	}),
	footer: flex({
		mt: 'page',
		flexWrap: 'wrap',
		align: 'center',
		justify: 'space-between',
		gap: 'lg',
		borderTopWidth: 'hairline',
		borderColor: 'scrapscache.border',
		pt: 'xl',
		fontSize: 'label',
		...mutedText
	}),
	footerLinks: hstack({ gap: '3xl' }),
	footerLink: css({
		textDecoration: 'underline',
		_hoverable: { color: 'scrapscache.text' }
	}),
	errorRoot: flex({
		minH: '100vh',
		direction: 'column',
		align: 'center',
		justify: 'center',
		px: 'lg',
		py: '4xl',
		textAlign: 'center'
	}),
	errorContent: flex({ maxW: 'md', direction: 'column', align: 'center' }),
	errorIcon: css({
		...gridCenter,
		...square('4rem'),
		mb: 'lg',
		...cardRadius,
		borderWidth: 'hairline',
		borderColor: 'scrapscache.border',
		bg: 'scrapscache.surface',
		...mutedText,
		boxShadow: 'sm'
	}),
	errorGlyph: css({ ...square('2rem') }),
	errorActionGlyph: css({ ...square('1rem') }),
	errorCode: css({ textStyle: 'overline' }),
	errorTitle: css({
		mt: '2xs',
		fontSize: { base: 'heading', sm: 'pageSection' },
		fontWeight: 'strong',
		letterSpacing: 'tight'
	}),
	errorMessage: css({ mt: 'sm', fontSize: 'body', lineHeight: 'relaxed', ...mutedText }),
	errorAction: css({ mt: '3xl', gap: 'sm', px: 'xl' }),
	thankYouMark: css({
		...gridCenter,
		...square('4rem'),
		mx: 'auto',
		...cardRadius,
		borderWidth: 'hairline',
		borderColor: 'scrapscache.danger/20',
		bg: 'scrapscache.dangerSubtle',
		color: 'scrapscache.danger'
	}),
	thankYouMarkGlyph: css({ ...square('2rem'), fill: 'currentColor', opacity: 0.2 }),
	thankYouTitle: css({
		mt: 'xl',
		fontSize: { base: 'pageTitle', sm: 'pageTitleWide' },
		fontWeight: 'strong',
		letterSpacing: 'tight'
	}),
	thankYouLead: css({ mt: 'lg', fontSize: 'subtitle', lineHeight: 'relaxed', ...mutedText }),
	supportCard: css({
		mt: '4xl',
		...cardRadius,
		...border,
		bg: 'scrapscache.surface',
		p: { base: '2xl', sm: '3xl' },
		textAlign: 'left'
	}),
	supportTitle: css({ fontSize: 'heading', fontWeight: 'heading' }),
	supportList: css({
		mt: 'xl',
		display: 'grid',
		gap: 'lg',
		fontSize: 'body',
		...mutedText
	}),
	supportItem: hstack({ alignItems: 'flex-start', gap: 'sm' }),
	supportIcon: css({ mt: '3xs', ...iconSm, flexShrink: 0 }),
	supportStar: css({ color: 'scrapscache.warning' }),
	supportShield: css({ color: 'scrapscache.success' }),
	supportHeart: css({ color: 'scrapscache.danger' }),
	supportStrong: css({ fontWeight: 'interactive', color: 'scrapscache.text' }),
	supportActions: css({
		mt: 'xl',
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'center',
		gap: 'sm',
		borderTopWidth: 'hairline',
		borderColor: 'scrapscache.border',
		pt: 'xl'
	}),
	supportExternalIcon: css({ opacity: 0.7 }),
	thankYouFooter: css({ mt: 'page', fontSize: 'label', ...mutedText })
};

/** Operator dashboard layout contracts; controls still use the shared recipes. */
export const adminPageStyles = {
	root: css({ minH: '100dvh', p: { base: 'lg', sm: '3xl' } }),
	content: vstack({ mx: 'auto', w: 'full', maxW: '5xl', gap: '3xl', alignItems: 'stretch' }),
	header: hstack({ alignItems: 'baseline', justifyContent: 'space-between', gap: 'lg' }),
	headerActions: hstack({ gap: 'md', fontSize: 'body' }),
	title: css({ fontSize: 'pageSection', fontWeight: 'heading' }),
	loading: css({ ...mutedText }),
	error: css({ fontSize: 'body', color: 'scrapscache.danger' }),
	signIn: vstack({ maxW: 'sm', gap: 'sm', alignItems: 'stretch' }),
	field: vstack({ gap: '2xs', fontSize: 'body', alignItems: 'stretch' }),
	fieldLabel: css({ display: 'block', ...mutedText }),
	fieldInput: css({ w: 'full' }),
	statGrid: css({
		display: 'grid',
		gap: 'sm',
		gridTemplateColumns: {
			base: 'minmax(0, 1fr)',
			sm: 'repeat(2, minmax(0, 1fr))',
			lg: 'repeat(4, minmax(0, 1fr))'
		}
	}),
	statCard: css({ ...cardRadius, ...border, p: 'md' }),
	statLabel: css({ fontSize: 'body', ...mutedText }),
	statValue: css({ fontSize: 'heading', fontWeight: 'heading' }),
	statCaption: css({ fontSize: 'caption', ...mutedText }),
	section: css({ display: 'grid', gap: 'sm', ...cardRadius, ...border, p: 'lg' }),
	sectionTitle: css({ fontSize: 'heading', fontWeight: 'heading' }),
	sectionDescription: css({ fontSize: 'body', ...mutedText }),
	settingsForm: css({
		display: 'grid',
		gap: 'sm',
		gridTemplateColumns: {
			base: 'minmax(0, 1fr)',
			sm: 'repeat(2, minmax(0, 1fr))',
			lg: 'repeat(3, minmax(0, 1fr))'
		}
	}),
	settingsSubmit: css({
		display: 'flex',
		alignItems: 'flex-end',
		gridColumn: { base: 'auto', sm: 'span 2', lg: 'span 3' }
	}),
	accounts: css({ display: 'grid', gap: 'sm' }),
	accountControls: hstack({ flexWrap: 'wrap', gap: 'sm' }),
	tableWrap: css({ overflowX: 'auto', ...cardRadius, ...border }),
	table: css({ w: 'full', borderCollapse: 'collapse', textAlign: 'left', fontSize: 'body' }),
	tableHead: css({ ...mutedText }),
	tableHeading: css({ p: 'sm', fontWeight: 'interactive' }),
	tableRow: css({
		cursor: 'pointer',
		borderTopWidth: 'hairline',
		borderColor: 'scrapscache.border',
		_hoverable: { bg: 'scrapscache.interactiveHover' }
	}),
	tableCell: css({ p: 'sm' }),
	accountId: css({ fontFamily: 'mono', fontSize: 'label', wordBreak: 'break-all' }),
	emptyCell: css({ p: 'md', ...mutedText }),
	pagination: hstack({ gap: 'sm', fontSize: 'body' }),
	selected: css({ display: 'grid', gap: 'sm', ...cardRadius, ...border, p: 'lg' }),
	selectedHeader: hstack({ alignItems: 'baseline', justifyContent: 'space-between', gap: 'md' }),
	selectedId: css({ fontFamily: 'mono', fontSize: 'body', wordBreak: 'break-all' }),
	selectedForm: css({ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 'md' }),
	selectedHint: css({ fontSize: 'caption', ...mutedText })
};

export const importGuideStyles = {
	source: css({
		p: 'md',
		borderWidth: 'hairline',
		borderColor: 'scrapscache.border',
		rounded: 'card',
		bg: 'scrapscache.bg'
	}),
	sourceTitle: hstack({ gap: 'sm', fontWeight: 'interactive' }),
	sourceIcon: css({
		...gridCenter,
		w: '1.75rem',
		h: '1.75rem',
		rounded: 'control',
		bg: 'scrapscache.accentSubtle',
		color: 'scrapscache.accent'
	}),
	steps: css({
		display: 'grid',
		gap: 'sm',
		mt: 'md',
		p: 0,
		listStyle: 'none',
		counterReset: 'step'
	}),
	step: css({
		display: 'flex',
		alignItems: 'center',
		gap: 'sm',
		fontSize: 'compact',
		counterIncrement: 'step',
		'&::before': {
			content: 'counter(step)',
			...gridCenter,
			w: '1.25rem',
			h: '1.25rem',
			flexShrink: 0,
			rounded: 'pill',
			bg: 'scrapscache.interactiveHover',
			color: 'scrapscache.textMuted',
			fontSize: 'label',
			fontWeight: 'heading'
		}
	}),
	note: css({ mt: 'md', color: 'scrapscache.textMuted', textStyle: 'caption', lineHeight: 'body' }),
	noteStrong: css({ color: 'scrapscache.text', fontWeight: 'interactive' })
};

export const pwaStyles = {
	iosPortal: css({
		position: 'fixed',
		inset: 0,
		zIndex: 70,
		display: 'flex',
		alignItems: { base: 'flex-end', sm: 'center' },
		justifyContent: 'center',
		bg: 'scrapscache.backdrop',
		p: 'lg',
		backdropFilter: 'blur(4px)'
	}),
	iosPanel: css({
		w: 'full',
		maxW: '24rem',
		rounded: 'dialog',
		borderWidth: 'hairline',
		borderColor: 'scrapscache.border',
		bg: 'scrapscache.surface',
		p: 'xl',
		color: 'scrapscache.text',
		boxShadow: 'dialog'
	}),
	iosHeader: css({
		...rowCenter,
		justifyContent: 'space-between',
		borderBottomWidth: 'hairline',
		borderColor: 'scrapscache.border',
		pb: 'md'
	}),
	iosTitle: hstack({ gap: 'sm', fontSize: 'compact', fontWeight: 'heading' }),
	iosClose: css({
		...gridCenter,
		rounded: 'control',
		p: 'xs',
		...mutedText,
		...clickable,
		_hoverable: { bg: 'scrapscache.interactiveHover' }
	}),
	iosSteps: vstack({
		gap: 'md',
		mt: 'xl',
		alignItems: 'stretch',
		fontSize: 'label',
		lineHeight: 'relaxed',
		color: 'scrapscache.textMuted'
	}),
	iosStep: hstack({ alignItems: 'flex-start', gap: 'sm' }),
	iosStepNumber: css({
		...gridCenter,
		w: '1.25rem',
		h: '1.25rem',
		flexShrink: 0,
		rounded: 'pill',
		bg: 'scrapscache.accentSubtle',
		color: 'scrapscache.accent',
		fontWeight: 'strong'
	}),
	iosAction: css({ color: 'scrapscache.text', fontWeight: 'interactive' }),
	iosDone: css({
		mt: 'xl',
		w: 'full',
		py: 'sm',
		rounded: 'control',
		bg: 'scrapscache.accent',
		color: 'scrapscache.accentForeground',
		textStyle: 'label',
		fontWeight: 'heading',
		...clickable,
		_hoverable: { opacity: 0.9 }
	})
};

const notesShellBase = css({
	w: 'full',
	mx: 'auto'
});
const notesListShell = css({ maxW: '720px' });

export function notesShell(layout: 'grid' | 'list' = 'grid'): string {
	return layout === 'list' ? `${notesShellBase} ${notesListShell}` : notesShellBase;
}

export const popover = css({
	...border,
	bg: 'scrapscache.surface',
	...cardRadius,
	boxShadow: 'popover'
});

export const tooltip = css({
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
});

export const sectionHeaderStyles = {
	row: hstack({ mb: 'md', gap: 'md', px: 'sm' }),
	label: css({ textStyle: 'overline' }),
	count: css({ textStyle: 'caption', opacity: 0.6 }),
	spacer: css({ flex: '1' })
};

const progressTrack = {
	h: '0.375rem',
	overflow: 'hidden',
	rounded: 'pill',
	bg: 'scrapscache.interactiveActive'
} as const;
const progressBar = {
	h: 'full',
	bg: 'scrapscache.accent',
	transition: 'width 150ms ease'
} as const;

export const progressMeter = {
	track: css(progressTrack),
	bar: css(progressBar),
	compact: {
		track: css({ ...progressTrack, h: '0.25rem' }),
		bar: css({ ...progressBar, transition: 'width 1000ms linear' })
	}
};

// Attachment preview contracts. Modes are fixed by their host component, so a
// class map avoids creating a runtime SVA for values that never change.
const canvasPreviewBase = {
	wrap: { position: 'relative', w: '9rem', flexShrink: 0 },
	btn: {
		position: 'relative',
		display: 'block',
		aspectRatio: '4/3',
		w: 'full',
		overflow: 'hidden',
		...cardRadius,
		...subtleBorder,
		bg: 'scrapscache.bg'
	},
	img: fullSize,
	loading: { ...gridCenter, ...fullSize, ...mutedText },
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
		...interactive
	}
} as const;
const canvasPreviewEditor = {
	strip: { ...rowCenter, ...sidewaysScroller, maxH: '11rem', gap: 'sm', px: 'md', pb: 'sm' },
	btn: { ...interactive },
	img: { objectFit: 'contain' },
	loading: { fontSize: 'label' },
	caption: { fontSize: 'caption', fontWeight: 'interactive' }
} as const;
const canvasPreviewDisplay = {
	strip: { mt: 'sm', display: 'grid', gap: 'xs' },
	img: { objectFit: 'cover' },
	loading: { fontSize: 'caption' },
	caption: { fontSize: 'micro', fontWeight: 'heading' }
} as const;
export const canvasPreview = {
	editor: {
		strip: css(canvasPreviewEditor.strip),
		wrap: css(canvasPreviewBase.wrap),
		btn: css({ ...canvasPreviewBase.btn, ...canvasPreviewEditor.btn }),
		img: css({ ...canvasPreviewBase.img, ...canvasPreviewEditor.img }),
		loading: css({ ...canvasPreviewBase.loading, ...canvasPreviewEditor.loading }),
		caption: css({ ...canvasPreviewBase.caption, ...canvasPreviewEditor.caption }),
		delBtn: css(canvasPreviewBase.delBtn)
	},
	display: {
		strip: css(canvasPreviewDisplay.strip),
		wrap: css(canvasPreviewBase.wrap),
		btn: css(canvasPreviewBase.btn),
		img: css({ ...canvasPreviewBase.img, ...canvasPreviewDisplay.img }),
		loading: css({ ...canvasPreviewBase.loading, ...canvasPreviewDisplay.loading }),
		caption: css({ ...canvasPreviewBase.caption, ...canvasPreviewDisplay.caption }),
		delBtn: css(canvasPreviewBase.delBtn)
	}
};

const filePreviewBase = {
	row: {
		...rowGapSm,
		...subtleBorder,
		bg: 'scrapscache.surfaceSubtle',
		px: 'sm',
		py: 'xs'
	},
	badge: {
		...gridCenter,
		flexShrink: 0,
		bg: 'scrapscache.interactiveActive',
		fontWeight: 'strong'
	},
	size: { fontSize: 'micro', ...mutedText },
	openBtn: { ...flexFill, textAlign: 'left', ...interactive },
	removeBtn: {
		flexShrink: 0,
		rounded: 'pill',
		px: 'xs',
		py: '3xs',
		fontSize: 'label',
		...mutedText,
		...interactive,
		...subtleHover
	}
} as const;
const filePreviewEditor = {
	list: {
		...column,
		maxH: '9rem',
		gap: 'xs',
		overflowY: 'auto',
		px: 'md',
		pb: 'sm',
		alignItems: 'stretch'
	},
	row: { rounded: 'card' },
	badge: { ...square('2rem'), rounded: 'control', fontSize: 'micro', letterSpacing: 'wide' },
	title: { ...truncateText, fontSize: 'body' }
} as const;
const filePreviewDisplay = {
	list: { ...column, mt: 'sm', gap: '2xs' },
	row: { w: 'full', rounded: 'control', textAlign: 'left' },
	badge: { h: '1.75rem', w: '1.75rem', rounded: 'compact', fontSize: 'tiny' },
	title: { ...truncateText, ...flexFill, fontSize: 'label' }
} as const;
const filePreviewShared = {
	size: css(filePreviewBase.size),
	openBtn: css(filePreviewBase.openBtn),
	removeBtn: css(filePreviewBase.removeBtn)
};
export const filePreview = {
	editor: {
		list: css(filePreviewEditor.list),
		row: css({ ...filePreviewBase.row, ...filePreviewEditor.row }),
		badge: css({ ...filePreviewBase.badge, ...filePreviewEditor.badge }),
		title: css(filePreviewEditor.title),
		...filePreviewShared
	},
	display: {
		list: css(filePreviewDisplay.list),
		row: css({ ...filePreviewBase.row, ...filePreviewDisplay.row }),
		badge: css({ ...filePreviewBase.badge, ...filePreviewDisplay.badge }),
		title: css(filePreviewDisplay.title),
		...filePreviewShared
	}
};

const photoPreviewBase = {
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
		...gridCenter,
		...square('1.5rem'),
		rounded: 'pill',
		bg: 'scrapscache.mediaSurfaceMuted',
		color: 'scrapscache.mediaText',
		...interactive
	}
} as const;
const photoPreviewEditor = {
	strip: { ...sidewaysScroller, alignItems: 'center', gap: 'sm', px: 'md', pb: 'sm' },
	wrap: { position: 'relative' },
	btn: { h: '8rem' },
	img: { h: '8rem', maxW: '15rem' },
	skeleton: { h: '8rem', w: '8rem' }
} as const;
const photoPreviewEditorFill = {
	strip: { alignItems: 'stretch', minH: 0, flex: '1', pb: 'sm' },
	wrap: { h: 'full' },
	btn: { h: 'full' },
	img: { h: 'full', maxW: 'none' },
	skeleton: { aspectRatio: '1 / 1', h: 'full' }
} as const;
const photoPreviewDisplay = {
	strip: { mt: 'sm', gap: 'xs' },
	wrap: { display: 'block', overflow: 'hidden', rounded: 'control' },
	img: { h: '6rem', maxW: '10rem', rounded: 'card' },
	skeleton: { h: '6rem', w: '6rem' }
} as const;
export const photoPreview = {
	editor: {
		strip: css({ ...photoPreviewBase.strip, ...photoPreviewEditor.strip }),
		wrap: css({ ...photoPreviewBase.wrap, ...photoPreviewEditor.wrap }),
		btn: css({ ...photoPreviewBase.btn, ...photoPreviewEditor.btn, ...interactive }),
		img: css({ ...photoPreviewBase.img, ...photoPreviewEditor.img }),
		skeleton: css({ ...photoPreviewBase.skeleton, ...photoPreviewEditor.skeleton }),
		delBtn: css(photoPreviewBase.delBtn)
	},
	editorFill: {
		strip: css({
			...photoPreviewBase.strip,
			...photoPreviewEditor.strip,
			...photoPreviewEditorFill.strip
		}),
		wrap: css({
			...photoPreviewBase.wrap,
			...photoPreviewEditor.wrap,
			...photoPreviewEditorFill.wrap
		}),
		btn: css({
			...photoPreviewBase.btn,
			...photoPreviewEditor.btn,
			...photoPreviewEditorFill.btn,
			...interactive
		}),
		img: css({ ...photoPreviewBase.img, ...photoPreviewEditor.img, ...photoPreviewEditorFill.img }),
		skeleton: css({
			...photoPreviewBase.skeleton,
			...photoPreviewEditor.skeleton,
			...photoPreviewEditorFill.skeleton
		}),
		delBtn: css(photoPreviewBase.delBtn)
	},
	display: {
		strip: css({ ...photoPreviewBase.strip, ...photoPreviewDisplay.strip }),
		wrap: css({ ...photoPreviewBase.wrap, ...photoPreviewDisplay.wrap }),
		btn: css(photoPreviewBase.btn),
		img: css({ ...photoPreviewBase.img, ...photoPreviewDisplay.img }),
		skeleton: css({ ...photoPreviewBase.skeleton, ...photoPreviewDisplay.skeleton }),
		delBtn: css(photoPreviewBase.delBtn)
	}
};

// Fullscreen themes are fixed by their host component, so keep them as static
// slot maps instead of a runtime SVA.
const fullscreenPhoto = {
	shell: {
		position: 'absolute',
		...fullscreenShell,
		bg: 'scrapscache.mediaSurface',
		color: 'scrapscache.mediaText'
	},
	header: {
		position: 'absolute',
		insetX: 0,
		top: 0,
		zIndex: 20,
		...rowCenter,
		h: '3.5rem',
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
		...flexTruncate,
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
} as const;
const fullscreenAttachment = {
	shell: {
		position: 'fixed',
		...fullscreenShell,
		bg: 'scrapscache.bg'
	},
	header: {
		...rowCenter,
		flexShrink: 0,
		gap: 'md',
		borderBottomWidth: 'hairline',
		borderColor: 'scrapscache.border',
		px: 'md',
		py: 'sm'
	},
	title: { ...flexTruncate, fontSize: 'body', fontWeight: 'interactive' },
	notice: {
		display: 'grid',
		flex: '1',
		placeItems: 'center',
		p: '2xl',
		fontSize: 'body',
		color: 'scrapscache.textMuted'
	}
} as const;
export const fullscreen = {
	photo: {
		shell: css(fullscreenPhoto.shell),
		header: css(fullscreenPhoto.header),
		title: css(fullscreenPhoto.title),
		notice: css(fullscreenPhoto.notice)
	},
	attachment: {
		shell: css(fullscreenAttachment.shell),
		header: css(fullscreenAttachment.header),
		title: css(fullscreenAttachment.title),
		notice: css(fullscreenAttachment.notice)
	}
};

// Static view contracts stay class maps; CVA below is reserved for live state.
export const kanbanViewStyles = {
	controls: css({ mb: 'lg', minH: '2.5rem', ...rowCenter }),
	// The trigger and the rename field share one box, so renaming never nudges the board.
	boardTrigger: css({
		...rowCenter,
		minW: 0,
		maxW: 'full',
		h: '2.5rem',
		gap: 'xs',
		ml: '-sm',
		rounded: 'control',
		px: 'sm',
		textStyle: 'heading',
		outline: 'none',
		...clickable,
		touchAction: 'manipulation',
		WebkitTapHighlightColor: 'transparent',
		transition: 'background-color 120ms ease',
		...subtleHover,
		_focusVisible: { bg: 'scrapscache.interactiveHover' },
		'&[data-state=open]': { bg: 'scrapscache.interactiveHover' }
	}),
	boardName: css(truncateText),
	boardChevron: css({
		flexShrink: 0,
		...iconSm,
		...mutedText,
		transition: 'transform 150ms ease',
		'[data-state=open] > &': { transform: 'rotate(180deg)' }
	}),
	boardInput: css({
		w: '20rem',
		maxW: 'full',
		h: '2.5rem',
		ml: '-sm',
		rounded: 'control',
		bg: 'scrapscache.interactiveHover',
		px: 'sm',
		textStyle: 'heading'
	}),
	// Ark copies the content's z-index onto the positioner, so it lives here.
	boardMenuContent: css({
		zIndex: 30,
		w: '16rem',
		maxH: '24rem',
		overflowY: 'auto',
		py: '2xs',
		outline: 'none'
	}),
	boardMenuGroupLabel: css({
		px: 'md',
		pt: 'xs',
		pb: '2xs',
		textStyle: 'captionStrong',
		textTransform: 'uppercase',
		letterSpacing: 'eyebrow'
	}),
	boardMenuName: css({ minW: 0, flex: '1', ...truncateText }),
	boardMenuCheck: css({ flexShrink: 0, ...iconSm, color: 'scrapscache.accent' }),
	boardMenuSeparator: css({
		my: '2xs',
		borderTopWidth: 'hairline',
		borderColor: 'scrapscache.border'
	}),
	boardMenuDanger: css({
		color: 'scrapscache.danger',
		_hoverable: { bg: 'scrapscache.dangerSubtle' },
		_focusVisible: { bg: 'scrapscache.dangerSubtle' }
	}),
	deletePositioner: css({
		position: 'absolute',
		inset: 0,
		display: 'flex',
		alignItems: { base: 'flex-end', sm: 'center' },
		justifyContent: 'center',
		p: 'lg'
	}),
	columnsContainer: css({
		display: 'block',
		mx: '-1rem',
		overflowX: 'auto',
		overscrollBehaviorX: 'contain',
		WebkitOverflowScrolling: 'touch',
		px: 'lg',
		pb: 'lg'
	}),
	columnsTrack: flex({ minW: 'max-content', align: 'flex-start', gap: 'md' }),
	column: css({ ...kanbanColumnSize, rounded: 'sheet', bg: 'scrapscache.surfaceSubtle', p: 'md' }),
	columnTarget: css({
		boxShadow:
			'inset 0 0 0 2px color-mix(in srgb, token(colors.scrapscache.accent) 35%, transparent)'
	}),
	colHeader: css({ mb: 'sm', ...rowGapSm, px: '2xs', pt: '2xs' }),
	colTitle: css({ minW: 0, flex: '1', ...truncateText, textStyle: 'bodyStrong' }),
	cardsList: css({ position: 'relative', ...column, gap: 'md' }),
	dropSlot: css({
		...cardRadius,
		borderWidth: 'strong',
		borderStyle: 'dashed',
		borderColor: 'color-mix(in srgb, token(colors.scrapscache.accent) 45%, transparent)',
		bg: 'color-mix(in srgb, token(colors.scrapscache.accent) 8%, transparent)'
	}),
	emptyDrop: css({
		...cardRadius,
		borderWidth: 'hairline',
		borderStyle: 'dashed',
		borderColor: 'scrapscache.borderSubtle',
		px: 'md',
		py: 'xl',
		textAlign: 'center',
		textStyle: 'caption'
	}),
	backlogGroup: flex({
		mb: 'sm',
		direction: 'column',
		gap: 'sm',
		...cardRadius,
		borderWidth: 'hairline',
		borderColor: 'scrapscache.borderSubtle',
		bg: 'scrapscache.surface',
		p: 'sm',
		fontSize: 'label'
	}),
	filterIndent: flex({
		ml: '2xs',
		direction: 'column',
		gap: '2xs',
		borderLeftWidth: 'strong',
		borderColor: 'scrapscache.borderSubtle',
		pl: 'sm'
	}),
	addColWrap: css({ position: 'relative', ...kanbanColumnSize, pt: '2xs' }),
	radioOption: css({ ...filterOption, alignItems: 'flex-start' }),
	checkRow: css({ ...filterOption, alignItems: 'center' }),
	checkControl: css({
		...flexCenter,
		...iconSm,
		rounded: 'compact',
		...border,
		'&[data-state=checked]': { borderColor: 'scrapscache.accent', bg: 'scrapscache.accent' }
	}),
	checkMark: css({ fontSize: 'micro', color: 'scrapscache.accentForeground' }),
	filterSummary: css({ ...truncateText, px: '2xs', textStyle: 'micro' }),
	menuItem: css({
		display: 'block',
		w: 'full',
		...truncateText,
		px: 'md',
		py: 'sm',
		textAlign: 'left',
		...subtleHover
	}),
	explain: css({ textStyle: 'caption' }),
	radioInput: css({ mt: '3xs' }),
	radioTitle: css({ textStyle: 'button' }),
	radioSubtitle: css({ mt: '3xs', display: 'block', textStyle: 'caption' }),
	tagLabel: css(truncateText),
	emptyTags: css({ px: '2xs', py: '2xs', ...mutedText }),
	tagPickerPositioner: css({ zIndex: 20, w: 'var(--reference-width)' }),
	tagPickerContent: css({ maxH: '16rem', overflowY: 'auto', py: '2xs' }),
	dragGhost: css({
		position: 'fixed',
		top: 0,
		left: 0,
		zIndex: 200,
		pointerEvents: 'none',
		willChange: 'transform'
	}),
	dragGhostCard: css({
		...cardRadius,
		transform: 'scale(1) rotate(0deg)',
		boxShadow: 'kanbanDrag',
		transition: 'transform 160ms cubic-bezier(0.2, 0.8, 0.3, 1.1), box-shadow 160ms ease',
		'&[data-lifted=true]': {
			transform: 'scale(1.04) rotate(-1.5deg)',
			boxShadow: 'kanbanDragLifted'
		},
		_motionReduce: { transition: 'none' }
	})
};

// WorkspaceRow contracts
export const workspaceStyles = {
	row: css({
		position: 'relative',
		rounded: 'row',
		overflow: 'visible',
		'& button:disabled': { opacity: 0.55 },
		'&.editing .front': { bg: 'scrapscache.interactiveHover' },
		'@media (hover: hover)': { '&:hover .front': { bg: 'scrapscache.interactiveHover' } }
	}),
	frontBase: css({
		position: 'relative',
		zIndex: 1,
		display: 'flex',
		alignItems: 'stretch',
		rounded: 'row',
		bg: 'scrapscache.surface',
		'&.active': {
			bg: 'scrapscache.interactiveHover',
			'&::before': {
				content: '""',
				position: 'absolute',
				top: 'list',
				bottom: 'list',
				left: 0,
				w: '3px',
				borderTopRightRadius: 'marker',
				borderBottomRightRadius: 'marker',
				bg: 'scrapscache.accent'
			}
		}
	}),
	select: css({
		...workspaceContent,
		py: 'md',
		pl: 'md',
		pr: 'md'
	}),
	menu: css({ display: 'grid', gap: '3xs', p: 'xs' }),
	manageRow: css({
		...rowGapMd,
		w: 'full',
		...clickable,
		rounded: 'action',
		px: 'sm',
		py: 'action',
		textAlign: 'left',
		fontSize: 'compact',
		_hoverable: { bg: 'scrapscache.interactiveHover' },
		'& span': { minW: 0, flex: '1' },
		'& small': { display: 'block', mt: '3xs', ...mutedText, textStyle: 'caption' }
	}),
	manageRowDanger: css({ color: 'scrapscache.danger' }),
	chevron: css({ display: 'grid', transition: 'transform 160ms ease' }),
	chevronOpen: css({ transform: 'rotate(180deg)' }),
	panel: css({
		...workspaceContent,
		p: 'md',
		'&.confirm': {
			bg: 'scrapscache.dangerSubtle',
			rounded: 'row',
			flexWrap: { base: 'wrap' },
			'& .panel-glyph': { color: 'scrapscache.danger' },
			'& .panel-actions': { w: { base: '100%' }, justifyContent: { base: 'flex-end' } }
		}
	}),
	glyph: css({ ...gridCenter, flexShrink: 0, ...mutedText }),
	content: css(flexFill),
	caption: css({ display: 'block', mt: '3xs', textStyle: 'caption' }),
	iconButton: css({
		...gridCenter,
		w: '30px',
		h: '30px',
		rounded: 'action',
		...mutedText,
		...subtleHover
	})
};

const workspacePanelBtnBase = {
	py: 'action',
	px: 'md',
	rounded: 'action',
	fontSize: 'compact',
	whiteSpace: 'nowrap'
} as const;
export const workspacePanelBtn = {
	neutral: css({ ...workspacePanelBtnBase, _hoverable: { bg: 'scrapscache.interactiveHover' } }),
	danger: css({
		...workspacePanelBtnBase,
		bg: 'scrapscache.danger',
		color: 'scrapscache.dangerForeground',
		fontWeight: 'interactive'
	})
};

const wheelItemBase = { ...flexCenter, fontVariantNumeric: 'tabular-nums', ...clickable };
export const wheelItem = {
	center: css({ ...wheelItemBase, textStyle: 'subtitleStrong' }),
	adjacent: css({ ...wheelItemBase, textStyle: 'button', ...mutedText }),
	far: css({ ...wheelItemBase, fontSize: 'body', ...mutedText, opacity: 0.4 })
};

// ReminderLabel contracts

const overdueLabel = {
	bg: 'scrapscache.overdueStrong',
	fontWeight: 'interactive',
	color: 'scrapscache.mediaText'
} as const;
const inlineOverdueLabel = { fontWeight: 'interactive', color: 'scrapscache.overdue' } as const;

export const reminderRoot = cva({
	base: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '2xs',
		textStyle: 'caption'
	},
	variants: {
		variant: {
			strip: { w: 'full', borderTopRadius: 'lg', px: 'md', py: '2xs' },
			chip: { maxW: 'full', rounded: 'pill', px: 'list', py: '2xs' },
			inline: {}
		},
		overdue: {
			true: {}
		}
	},
	compoundVariants: [
		{
			variant: 'strip',
			overdue: false,
			css: { bg: 'scrapscache.surfaceSubtle', ...mutedText }
		},
		{ variant: 'strip', overdue: true, css: overdueLabel },
		{
			variant: 'chip',
			overdue: false,
			css: { bg: 'scrapscache.interactiveActive', ...mutedText }
		},
		{ variant: 'chip', overdue: true, css: overdueLabel },
		{ variant: 'inline', overdue: false, css: mutedText },
		{ variant: 'inline', overdue: true, css: inlineOverdueLabel }
	]
});

// PhotoFullscreen contracts are static classes; finite state choices use explicit maps.
export const photoStyles = {
	cropRoot: css({
		position: 'relative',
		zIndex: 1,
		...flexPane,
		...column,
		'& [data-part="viewport"]': {
			position: 'relative',
			overflow: 'visible',
			touchAction: 'none',
			userSelect: 'none'
		},
		'& [data-part="image"]': { position: 'absolute', maxWidth: 'none', userSelect: 'none' },
		'& [data-part="selection"]': {
			boxShadow: 'cropMask',
			outlineWidth: '1.5px',
			outlineStyle: 'solid',
			outlineColor: 'scrapscache.mediaOutline'
		},
		'& [data-part="handle"]': {
			...gridCenter,
			zIndex: 10,
			background: 'transparent',
			touchAction: 'none',
			userSelect: 'none',
			WebkitUserSelect: 'none',
			WebkitTapHighlightColor: 'transparent'
		},
		'& [data-part="handle"][data-position="nw"], & [data-part="handle"][data-position="ne"], & [data-part="handle"][data-position="se"], & [data-part="handle"][data-position="sw"]':
			{ w: '3.5rem', h: '3.5rem', zIndex: 20 },
		'& [data-part="handle"][data-position="n"], & [data-part="handle"][data-position="s"]': {
			h: '3.5rem',
			zIndex: 10
		},
		'& [data-part="handle"][data-position="w"], & [data-part="handle"][data-position="e"]': {
			w: '3.5rem',
			zIndex: 10
		},
		'& [data-part="handle"]:hover .crop-knob, & [data-part="handle"]:active .crop-knob': {
			transform: 'scale(1.35)',
			boxShadow: 'cropHandle'
		},
		'& [data-part="grid"][data-axis="horizontal"]': {
			borderBottomWidth: 'hairline',
			borderTopWidth: 'hairline',
			borderColor: 'scrapscache.mediaBorderStrong'
		},
		'& [data-part="grid"][data-axis="vertical"]': {
			borderLeftWidth: 'hairline',
			borderRightWidth: 'hairline',
			borderColor: 'scrapscache.mediaBorderStrong'
		}
	}),
	cropCol: flex({ direction: 'column', ...flexPane }),
	cropHeader: hstack({
		position: 'relative',
		flexShrink: 0,
		justifyContent: 'space-between',
		borderBottomWidth: 'hairline',
		borderColor: 'scrapscache.mediaBorder',
		bg: 'scrapscache.mediaSurfaceStrong',
		px: 'md',
		py: 'sm',
		backdropFilter: 'blur(12px)'
	}),
	cropSep: css({
		mx: { base: '3xs', sm: '2xs' },
		h: '1rem',
		w: '1px',
		bg: 'scrapscache.mediaControlActive'
	}),
	cropRatioDesktop: center({
		position: 'absolute',
		left: '50%',
		transform: 'translateX(-50%)',
		display: { base: 'none', sm: 'flex' }
	}),
	cropRadioRoot: hstack({
		gap: '3xs',
		...cardRadius,
		bg: 'scrapscache.mediaControlHover',
		p: '3xs',
		fontSize: 'label'
	}),
	cropRadioItem: css({
		...clickable,
		rounded: 'compact',
		px: 'list',
		py: '2xs',
		...mediaInteractive,
		'&[data-state=checked]': {
			bg: 'scrapscache.mediaText',
			fontWeight: 'heading',
			color: 'scrapscache.mediaSurface',
			boxShadow: 'sm'
		},
		'&[data-state=unchecked]': { color: 'scrapscache.mediaTextSoft', ...mediaHover },
		'&[data-disabled]': { pointerEvents: 'none', opacity: 0.5 }
	}),
	cropReset: css({
		...controlRadius,
		px: 'list',
		py: 'xs',
		textStyle: 'label',
		color: 'scrapscache.mediaTextMuted',
		...interactive,
		...mediaInteractive,
		_disabled: { opacity: 0.3, pointerEvents: 'none' }
	}),
	cropSave: css({ minW: '5.25rem', px: 'md', py: 'xs', textStyle: 'button' }),
	cropRatioMobile: center({
		display: { base: 'flex', sm: 'none' },
		gap: '2xs',
		flexShrink: 0,
		borderBottomWidth: 'hairline',
		borderColor: 'scrapscache.mediaBorderFaint',
		bg: 'scrapscache.mediaSurfaceMuted',
		px: 'md',
		py: 'xs'
	}),
	cropViewport: center({
		position: 'relative',
		...flexPane,
		p: { base: 'sm', sm: '2xl' },
		overflow: 'hidden'
	}),
	cropImgWrap: css({ position: 'relative', flexShrink: 0, overflow: 'visible', boxShadow: '2xl' }),
	cropImg: css({
		...fullSize,
		objectFit: 'fill',
		display: 'block',
		userSelect: 'none',
		pointerEvents: 'none'
	}),
	cropTool: css({
		...square('2.25rem'),
		...controlRadius,
		color: 'scrapscache.mediaTextSoft',
		...mediaInteractive,
		_disabled: {
			opacity: 0.35,
			cursor: 'not-allowed',
			pointerEvents: 'auto',
			_hoverable: { bg: 'transparent', color: 'scrapscache.mediaTextSoft' }
		}
	}),
	viewerStage: css({ position: 'relative', ...flexPane }),
	viewerCenter: center({
		pointerEvents: 'none',
		position: 'relative',
		zIndex: 1,
		h: 'full',
		px: 'lg'
	}),
	viewerImage: css({
		pointerEvents: 'auto',
		maxH: 'full',
		maxW: 'full',
		userSelect: 'none',
		objectFit: 'contain'
	}),
	viewerBackdrop: css({ position: 'absolute', inset: 0, cursor: 'zoom-out' }),
	viewerThumbStrip: css({
		position: 'relative',
		zIndex: 1,
		display: 'flex',
		flexShrink: 0,
		gap: 'sm',
		...sidewaysScroller,
		bgGradient: 'to-t',
		gradientFrom: 'black/85',
		gradientTo: 'transparent',
		px: 'lg',
		pb: 'md',
		pt: 'sm'
	}),
	viewerThumbImg: css({ ...fullSize, objectFit: 'cover' }),
	viewerTitleSize: css({ ml: '2xs', textStyle: 'caption', color: 'scrapscache.mediaTextFaint' })
};

const cropKnobBase = {
	bg: 'scrapscache.mediaText',
	boxShadow: 'cropKnob',
	pointerEvents: 'none',
	transition: 'transform 0.15s ease, box-shadow 0.15s ease'
} as const;
export const photoCropKnob = {
	corner: css({ ...cropKnobBase, ...square('0.75rem'), rounded: 'knob' }),
	edgeH: css({ ...cropKnobBase, h: '0.25rem', w: '1.5rem', rounded: 'pill' }),
	edgeV: css({ ...cropKnobBase, h: '1.5rem', w: '0.25rem', rounded: 'pill' })
};

const ratioMobileBtnBase = {
	rounded: 'compact',
	px: 'sm',
	py: '3xs',
	fontSize: 'label',
	...colorTransition,
	cursor: 'pointer'
} as const;
export const photoRatioMobileBtn = {
	active: css({
		...ratioMobileBtnBase,
		bg: 'scrapscache.mediaText',
		fontWeight: 'heading',
		color: 'scrapscache.mediaSurface'
	}),
	inactive: css({
		...ratioMobileBtnBase,
		color: 'scrapscache.mediaTextMuted',
		_hoverable: { bg: 'scrapscache.mediaControlHover', color: 'scrapscache.mediaText' }
	})
};

const photoNavArrowBase = {
	...absoluteCenterY,
	zIndex: 20,
	display: { base: 'none', sm: 'grid' },
	...square('2.75rem'),
	placeItems: 'center',
	rounded: 'pill',
	bg: 'scrapscache.mediaSurfaceSoft',
	color: 'scrapscache.mediaTextStrong',
	boxShadow: 'md',
	backdropFilter: 'blur(4px)',
	...colorTransition,
	cursor: 'pointer',
	touchAction: 'manipulation',
	_hoverable: { bg: 'scrapscache.mediaSurfaceHover', color: 'scrapscache.mediaText' }
} as const;
export const photoNavArrow = {
	left: css({ ...photoNavArrowBase, left: 'md' }),
	right: css({ ...photoNavArrowBase, right: 'md' })
};

const photoThumbBtnBase = {
	...square('3.5rem'),
	flexShrink: 0,
	overflow: 'hidden',
	rounded: 'control',
	touchAction: 'manipulation',
	transition: 'opacity 120ms ease, box-shadow 120ms ease',
	cursor: 'pointer'
} as const;
export const photoThumbBtn = {
	active: css({
		...photoThumbBtnBase,
		opacity: 1,
		ringWidth: '2px',
		ringColor: 'scrapscache.mediaText'
	}),
	inactive: css({ ...photoThumbBtnBase, opacity: 0.5, _hoverable: { opacity: 0.85 } })
};

// Shared component contracts. Flat groups stay class maps; CVA is reserved for real variants.

export const backupStyles = {
	eyebrow: css({
		fontSize: 'caption',
		fontWeight: 'heading',
		textTransform: 'uppercase',
		letterSpacing: 'code',
		...mutedText
	}),
	description: css({ lineHeight: 'relaxed' }),
	form: css({ gap: 'lg' }),
	label: css({ display: 'block' }),
	fieldLabel: css({ display: 'block', mb: 'xs', textStyle: 'label', ...mutedText }),
	footer: css({ gap: 'sm', pt: '2xs' })
};

export const emptyStateStyles = {
	root: css({
		mx: 'auto',
		mt: '4xl',
		...column,
		maxW: '24rem',
		alignItems: 'center',
		px: 'lg',
		textAlign: 'center',
		...mutedText
	}),
	description: css({ mt: 'md', textStyle: 'bodyMuted' }),
	action: css({
		mt: 'md',
		h: 'auto',
		rounded: 'pill',
		py: 'xs',
		transition: 'background-color 150ms ease',
		_hoverable: { bg: 'scrapscache.borderFaint' }
	})
};

export const reminderAlertStyles = {
	root: flex({
		pointerEvents: 'none',
		position: 'fixed',
		insetX: 0,
		zIndex: 70,
		direction: 'column',
		align: 'center',
		gap: 'sm',
		px: 'md'
	}),
	card: flex({
		pointerEvents: 'auto',
		w: 'full',
		maxW: '28rem',
		align: 'flex-start',
		gap: 'md',
		rounded: 'sheet',
		...border,
		bg: 'scrapscache.surface',
		px: 'md',
		py: 'md',
		boxShadow: '2xl'
	}),
	icon: css({ mt: '3xs', ...iconMd, flexShrink: 0, color: 'scrapscache.accent' }),
	content: css({ minW: 0, flex: '1', textAlign: 'left', ...clickable }),
	title: css({ ...truncateText, textStyle: 'bodyStrong' }),
	subtitle: css({ textStyle: 'caption' }),
	dismissIcon: iconSmClass
};

export const reminderSettingsRow = {
	base: hstack({ h: '2rem', gap: 'list', px: 'md' }),
	interactive: css({ w: 'full', textAlign: 'left', ...interactive, ...subtleHover })
};

export const reminderSettingsStyles = {
	icon: css({ ...iconSm, flexShrink: 0 }),
	label: css({ ...flexFill, textStyle: 'button' }),
	status: css({ flexShrink: 0, textStyle: 'captionStrong' }),
	chevron: css({ ...iconSm, flexShrink: 0, ...mutedText })
};

export const colorPaletteStyles = {
	swatch: css({
		...square('2.5rem'),
		...cardRadius,
		borderWidth: 'strong',
		borderColor: 'scrapscache.borderSubtle',
		transition: 'transform 150ms ease',
		...clickable,
		_motionReduce: { transition: 'none' },
		sm: { _hoverable: { transform: 'scale(1.1)' } }
	}),
	checkmark: center({ h: 'full', w: 'full', fontSize: 'body', ...mutedText })
};

export const labelMenuStyles = {
	iconBox: css({
		...gridCenter,
		...square('1.75rem'),
		flexShrink: 0,
		...mutedText,
		'&[data-state=checked]': { color: 'scrapscache.accent' }
	}),
	icon: iconSmClass,
	label: flexTruncateClass,
	checkIndicator: css({ flexShrink: 0, color: 'scrapscache.accent' }),
	heading: css({
		...flexFill,
		fontSize: 'caption',
		fontWeight: 'heading',
		textTransform: 'uppercase',
		letterSpacing: 'eyebrow',
		...mutedText
	}),
	searchWrap: css({ position: 'relative', mb: '2xs' }),
	searchIcon: css({
		pointerEvents: 'none',
		left: 'md',
		...absoluteCenterY,
		...iconSm,
		...mutedText
	}),
	searchInput: css({ w: 'full', pl: '2.25rem', _placeholder: mutedText }),
	empty: css({ px: 'md', py: 'lg', textAlign: 'center', textStyle: 'caption' })
};

export const datePickerStyles = {
	panel: flex({
		minH: '16.25rem',
		direction: 'column',
		'& [data-part="view"]:not([hidden])': column,
		'& .calendar-table-fill [data-part="table-body"]': { h: '100%' },
		'& .calendar-table-fill [data-part="table-row"]': { h: 'calc(13.5rem / 3)' },
		'& .calendar-table-fill [data-part="table-cell"]': { h: 'inherit', verticalAlign: 'middle' }
	}),
	viewControl: hstack({ mb: 'sm', h: '2.25rem', justify: 'space-between' }),
	viewButton: css({
		...cardRadius,
		px: 'sm',
		py: '2xs',
		textStyle: 'bodyStrong',
		...clickable,
		transition: 'colors 150ms ease',
		...subtleHover
	}),
	table: css({ w: 'full', tableLayout: 'fixed', h: '13.5rem' }),
	weekHeader: css({ h: '1.5rem', textAlign: 'center', textStyle: 'captionStrong' }),
	weekRow: css({ textAlign: 'center' }),
	dayCell: css({
		position: 'relative',
		'&:has([data-in-range])': {
			_before: {
				content: '""',
				...absoluteCenterY,
				left: 0,
				right: 0,
				h: '2rem',
				bg: 'scrapscache.accent/18'
			}
		},
		'&:has([data-range-start])': { _before: { left: '50%' } },
		'&:has([data-range-end])': { _before: { right: '50%' } }
	})
};

const datePickerGridBase = {
	position: 'relative',
	zIndex: 1,
	mx: 'auto',
	...flexCenter,
	textStyle: 'bodyStrong',
	...clickable,
	transition: 'colors 150ms ease',
	_hoverable: { bg: 'scrapscache.interactiveHover' },
	_selected: {
		bg: 'scrapscache.accent',
		color: 'scrapscache.accentForeground',
		fontWeight: 'heading'
	},
	'&[data-today]:not([data-selected])': {
		borderWidth: 'hairline',
		borderColor: 'scrapscache.textMuted'
	},
	_focusVisible: { outline: 'none', ringWidth: '2px', ringColor: 'scrapscache.accent' }
} as const;
export const datePickerGridBtn = {
	day: css({
		...datePickerGridBase,
		...square('2rem'),
		rounded: 'pill',
		'&[data-in-range]:not([data-range-start]):not([data-range-end])': {
			bg: 'transparent',
			color: 'scrapscache.text',
			fontWeight: 'body'
		},
		'&[data-focus]:not([data-selected]):not([data-in-range])': { bg: 'transparent !important' },
		'&[data-selected] .reminder-dot, &[data-range-start] .reminder-dot, &[data-range-end] .reminder-dot':
			{
				bg: 'scrapscache.accentForeground !important'
			},
		'&[data-outside-range]': { opacity: 0.3, pointerEvents: 'none' }
	}),
	month: css({ ...datePickerGridBase, h: '2.25rem', w: '3.5rem', ...cardRadius })
};

const syncRowBase = {
	gap: 'md',
	w: 'full',
	...controlRadius,
	...subtleHover,
	_disabled: { opacity: 0.55 }
} as const;

export const syncStyles = {
	workspaceRow: hstack({
		...syncRowBase,
		position: 'relative',
		p: 'md',
		'&.active': { bg: 'scrapscache.interactiveHover' },
		'&.active::before': {
			content: '""',
			position: 'absolute',
			top: 'list',
			bottom: 'list',
			left: 0,
			w: 'indicator',
			borderTopRightRadius: 'marker',
			borderBottomRightRadius: 'marker',
			bg: 'scrapscache.accent'
		}
	}),
	manageRow: hstack({
		...syncRowBase,
		py: 'list',
		px: 'sm',
		textAlign: 'left',
		'& small': { display: 'block', mt: '3xs', textStyle: 'caption' }
	}),
	dividerLine: css({ h: 'hairline', flex: '1', bg: 'scrapscache.border' }),
	pairingInput: css({
		w: 'full',
		...controlRadius,
		textAlign: 'center',
		fontSize: 'heading',
		fontWeight: 'strong',
		letterSpacing: 'status'
	}),
	digits: css({
		fontFamily: 'mono',
		fontSize: 'pairing',
		fontWeight: 'heading',
		letterSpacing: 'eyebrow'
	}),
	qrCode: css({ ...square('220px'), ...cardRadius, bg: 'scrapscache.qrSurface', p: 'sm' }),
	qrScanner: css({
		w: 'full',
		aspectRatio: '1 / 1',
		objectFit: 'cover',
		...cardRadius,
		...border,
		bg: 'scrapscache.bg'
	}),
	pairingCode: css({ rounded: 'dialog', ...border, bg: 'scrapscache.bg', px: 'sm', py: 'xl' }),
	copySuccess: css({
		borderColor: 'scrapscache.success',
		bg: 'scrapscache.success',
		color: 'scrapscache.successForeground'
	}),
	timerText: css({ fontVariantNumeric: 'tabular-nums' }),
	fullButton: css({ w: 'full' }),
	growButton: css({ flex: '1' }),
	spinner: css({ animation: 'spin' }),
	bodySpacing: css({ mt: '2xs' })
};

export const reminderPickerStyles = {
	ellipsis: flexTruncateClass,
	wheelDeck: css({ rounded: 'dialog', bg: 'scrapscache.surfaceSubtle', px: 'sm', py: '2xs' }),
	timeWheel: css({ w: '4rem' }),
	colon: center({ w: '0.75rem', flexShrink: 0, textStyle: 'display' })
};

export const wheelPickerStyles = {
	band: css({
		pointerEvents: 'none',
		...absoluteCenterY,
		insetX: 0,
		zIndex: 0,
		h: '2.25rem',
		...cardRadius,
		bg: 'scrapscache.bg'
	}),
	viewport: css({
		position: 'absolute',
		inset: 0,
		zIndex: 10,
		overflow: 'hidden',
		outline: 'none',
		touchAction: 'none',
		userSelect: 'none',
		WebkitUserSelect: 'none',
		WebkitMaskImage:
			'linear-gradient(to bottom, transparent 0%, #000 28%, #000 72%, transparent 100%)',
		maskImage: 'linear-gradient(to bottom, transparent 0%, #000 28%, #000 72%, transparent 100%)'
	}),
	track: css({ willChange: 'transform' })
};

const hazeGroupBase = {
	display: 'flex',
	alignItems: 'center',
	filter: 'drop-shadow(0 4px 3px rgb(0 0 0 / 0.07))'
};
export const noteCardHazeGroup = {
	compact: css({ ...hazeGroupBase, justifyContent: 'center', gap: 'xs' }),
	column: css({ ...hazeGroupBase, flexDirection: 'column', gap: 'list' }),
	row: css({ ...hazeGroupBase, justifyContent: 'center', gap: 'list' })
};

export const noteCardSuccessIcon = css({ color: 'scrapscache.success' });

export const noteEditorStyles = {
	overlay: css({ position: 'fixed', inset: 0, zIndex: 50 }),
	sheetWrap: cva({
		base: {
			position: 'absolute',
			inset: 0,
			display: 'flex',
			alignItems: { base: 'flex-start', md: 'center' },
			justifyContent: 'center'
		},
		variants: {
			expanded: { true: {}, false: { px: 'lg', pb: 'var(--app-sheet-pad-bottom)' } }
		},
		defaultVariants: { expanded: false }
	}),
	sheetBox: cva({
		base: { maxH: 'full', minH: 0, w: 'full' },
		variants: {
			expanded: {
				true: { h: 'full', maxW: 'none' },
				// Short viewports (landscape phones, foldables) take the full height.
				false: {
					h: { base: 'full', md: 'max(72%, 32rem)' },
					maxW: '2xl',
					rounded: 'sheet',
					boxShadow: 'noteSheet'
				}
			}
		},
		defaultVariants: { expanded: false }
	}),
	dialogSurface: css({
		position: 'relative',
		...column,
		...fullSize,
		overflow: 'hidden',
		rounded: 'inherit'
	}),
	header: hstack({
		flexShrink: 0,
		gap: 'sm',
		borderBottomWidth: 'hairline',
		borderColor: 'scrapscache.borderFaint',
		px: 'sm',
		py: 'sm'
	}),
	scroller: css({
		...flexPane,
		touchAction: 'pan-y',
		overflowY: 'auto',
		overflowX: 'hidden',
		overscrollBehavior: 'contain',
		px: '2xl',
		pt: 'lg',
		pb: 'md'
	}),
	scrollerFill: css({ flex: 'initial' }),
	title: css({
		mb: 'md',
		display: 'block',
		w: 'full',
		resize: 'none',
		overflow: 'hidden',
		wordBreak: 'break-word',
		textStyle: 'editorTitle',
		_placeholder: mutedText,
		fieldSizing: 'content',
		transition: 'none'
	}),
	fileDropHint: css({
		pointerEvents: 'none',
		position: 'absolute',
		inset: 0,
		zIndex: 20,
		...gridCenter,
		rounded: 'inherit',
		borderWidth: 'strong',
		borderStyle: 'dashed',
		borderColor: 'scrapscache.accent',
		bg: 'scrapscache.accentSubtle'
	}),
	subDialogBackdrop: css({ bg: 'scrapscache.backdropSoft', backdropFilter: 'none', zIndex: 60 }),
	popupContent: css({ outline: 'none' }),
	reminderButton: css({ minW: 0 })
};

export const noteEditorReminderTone = {
	overdue: css({ color: 'scrapscache.overdue' }),
	active: css({ color: 'scrapscache.accent' })
} as const;

export const sidebarRow = cva({
	variants: {
		navigation: { true: { w: 'full', textAlign: 'left', textStyle: 'button', ...clickable } },
		active: {
			true: {
				fontWeight: 'heading',
				bg: 'scrapscache.navigationActive',
				color: 'scrapscache.navigationActiveText'
			},
			false: { fontWeight: 'interactive', color: 'scrapscache.textMuted' }
		},
		wide: { true: { pr: 'lg' } },
		editing: { true: { bg: 'scrapscache.interactiveHover' } },
		swiped: { true: {} }
	},
	// A row drawn back over its actions reads as a solid block being moved.
	// An active row already carries one, so it keeps its own colour.
	compoundVariants: [{ active: false, swiped: true, css: { bg: 'scrapscache.interactiveHover' } }]
});

export const sidebarIcon = cva({
	base: { ...gridCenter, ...square('1.75rem'), flexShrink: 0 },
	variants: {
		iconTone: { nav: { color: 'scrapscache.text' }, muted: { color: 'scrapscache.textMuted' } },
		danger: {
			true: { _hoverable: { bg: 'scrapscache.dangerSubtle', color: 'scrapscache.danger' } }
		},
		hitPad: {
			delete: {
				position: 'relative',
				_before: { position: 'absolute', inset: '-0.5rem', content: '""' }
			},
			count: { fontSize: 'label', fontVariantNumeric: 'tabular-nums', opacity: 0.7 }
		}
	}
});

export const sidebarStyles = {
	navLabel: css({ ...flexFill, ...truncateText, textAlign: 'left' }),
	labelInput: css({
		flex: '1',
		textStyle: 'button',
		_placeholder: { fontWeight: 'body', ...mutedText }
	}),
	searchWrap: css({
		position: 'relative',
		mb: 'xs',
		mx: 'xs',
		flexShrink: 0
	}),
	searchIcon: css({
		pointerEvents: 'none',
		left: 'sm',
		...absoluteCenterY,
		...iconSm,
		...mutedText
	}),
	searchInput: css({
		w: 'full',
		h: '2.375rem',
		pl: '2.25rem',
		pr: 'sm',
		fontSize: 'body',
		_placeholder: mutedText
	}),
	createButton: css({
		color: 'scrapscache.accent'
	}),
	labelList: css({
		overflowY: 'auto',
		minH: 0,
		flex: '1',
		pr: '3xs',
		// Rows keep their own height and the list scrolls. As flex children they
		// would otherwise share the space out and squash as labels are added.
		'& > *': { flexShrink: 0 }
	}),
	labelRowContainer: css({
		position: 'relative',
		w: 'full',
		rounded: 'row',
		// The action tray waits just outside this edge until a swipe pulls it in.
		overflow: 'hidden'
	}),
	// A swiped row narrows by exactly the tray's width, uncovering it.
	labelSwipeRow: css({
		w: 'full',
		transitionProperty: 'width, background-color',
		transitionDuration: '200ms',
		transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)'
	}),
	// Anchored to the row's trailing edge, so it follows the width the row gives
	// up instead of lying under it.
	labelTray: css({
		position: 'absolute',
		insetY: 0,
		left: '100%',
		w: '5.5rem',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 'xs',
		transitionProperty: 'transform',
		transitionDuration: '200ms',
		transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)'
	}),
	// The drawer is a transformed, clipped box; its dialogs belong to the app
	// frame instead.
	dialogPortal: css({ position: 'absolute', inset: 0, zIndex: 80 }),
	dialogPositioner: css({
		position: 'absolute',
		inset: 0,
		display: 'flex',
		alignItems: { base: 'flex-end', sm: 'center' },
		justifyContent: 'center',
		p: 'lg'
	}),
	labelHazeOverlay: css({
		position: 'absolute',
		inset: 0,
		zIndex: 10,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 'xs',
		bg: 'scrapscache.backdropMuted',
		backdropFilter: 'blur(8px)',
		rounded: 'row',
		transition: 'opacity 150ms ease'
	})
};

export const topbarStyles = {
	searchInput: css({ h: 'full', flex: '1', appearance: 'none', _placeholder: mutedText }),
	searchIcon: css(mutedText),
	syncIcon: css({ display: 'block' }),
	menuPositioner: css({ zIndex: 30 }),
	menuPopover: css({ w: '16rem', overflow: 'hidden', pt: '2xs' }),
	deviceSettings: css({ borderTopWidth: 'hairline', borderColor: 'scrapscache.border' }),
	menuSeparator: css({ borderTopWidth: 'hairline', borderColor: 'scrapscache.border' }),
	menuAlert: css({ px: 'md', pb: 'sm', textStyle: 'label', color: 'scrapscache.danger' })
};

export const topbarSyncTone = {
	normal: '',
	warning: css({ color: 'scrapscache.warning' }),
	danger: css({ color: 'scrapscache.danger' })
} as const;
