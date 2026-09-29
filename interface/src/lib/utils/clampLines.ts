/**
 * Clamp a label to the lines its box has room for.
 *
 * `use:clampLines` on a label inside a fixed-height box (a browser tile)
 * measures how many of its lines fit in the box's content height, less the
 * box's other in-flow children (a plug-in line under a preset's name), and
 * writes that as `--clamp-lines` for the label's `-webkit-line-clamp`. A name
 * longer than that ends in an ellipsis on its last line instead of spilling
 * out of the box, where a centered label lost its FIRST line to the clip —
 * the words that tell "01 Bird, Attila" from "02 Bird, Black".
 *
 * Re-measured whenever the box or the label changes size (a resize, a font
 * that loaded late, a new text). Without a ResizeObserver (jsdom) it
 * measures once and nothing is clamped past what that saw.
 */

/** Whole lines of `lineHeight` that fit in `available` px: at least one. */
export function linesThatFit(available: number, lineHeight: number): number {
	if (!(lineHeight > 0) || !(available > 0)) return 1;
	// Half a pixel of slack: a box sized for exactly N lines measures a hair
	// under N * lineHeight after subpixel rounding.
	return Math.max(1, Math.floor((available + 0.5) / lineHeight));
}

function px(value: string): number {
	const n = parseFloat(value);
	return Number.isFinite(n) ? n : 0;
}

function lineHeightOf(node: HTMLElement): number {
	const style = getComputedStyle(node);
	const lh = style.lineHeight;
	if (lh.endsWith('px')) return px(lh);
	const fontSize = px(style.fontSize);
	// `normal`, or a unitless number some engines report as given.
	return lh === 'normal' ? fontSize * 1.2 : px(lh) * fontSize;
}

export function clampLines(node: HTMLElement) {
	const fit = () => {
		const box = node.parentElement;
		if (!box) return;
		const boxStyle = getComputedStyle(box);
		let available = box.clientHeight - px(boxStyle.paddingTop) - px(boxStyle.paddingBottom);
		// Only a column box stacks its children under the label.
		if (boxStyle.flexDirection.startsWith('column')) {
			for (const child of Array.from(box.children)) {
				if (child === node || !(child instanceof HTMLElement)) continue;
				const style = getComputedStyle(child);
				if (style.position === 'absolute' || style.position === 'fixed' || style.display === 'none') continue;
				available -= child.offsetHeight + px(style.marginTop) + px(style.marginBottom);
			}
		}
		const lines = String(linesThatFit(available, lineHeightOf(node)));
		if (node.style.getPropertyValue('--clamp-lines') !== lines) node.style.setProperty('--clamp-lines', lines);
	};
	fit();
	if (typeof ResizeObserver === 'undefined') return {};
	const ro = new ResizeObserver(fit);
	ro.observe(node);
	if (node.parentElement) ro.observe(node.parentElement);
	return { destroy: () => ro.disconnect() };
}
