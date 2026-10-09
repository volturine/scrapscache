const loading = new Map<string, Promise<void>>();

/**
 * Add a stylesheet to the document once, resolving when it applies. A failed
 * load removes the link and is tried again by the next call.
 */
export function linkStylesheet(href: string): Promise<void> {
	let pending = loading.get(href);
	if (!pending) {
		pending = new Promise<void>((resolve, reject) => {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = href;
			link.onload = () => resolve();
			link.onerror = () => {
				link.remove();
				loading.delete(href);
				reject(new Error('Could not load the canvas editor styles.'));
			};
			document.head.append(link);
		});
		loading.set(href, pending);
	}
	return pending;
}
