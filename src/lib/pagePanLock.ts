/**
 * Keep drags inside `scroller` for as long as it is mounted (`{@attach pagePanLock}`).
 *
 * With the software keyboard up, iOS lets a finger slide the whole page under the
 * keys, whatever the page's own overflow says: a sheet over the page went with it,
 * and the page showed through under the sheet as it moved. While the lock is held a
 * drag scrolls the scroller and nothing else. One that starts outside it, or that it
 * has no room left for (a list too short to scroll, a list at its end), is stopped
 * instead of being handed on to the page.
 *
 * `overscroll-behavior` and `touch-action` on the scroller were not enough: in the
 * iPhone app's web view they held the page still on some drags and not on others.
 *
 * iPhone Duo's column, outside the app frame, keeps its own scrolling.
 */
export function pagePanLock(scroller: HTMLElement): () => void {
	const doc = scroller.ownerDocument;
	let startX = 0;
	let startY = 0;

	const onStart = (event: TouchEvent) => {
		const touch = event.touches[0];
		if (!touch) return;
		startX = touch.clientX;
		startY = touch.clientY;
	};

	const onMove = (event: TouchEvent) => {
		// A scroll already under way cannot be cancelled, and is the scroller's own.
		if (!event.cancelable) return;
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest('[data-column-stack]')) return;
		const touch = event.touches[0];
		if (!touch || !target || !scroller.contains(target)) {
			event.preventDefault();
			return;
		}
		const dx = touch.clientX - startX;
		const dy = touch.clientY - startY;
		const room = scroller.scrollHeight - scroller.clientHeight;
		const sideways = Math.abs(dx) > Math.abs(dy);
		const pastTop = dy > 0 && scroller.scrollTop <= 0;
		const pastEnd = dy < 0 && scroller.scrollTop >= room - 1;
		if (sideways || pastTop || pastEnd) event.preventDefault();
	};

	doc.addEventListener('touchstart', onStart, { passive: true });
	doc.addEventListener('touchmove', onMove, { passive: false });
	return () => {
		doc.removeEventListener('touchstart', onStart);
		doc.removeEventListener('touchmove', onMove);
	};
}
