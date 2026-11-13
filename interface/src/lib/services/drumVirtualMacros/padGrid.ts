/**
 * The pad grid's geometry and the playing clip on it: which pads are
 * drawn (Live's visible sixteen, then the rest of the kit), where each
 * sits, and which pads the playhead just crossed.
 */

import type { VmPad } from './wire';

/** Live's pad view: rows of four, four rows a page (sixteen pads). */
export const PAD_PAGE_COLUMNS = 4;
export const PAD_PAGE_ROWS = 4;
/** The highest scroll row Live allows: 28 shows 112..127, the last sixteen notes. */
export const PAD_SCROLL_MAX = 28;
/** Live's own default window when the rack has not told us (row 9: notes 36..51). */
export const DEFAULT_PAD_SCROLL = 9;

// ---------------------------------------------------------------------------
// The playing clip on the grid (2026-09-08): a flash as each pad is
// triggered.
//
// A drum clip's notes ARE the pads it uses, so the grid lights each one as
// the playhead crosses one of its notes (it drew only the clip's pads
// from 2026-09-09 to 2026-11-13). Both ride channels the strip already has: the
// cheap note blob (`clipNotesService`) and the 30 Hz playhead
// (`playingClipsStore.position`). Live's LOM exposes no per-pad trigger
// event and the surface never sees the track's MIDI input, so a note
// played live on a keyboard or the Move does not flash: this is the
// clip's own timeline, read ahead of the ear by nothing.
// ---------------------------------------------------------------------------

/** The distinct pitches a clip plays, ascending. */
export function clipPadNotes(notes: readonly { pitch: number }[]): number[] {
	const set = new Set<number>();
	for (const n of notes) if (Number.isInteger(n.pitch) && n.pitch >= 0 && n.pitch <= 127) set.add(n.pitch);
	return [...set].sort((a, b) => a - b);
}

/** One tile on the pad grid: its note, the pad there (null = Live's empty pad), and its cell. */
export interface PadGridSlot {
	note: number;
	pad: VmPad | null;
	column: number;
	row: number;
	/** Outside Live's visible sixteen: drawn to their right. */
	extra: boolean;
}

/**
 * The Drum Rack view's pad grid (2026-11-13, the user's call): **the
 * sixteen pads Live shows, where Live shows them**, and every other pad
 * to their right.
 *
 * `scroll` is Live's own window (`vm.padScroll`, the rack view's
 * `drum_pads_scroll_position`): the lowest visible row of four, so the
 * window is `4·scroll .. 4·scroll + 15`, laid out as Live lays it — rows
 * of four consecutive notes, the lowest along the bottom, left to right.
 * All sixteen are drawn, an empty pad as an empty tile, so a pad is always
 * in the same place. Unknown (no reading yet, or a surface from before
 * the property) is Live's default, row 9: 36..51.
 *
 * The extras are every pad the kit holds outside the window, plus Live's
 * selection and any held pad there (`keep`), so a selected or held pad is
 * never off the grid. They sit in columns to the right, in the window's
 * own reading order — rows left to right, the lowest at the bottom — as
 * many columns as four rows need: sixteen extras are Live's next page
 * beside this one. Every column shares the grid's width, so the tiles
 * shrink as columns arrive.
 *
 * Slots come back in note order, the window first (the reading order for
 * a screen reader, and what the tests assert); each carries its cell.
 */
export function padRackGrid(
	pads: readonly VmPad[],
	scroll: number | null | undefined,
	keep: readonly (number | null)[] = []
): { slots: PadGridSlot[]; columns: number; rows: number; first: number } {
	const row =
		typeof scroll === 'number' && Number.isFinite(scroll)
			? Math.min(PAD_SCROLL_MAX, Math.max(0, Math.round(scroll)))
			: DEFAULT_PAD_SCROLL;
	const first = row * PAD_PAGE_COLUMNS;
	const size = PAD_PAGE_COLUMNS * PAD_PAGE_ROWS;
	const byNote = new Map<number, VmPad>();
	for (const p of pads) byNote.set(p.note, p);

	const slots: PadGridSlot[] = [];
	for (let i = 0; i < size; i++) {
		const note = first + i;
		slots.push({
			note,
			pad: byNote.get(note) ?? null,
			column: (i % PAD_PAGE_COLUMNS) + 1,
			row: PAD_PAGE_ROWS - Math.floor(i / PAD_PAGE_COLUMNS),
			extra: false
		});
	}

	const outside = new Set<number>();
	const inWindow = (n: number) => n >= first && n < first + size;
	for (const p of pads) if (Number.isInteger(p.note) && !inWindow(p.note)) outside.add(p.note);
	for (const n of keep) if (n !== null && Number.isInteger(n) && n >= 0 && n <= 127 && !inWindow(n)) outside.add(n);
	const extras = [...outside].sort((a, b) => a - b);
	const extraColumns = Math.ceil(extras.length / PAD_PAGE_ROWS);
	extras.forEach((note, j) => {
		slots.push({
			note,
			pad: byNote.get(note) ?? null,
			column: PAD_PAGE_COLUMNS + (j % extraColumns) + 1,
			row: PAD_PAGE_ROWS - Math.floor(j / extraColumns),
			extra: true
		});
	});
	return { slots, columns: PAD_PAGE_COLUMNS + extraColumns, rows: PAD_PAGE_ROWS, first };
}

/**
 * Which notes the playhead crossed moving from `prev` to `pos` beats,
 * inside a loop window. A backwards move is the loop wrapping: the
 * tail of the window up to its end, then its start up to `pos`.
 *
 * The playhead arrives at 30 Hz, so one step is ~0.07 beats at 120 BPM
 * and a stalled tick or two is still well under a beat; anything longer
 * than `MAX_PLAYHEAD_STEP_BEATS` (or than the window itself) is a scene
 * relaunch or a seek, and counts nothing — flashing every pad on a
 * relaunch would be noise, not information. Notes are compared by
 * `startBeats`; a note exactly at `prev` was counted last time.
 */
export const MAX_PLAYHEAD_STEP_BEATS = 1;

export function notesCrossed(
	notes: readonly { pitch: number; startBeats: number }[],
	prev: number,
	pos: number,
	loopStart: number,
	loopEnd: number
): number[] {
	const span = loopEnd - loopStart;
	if (!(span > 0) || !Number.isFinite(prev) || !Number.isFinite(pos)) return [];
	const limit = Math.min(span, MAX_PLAYHEAD_STEP_BEATS);
	const hit = new Set<number>();
	// A note on the loop's START plays (the window includes it); a note on
	// its END never does — Live wraps before reaching it — so the end is
	// exclusive everywhere.
	const inRange = (lo: number, hi: number) => {
		for (const n of notes) {
			if (n.startBeats > lo && n.startBeats <= hi && n.startBeats < loopEnd) hit.add(n.pitch);
		}
	};
	if (pos >= prev) {
		if (pos - prev > limit) return [];
		inRange(prev, pos);
	} else {
		// Wrapped: prev → loopEnd, then loopStart → pos.
		if (loopEnd - prev + (pos - loopStart) > limit) return [];
		inRange(prev, loopEnd);
		inRange(loopStart - 1e-9, pos);
	}
	return [...hit].sort((a, b) => a - b);
}

/** How long a triggered pad stays lit. Four playhead ticks at 30 Hz: visible, never a smear. */
export const PAD_FLASH_MS = 130;
