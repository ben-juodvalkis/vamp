/**
 * The pad grid's geometry and the playing clip on it: which pads are
 * drawn (the clip's, the selection, the holds), how they stack, and which
 * pads the playhead just crossed.
 */

import type { VmPad } from './wire';

/** Pads stack down a column before a second one starts (user's call, 2026-09-09). */
export const PAD_COLUMN_ROWS = 4;

/** Past this the grid grows rows instead, rather than out-widening the controls. */
export const PAD_MAX_COLUMNS = 3;

// ---------------------------------------------------------------------------
// The playing clip on the grid (2026-09-08): only the pads it plays, and a
// flash as each is triggered.
//
// A drum clip's notes ARE the pads it uses, so while a clip plays the grid
// can show just those, compacted into bigger tiles ordered by note — the
// ones a finger wants under it — and light each one as the playhead
// crosses one of its notes. Both ride channels the strip already has: the
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

/**
 * The grid's shape for `count` pads: **stack first, widen second**
 * (user's call, 2026-09-09).
 *
 * Up to four pads are one column, in pitch order down it. A fifth starts
 * a second column rather than rebalancing the first — five reads 4 + 1,
 * not 3 + 2 — because a column that keeps its length as pads arrive is a
 * column a finger can keep its place in. Past three columns the width
 * would start eating the controls, so beyond twelve the rows grow
 * instead, which is the case that should hardly ever happen.
 */
export function padGridShape(count: number): { columns: number; rows: number } {
	if (count <= 0) return { columns: 0, rows: 0 };
	if (count <= PAD_COLUMN_ROWS) return { columns: 1, rows: count };
	const wanted = Math.ceil(count / PAD_COLUMN_ROWS);
	// Rows stay at four while a column can be added: nine pads are 4 + 4 + 1,
	// not the 3 + 3 + 3 a rebalance would give. Only when the width would
	// start eating the controls do the rows grow instead.
	if (wanted <= PAD_MAX_COLUMNS) return { columns: wanted, rows: PAD_COLUMN_ROWS };
	return { columns: PAD_MAX_COLUMNS, rows: Math.ceil(count / PAD_MAX_COLUMNS) };
}

/**
 * The notes the grid draws: the playing clip's pads, plus Live's selected
 * pad and every pad a finger is holding (2026-09-09).
 *
 * All three are equals here — unlike the earlier rule, where the clip's
 * notes were the basis and the rest were added to them. There is no
 * paged fallback to hold in reserve any more, so with nothing playing the
 * grid is simply the selected pad, which is the whole of what the
 * controls are pointed at.
 *
 * A note the kit has no pad for still draws, as the empty tile it is —
 * that is what explains a ghosted control rather than hiding it.
 */
export function padGridNotes(
	clipNotes: readonly number[] | null | undefined,
	keep: readonly (number | null)[] = []
): number[] {
	const set = new Set<number>();
	for (const note of clipNotes ?? []) if (Number.isInteger(note)) set.add(note);
	for (const note of keep) if (note !== null && Number.isInteger(note)) set.add(note);
	return [...set].sort((a, b) => a - b);
}

/**
 * Where the `index`-th note (ascending) sits in a grid `rows` tall:
 * columns fill **bottom-up**, so the LOWEST note is at the foot of the
 * first column and pitch climbs as the eye does (user's correction,
 * 2026-09-09 — the first cut had them upside down, lowest at the top).
 *
 * Explicit placement rather than `grid-auto-flow: column`, because an
 * auto flow fills each column from row 1 down: a lone fifth pad would
 * land at the TOP of the second column, out of line with the lowest note
 * beside it. This puts every column's first note on the bottom row,
 * partial columns included.
 */
export function padGridCell(index: number, rows: number): { column: number; row: number } {
	if (rows <= 0) return { column: 1, row: 1 };
	return { column: Math.floor(index / rows) + 1, row: rows - (index % rows) };
}

/** Each note paired with the pad that sits there, or null where the kit has none. */
export function padGridSlots(pads: readonly VmPad[], notes: readonly number[]): { note: number; pad: VmPad | null }[] {
	const byNote = new Map<number, VmPad>();
	for (const p of pads) byNote.set(p.note, p);
	return notes.map((note) => ({ note, pad: byNote.get(note) ?? null }));
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
