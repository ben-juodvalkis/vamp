/**
 * `use:boxSize` — report a box's height (or width) now and whenever it
 * resizes.
 *
 * The session grid, the scene rail, the mini session and the phone's clip
 * grid all divide a measured box into rows, and each carried the same
 * `$effect`: a `ResizeObserver` on a bound element, a `measure()` that read
 * `getBoundingClientRect()`, and a guard that kept the last non-zero reading.
 * The guard matters: a section switched off is `display: none` and measures
 * 0, and a pitch of 0 would collapse the rows the moment it came back, before
 * the observer's next frame.
 *
 * ```svelte
 * <div use:boxSize={{ keepLastNonZero: true, onSize: (h) => (heightPx = h) }}>
 * ```
 *
 * `enabled: false` measures nothing (and turning it back on measures at
 * once). With no `ResizeObserver` (SSR, an old test DOM) it measures once.
 */

export interface BoxSizeOptions {
	/** Called with the measured size in CSS px. */
	onSize: (px: number) => void;
	/** Which dimension. Default `height`. */
	axis?: 'height' | 'width';
	/** Skip a reading of 0 (a hidden box), keeping the last real one. */
	keepLastNonZero?: boolean;
	/** Default true. */
	enabled?: boolean;
}

export function boxSize(node: HTMLElement, options: BoxSizeOptions) {
	let opts = options;
	let ro: ResizeObserver | null = null;

	function measure() {
		if (opts.enabled === false) return;
		const rect = node.getBoundingClientRect();
		const px = opts.axis === 'width' ? rect.width : rect.height;
		if (opts.keepLastNonZero && !(px > 0)) return;
		opts.onSize(px);
	}

	measure();
	if (typeof ResizeObserver !== 'undefined') {
		ro = new ResizeObserver(measure);
		ro.observe(node);
	}

	return {
		update(next: BoxSizeOptions) {
			const wasEnabled = opts.enabled !== false;
			const axisChanged = (next.axis ?? 'height') !== (opts.axis ?? 'height');
			opts = next;
			if ((!wasEnabled && opts.enabled !== false) || axisChanged) measure();
		},
		destroy() {
			ro?.disconnect();
			ro = null;
		}
	};
}
