/**
 * How a grid of knobs lays out (ADR-509). Pure: the panels' groups
 * (`central/views/panel/PanelGroupView`) and the hand-laid views' `KnobGrid`
 * both measure their box and ask this for the rows.
 */

/**
 * The rows a grid of `count` knobs takes in a `width` x `height` box so each
 * knob is as large as it can be: a knob is as wide as its cell less a little,
 * and as tall as its cell less its caption. Ties go to fewer rows.
 */
export function knobGridRows(count: number, width: number, height: number, gap = 16, caption = 52): number {
	let best = 1;
	let bestD = -Infinity;
	for (let rows = 1; rows <= count; rows++) {
		const cols = Math.ceil(count / rows);
		const w = (width - gap * (cols - 1)) / cols;
		const h = (height - gap * (rows - 1)) / rows;
		const d = Math.min(w - 8, h - caption);
		if (d > bestD + 0.5) {
			best = rows;
			bestD = d;
		}
	}
	return best;
}

/** A knob's size (ADR-509): s 48px, m 70px, l 96px across. */
export type KnobSize = 's' | 'm' | 'l';

/**
 * A knob's size from how many knobs its column stacks (ADR-509): one or two
 * 'l', three 'm', four or more 's'. Count the most the column ever shows, so
 * a mode that adds or drops a knob never resizes the others.
 */
export function knobSizeFor(stacked: number): KnobSize {
	return stacked <= 2 ? 'l' : stacked === 3 ? 'm' : 's';
}
