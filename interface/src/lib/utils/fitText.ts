/**
 * Length-aware label fit — the measuring half of app.css's `.fit-label`.
 *
 * `use:fitText={text}` measures the label's longest word in the font the
 * element actually renders with (SF Pro on the iPad, whatever the capture
 * machine has) and writes its width in em as `--fit-em`. The CSS caps the
 * label's size at what that word can take across its container, so a label
 * that already fits keeps its size exactly and only one that would overflow
 * shrinks. The longest word, because a label may wrap between words but
 * never inside one.
 *
 * Measured once per text, at a fixed 100px, so the cap it feeds never feeds
 * back into it. Where there is nothing to measure with (no OffscreenCanvas,
 * e.g. jsdom), no `--fit-em` is written and the label keeps its size.
 */

const MEASURE_PX = 100;

type Measure = (word: string) => number;

/** The widest word of `text`, in em, as `measure` (px at MEASURE_PX) sees it. */
export function longestWordEm(text: string | null | undefined, measure: Measure): number {
	if (!text) return 0;
	let widest = 0;
	for (const word of text.split(/\s+/)) {
		if (!word) continue;
		const width = measure(word);
		if (width > widest) widest = width;
	}
	return widest / MEASURE_PX;
}

let context: OffscreenCanvasRenderingContext2D | null | undefined;

function measurerFor(node: HTMLElement): Measure | null {
	if (context === undefined) {
		context = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
	}
	const ctx = context;
	if (!ctx) return null;
	const style = getComputedStyle(node);
	ctx.font = `${style.fontStyle} ${style.fontWeight} ${MEASURE_PX}px ${style.fontFamily}`;
	const upper = style.textTransform === 'uppercase';
	return (word) => ctx.measureText(upper ? word.toUpperCase() : word).width;
}

export function fitText(node: HTMLElement, text: string | null | undefined) {
	const apply = (value: string | null | undefined) => {
		const measure = measurerFor(node);
		if (!measure) return;
		const em = longestWordEm(value, measure);
		if (em > 0) node.style.setProperty('--fit-em', String(em));
		else node.style.removeProperty('--fit-em');
	};
	apply(text);
	return { update: apply };
}
