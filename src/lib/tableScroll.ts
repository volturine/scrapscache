/** The wide table under a gallery card. The card shield covers it, so hit testing has to look through the shield. */
export function overflowingTable(root: HTMLElement, x: number, y: number): HTMLElement | null {
	const stack =
		typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
	for (const el of stack) {
		if (!root.contains(el)) continue;
		const scroll = el.closest('[data-markdown-table-container]');
		if (
			scroll instanceof HTMLElement &&
			root.contains(scroll) &&
			scroll.scrollWidth > scroll.clientWidth + 1
		) {
			return scroll;
		}
	}
	return null;
}

/** A visible bar for a table wider than the note. System scrollbars stay hidden until a gesture starts. */
export function tableScroll(node: HTMLElement, enabled = true) {
	let bar: HTMLDivElement | null = null;
	let thumb: HTMLDivElement | null = null;
	let sizes: ResizeObserver | null = null;
	let children: MutationObserver | null = null;

	function sync() {
		if (!bar || !thumb) return;
		const overflow = node.scrollWidth - node.clientWidth;
		bar.hidden = overflow <= 1;
		if (overflow <= 1) return;
		const track = bar.clientWidth;
		const thumbWidth = Math.max(28, (node.clientWidth / node.scrollWidth) * track);
		const travel = Math.max(1, track - thumbWidth);
		thumb.style.width = `${thumbWidth}px`;
		thumb.style.transform = `translateX(${(node.scrollLeft / overflow) * travel}px)`;
	}

	function watchInner() {
		sizes?.disconnect();
		sizes = new ResizeObserver(sync);
		sizes.observe(node);
		const inner = node.querySelector('.markdown-editor-table, .markdown-table');
		if (inner) sizes.observe(inner);
		sync();
	}

	function onPointerDown(event: PointerEvent) {
		if (!bar || !thumb) return;
		event.preventDefault();
		event.stopPropagation();
		const overflow = node.scrollWidth - node.clientWidth;
		const track = Math.max(1, bar.clientWidth - thumb.offsetWidth);
		const origin = bar.getBoundingClientRect().left;
		const grabbed = event.target === thumb;
		const offset = grabbed
			? event.clientX - thumb.getBoundingClientRect().left
			: thumb.offsetWidth / 2;
		const move = (ev: PointerEvent) => {
			const ratio = Math.min(1, Math.max(0, (ev.clientX - origin - offset) / track));
			node.scrollLeft = ratio * overflow;
		};
		move(event);
		const stop = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', stop);
			window.removeEventListener('pointercancel', stop);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', stop);
		window.addEventListener('pointercancel', stop);
	}

	function mount() {
		bar = document.createElement('div');
		bar.className = 'markdown-table-hscroll';
		bar.contentEditable = 'false';
		bar.setAttribute('aria-hidden', 'true');
		thumb = document.createElement('div');
		thumb.contentEditable = 'false';
		bar.append(thumb);
		bar.addEventListener('pointerdown', onPointerDown);
		node.insertAdjacentElement('afterend', bar);
		node.addEventListener('scroll', sync, { passive: true });
		children = new MutationObserver(watchInner);
		children.observe(node, { childList: true });
		watchInner();
	}

	function unmount() {
		children?.disconnect();
		children = null;
		sizes?.disconnect();
		sizes = null;
		node.removeEventListener('scroll', sync);
		bar?.remove();
		bar = null;
		thumb = null;
	}

	if (enabled) mount();

	return {
		update(next: boolean) {
			if (next && !bar) mount();
			if (!next) unmount();
		},
		destroy: unmount
	};
}
