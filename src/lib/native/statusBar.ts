import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * The status bar takes the theme's colours. It stays where iOS puts it: the
 * page already lays itself out inside the safe area, and on the folded iPhone
 * Duo the column it sits in is reserved by the hardware whether or not the bar
 * is shown (hiding it only loses the clock; the inset stays).
 */
export function attachNativeStatusBar(): () => void {
	let lastDark: boolean | null = null;
	const applyStyle = () => {
		const dark = document.documentElement.classList.contains('dark');
		if (dark === lastDark) return;
		lastDark = dark;
		void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
	};
	const themeObserver = new MutationObserver(applyStyle);
	applyStyle();
	themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
	return () => themeObserver.disconnect();
}
