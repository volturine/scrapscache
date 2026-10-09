import { APP_FLOAT_SELECTOR, APP_OVERLAY_SELECTOR } from '#lib/appViewport.js';

/**
 * Portal hosts are shared: the overlays a modal opens (a photo, a canvas, an undo
 * bar) are appended to them later, so the hosts stay live and only what they hold
 * when the modal opens is made inert.
 */
const PORTAL_HOSTS = `${APP_FLOAT_SELECTOR}, ${APP_OVERLAY_SELECTOR}`;

/**
 * Announcements keep reaching assistive technology while a modal is open, and an
 * overlay marked `data-over-modals` (a due reminder) stays usable over it.
 */
const STAYS_LIVE = '[aria-live], [role="status"], [role="alert"], [data-over-modals]';

/**
 * Make `dialog` modal for as long as it is mounted (`{@attach modalLayer}`): every
 * element already on the page outside it becomes inert — unfocusable, unclickable
 * and hidden from assistive technology — focus moves into it, and when it goes,
 * focus returns to whatever held it before.
 *
 * This is native `inert` rather than a focus trap because these overlays share the
 * page with content that opens on top of them later: Excalidraw appends its dialogs
 * to <body>, and a note's photo, canvas and file viewers and a due reminder land in
 * the portal hosts. A trap would pull focus out of those; anything added after the
 * modal opens stays live here. Nested modals stack: each one only releases what it
 * made inert.
 */
export function modalLayer(dialog: HTMLElement): () => void {
	const doc = dialog.ownerDocument;
	const active = doc.activeElement;
	const opener = active instanceof HTMLElement && active !== doc.body ? active : null;
	const inerted: Element[] = [];

	const suppress = (parent: Element) => {
		for (const child of Array.from(parent.children)) {
			if (child === dialog) continue;
			if (
				child.contains(dialog) ||
				child.matches(PORTAL_HOSTS) ||
				child.querySelector(PORTAL_HOSTS)
			) {
				suppress(child);
				continue;
			}
			if (child.hasAttribute('inert') || child.matches(STAYS_LIVE)) continue;
			child.setAttribute('inert', '');
			inerted.push(child);
		}
	};
	suppress(doc.body);

	if (!dialog.contains(doc.activeElement)) dialog.focus({ preventScroll: true });

	return () => {
		for (const element of inerted) element.removeAttribute('inert');
		const current = doc.activeElement;
		// Focus left on purpose (another note opened from a reminder) stays where it went.
		const focusLost = !current || current === doc.body || dialog.contains(current);
		if (focusLost && opener?.isConnected && !opener.closest('[inert]')) {
			opener.focus({ preventScroll: true });
		}
	};
}
