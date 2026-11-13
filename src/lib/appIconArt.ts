/**
 * The icon masters in design/app-icon as images, for Settings > App icon to
 * show: the same drawings the home screen's icons are rendered from.
 * They stay files, fetched when shown, so the web app carries only their names.
 */
const ART = import.meta.glob<string>('/design/app-icon/*-*-*.svg', {
	query: '?url&no-inline',
	import: 'default',
	eager: true
});

/** The image of a master, named as its file is: `dark-tilted-amber`. */
export function iconArt(master: string): string {
	const url = ART[`/design/app-icon/${master}.svg`];
	if (!url) throw new Error(`No icon master named ${master}`);
	return url;
}
