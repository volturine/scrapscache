import type { SpanKind } from './windowSegments.js';

/** The span attachAppViewport last published. Components read it; CSS also keys off the attribute. */
class ViewportSpan {
	kind = $state<SpanKind>('single');
}

export const viewportSpan = new ViewportSpan();
