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

/** A size's diameter, px (KnobFace's `--knob-want`). */
export const KNOB_PX: Record<KnobSize, number> = { s: 48, m: 70, l: 96 };

/** The height a caption under a knob takes, gaps and padding included (KnobFace's `--knob-caption-h`). */
const CAPTION_PX: Record<KnobSize, number> = { s: 44, m: 50, l: 54 };

const SIZES_DOWN: readonly KnobSize[] = ['l', 'm', 's'];

/**
 * The diameter a knob of `size` draws in a `width` x `height` cell: KnobFace's
 * own rule, so a layout can be checked without rendering. Caption beside the
 * knob in a cell wider than 6:5, under it otherwise, none with `caption` false.
 */
export function knobDiameter(size: KnobSize, width: number, height: number, caption = true): number {
	const want = KNOB_PX[size];
	if (width <= 0 || height <= 0) return 0;
	if (!caption) return Math.min(want, width - 8, height - 12);
	if (width / height > 6 / 5) return Math.min(want, width / 2, height - 12);
	return Math.min(want, width - 8, height - CAPTION_PX[size]);
}

/**
 * The largest size, at most `ceiling`, that a `width` x `height` cell holds at
 * its full diameter; 's' when none does (it then shrinks, as before).
 */
export function knobSizeFits(ceiling: KnobSize, width: number, height: number, caption = true): KnobSize {
	for (const size of SIZES_DOWN.slice(SIZES_DOWN.indexOf(ceiling))) {
		if (knobDiameter(size, width, height, caption) >= KNOB_PX[size] - 0.5) return size;
	}
	return 's';
}

/**
 * A grid of `count` knobs in a `width` x `height` box, laid out so every knob
 * draws at exactly its size (ADR-509 addendum, 2026-11-06): of the row counts,
 * the one whose cells hold the largest size, where a row count's size is at
 * most what its columns stack (`knobSizeFor`), or `ceiling` when the host names
 * one. Ties go to the larger knob headroom, then to fewer rows. A size steps
 * down only when no row count holds it.
 */
export function knobGridFit(
	count: number,
	width: number,
	height: number,
	gap = 16,
	ceiling?: KnobSize,
	caption = true,
	maxRows = count
): { rows: number; size: KnobSize } {
	let best = { rows: 1, size: 's' as KnobSize, px: -1, room: -Infinity };
	for (let rows = 1; rows <= Math.max(1, Math.min(count, maxRows)); rows++) {
		const cols = Math.ceil(count / rows);
		const w = (width - gap * (cols - 1)) / cols;
		const h = (height - gap * (rows - 1)) / rows;
		const rule = ceiling ?? knobSizeFor(rows);
		const size = knobSizeFits(rule, w, h, caption);
		const d = knobDiameter(size, w, h, caption);
		const px = d >= KNOB_PX[size] - 0.5 ? KNOB_PX[size] : 0;
		const room = Math.min(w, h);
		if (px > best.px || (px === best.px && room > best.room + 0.5)) best = { rows, size, px, room };
	}
	return { rows: best.rows, size: best.size };
}
