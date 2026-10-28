// Runs before any CSS, from src/app.html. A file rather than an inline script,
// so the page can be prerendered for the iPhone app under the same CSP.
(function () {
	// iOS zooms into any focused field under 16px unless maximum-scale caps
	// it, and it never lets that cap block pinch-zoom. Android does honour
	// the cap for pinch-zoom, so it is applied on iOS alone. (iPadOS reports
	// itself as a Mac; touch points tell it apart.)
	var ua = navigator.userAgent;
	var ios = /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
	// The iPhone app (window.Capacitor) is laid out like the installed web app.
	if (
		ios &&
		(navigator.standalone ||
			matchMedia('(display-mode: standalone)').matches ||
			window.Capacitor)
	) {
		document.documentElement.classList.add('ios-standalone');
	}
	var viewport = document.querySelector('meta[name="viewport"]');
	if (ios && viewport) viewport.content += ', maximum-scale=1';
})();
(function () {
	// Apply theme + background BEFORE CSS loads to prevent white flash.
	// iOS reloads the page when returning to a standalone web app, and with
	// ssr=false the body is empty until Svelte boots. This sets the correct
	// background color as an inline style so it's visible immediately.
	try {
		var raw = localStorage.getItem('scrapscache-ui-state');
		var dark = null;
		if (raw) {
			var parsed = JSON.parse(raw);
			if (typeof parsed.dark === 'boolean') dark = parsed.dark;
		}
		if (dark === null) {
			dark = matchMedia('(prefers-color-scheme: dark)').matches;
		}
		var el = document.documentElement;
		if (dark) {
			el.classList.add('dark');
			el.style.backgroundColor = '#1a1a1a';
			el.style.colorScheme = 'dark';
		} else {
			el.classList.remove('dark');
			el.style.backgroundColor = '#ffffff';
			el.style.colorScheme = 'light';
		}
		var theme = document.querySelector('meta[name="theme-color"]');
		if (theme) theme.setAttribute('content', dark ? '#1a1a1a' : '#ffffff');
	} catch (e) {
		// Default to dark if anything fails (user prefers dark).
		document.documentElement.style.backgroundColor = '#1a1a1a';
		document.documentElement.style.colorScheme = 'dark';
	}
})();
