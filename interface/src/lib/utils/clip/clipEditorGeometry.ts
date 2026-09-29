/**
 * clipEditorGeometry — clip-view-mirror M1.
 *
 * Pure coordinate math for the central clip editor: beats↔px on the X
 * axis and pitch↔px on the Y axis, both honoring a scroll/zoom window.
 * No Svelte, no DOM — all functions are referentially transparent so
 * the zoom/scroll math is unit-testable in isolation.
 *
 * The X window is a beat range `[viewStartBeats, viewEndBeats]` mapped
 * onto a pixel width. The Y window is a MIDI pitch range
 * `[viewLowPitch, viewHighPitch]` mapped onto a pixel height, with
 * pitch increasing upward (higher pitch = smaller y).
 *
 * A window may also be FOLDED (Live's Fold): `lanes` lists the only
 * pitches shown, ascending, each one lane of equal height regardless of
 * the gaps between them. Every pitch↔px function below honors it, and a
 * pitch "delta" through a folded window counts lanes, not semitones —
 * use `shiftPitch` to apply one.
 */

export const MIDI_PITCH_MIN = 0;
export const MIDI_PITCH_MAX = 127;

export interface BeatWindow {
	/** Left edge of the visible beat range. */
	startBeats: number;
	/** Right edge of the visible beat range. */
	endBeats: number;
}

export interface PitchWindow {
	/** Lowest visible MIDI pitch (inclusive). */
	lowPitch: number;
	/** Highest visible MIDI pitch (inclusive). */
	highPitch: number;
	/** Folded: the only pitches shown, ascending and distinct. Absent or
	 *  empty = every semitone from lowPitch to highPitch. */
	lanes?: number[];
}

function foldedLanes(win: PitchWindow): number[] | null {
	return win.lanes && win.lanes.length > 0 ? win.lanes : null;
}

/** Lane count of a window: folded lanes, or the inclusive semitone span. */
function laneCount(win: PitchWindow): number {
	const lanes = foldedLanes(win);
	return lanes ? lanes.length : win.highPitch - win.lowPitch + 1;
}

/**
 * Fold lanes for a set of note pitches: each distinct pitch once,
 * ascending — what Live's Fold shows.
 */
export function foldLanes(pitches: number[]): number[] {
	return Array.from(new Set(pitches)).sort((a, b) => a - b);
}

/**
 * Move a pitch by `laneDelta` lanes through a window. Unfolded, a lane is
 * a semitone (clamped to MIDI). Folded, it steps to the neighbouring shown
 * pitch, stopping at the top and bottom lanes; a pitch not in the fold
 * steps from the nearest lane at or below it.
 */
export function shiftPitch(pitch: number, laneDelta: number, win: PitchWindow): number {
	const lanes = foldedLanes(win);
	if (!lanes) return Math.max(MIDI_PITCH_MIN, Math.min(MIDI_PITCH_MAX, pitch + laneDelta));
	if (laneDelta === 0) return pitch;
	const idx = laneIndexAtOrBelow(pitch, lanes);
	return lanes[Math.max(0, Math.min(lanes.length - 1, idx + laneDelta))];
}

/** Index of the highest lane at or below `pitch` (0 when below them all). */
function laneIndexAtOrBelow(pitch: number, lanes: number[]): number {
	let idx = 0;
	for (let i = 0; i < lanes.length; i++) if (lanes[i] <= pitch) idx = i;
	return idx;
}

/** Convert a beat position to an x pixel within `widthPx`. */
export function beatToX(beats: number, win: BeatWindow, widthPx: number): number {
	const span = win.endBeats - win.startBeats;
	if (span <= 0) return 0;
	return ((beats - win.startBeats) / span) * widthPx;
}

/** Convert an x pixel within `widthPx` back to a beat position. */
export function xToBeat(x: number, win: BeatWindow, widthPx: number): number {
	if (widthPx <= 0) return win.startBeats;
	const span = win.endBeats - win.startBeats;
	return win.startBeats + (x / widthPx) * span;
}

/**
 * Convert a MIDI pitch to a y pixel within `heightPx`. Pitch increases
 * upward: the highest visible pitch sits at y=0, the lowest at the
 * bottom. The returned value is the *top* of that pitch's lane.
 */
export function pitchToY(pitch: number, win: PitchWindow, heightPx: number): number {
	const span = laneCount(win); // inclusive lane count
	if (span <= 0) return 0;
	const lanes = foldedLanes(win);
	// Folded: a pitch outside the fold sits on the nearest lane below it.
	const lanesFromTop = lanes ? lanes.length - 1 - laneIndexAtOrBelow(pitch, lanes) : win.highPitch - pitch;
	return (lanesFromTop / span) * heightPx;
}

/** Height in px of a single semitone lane for the given pitch window. */
export function laneHeight(win: PitchWindow, heightPx: number): number {
	const span = laneCount(win);
	if (span <= 0) return 0;
	return heightPx / span;
}

/**
 * Convert a y pixel within `heightPx` back to a (fractional) MIDI pitch.
 * Folded, the answer is always a whole shown pitch — the lane under y.
 */
export function yToPitch(y: number, win: PitchWindow, heightPx: number): number {
	const lanes = foldedLanes(win);
	if (lanes) {
		if (heightPx <= 0) return lanes[lanes.length - 1];
		const fromTop = Math.floor((y / heightPx) * lanes.length);
		return lanes[lanes.length - 1 - Math.max(0, Math.min(lanes.length - 1, fromTop))];
	}
	if (heightPx <= 0) return win.highPitch;
	const span = win.highPitch - win.lowPitch + 1;
	const lanesFromTop = (y / heightPx) * span;
	return win.highPitch - lanesFromTop;
}

/**
 * Clamp a beat window so it never inverts and never escapes
 * `[0, totalBeats]`. A degenerate `totalBeats <= 0` collapses to a
 * unit window so downstream divisions stay finite.
 */
export function clampBeatWindow(win: BeatWindow, totalBeats: number): BeatWindow {
	if (totalBeats <= 0) return { startBeats: 0, endBeats: 1 };
	let span = win.endBeats - win.startBeats;
	if (span <= 0) span = totalBeats;
	span = Math.min(span, totalBeats);
	let start = win.startBeats;
	if (start < 0) start = 0;
	if (start + span > totalBeats) start = totalBeats - span;
	if (start < 0) start = 0;
	return { startBeats: start, endBeats: start + span };
}

/**
 * Clamp a pitch window to `[MIDI_PITCH_MIN, MIDI_PITCH_MAX]`, keeping at
 * least one visible lane and never inverting.
 */
export function clampPitchWindow(win: PitchWindow): PitchWindow {
	let low = Math.round(win.lowPitch);
	let high = Math.round(win.highPitch);
	if (high < low) [low, high] = [high, low];
	const span = Math.min(high - low, MIDI_PITCH_MAX - MIDI_PITCH_MIN);
	if (low < MIDI_PITCH_MIN) low = MIDI_PITCH_MIN;
	if (low + span > MIDI_PITCH_MAX) low = MIDI_PITCH_MAX - span;
	if (low < MIDI_PITCH_MIN) low = MIDI_PITCH_MIN;
	return { lowPitch: low, highPitch: low + span };
}

/**
 * Zoom a beat window around an anchor fraction (0=left edge, 1=right
 * edge of the current view). `factor < 1` zooms in (narrows the span),
 * `factor > 1` zooms out. The anchor beat stays under the same pixel.
 */
export function zoomBeatWindow(
	win: BeatWindow,
	factor: number,
	anchorFraction: number,
	totalBeats: number
): BeatWindow {
	const span = win.endBeats - win.startBeats;
	const anchorBeat = win.startBeats + span * anchorFraction;
	const newSpan = span * factor;
	const newStart = anchorBeat - newSpan * anchorFraction;
	return clampBeatWindow({ startBeats: newStart, endBeats: newStart + newSpan }, totalBeats);
}

/**
 * Zoom a pitch window around an anchor fraction (0=top/highest pitch,
 * 1=bottom/lowest pitch of the current view). `factor < 1` zooms in
 * (narrows the span), `factor > 1` zooms out. Mirrors `zoomBeatWindow`
 * for the Y axis; the anchor pitch stays under the same pixel. The result
 * is clamped (and keeps at least 2 visible lanes).
 */
export function zoomPitchWindow(
	win: PitchWindow,
	factor: number,
	anchorFraction: number
): PitchWindow {
	const span = win.highPitch - win.lowPitch + 1; // inclusive lane count
	const newSpan = Math.max(2, Math.round(span * factor));
	const anchorPitch = win.highPitch - anchorFraction * span;
	const newLow = Math.round(anchorPitch - (1 - anchorFraction) * newSpan);
	return clampPitchWindow({ lowPitch: newLow, highPitch: newLow + newSpan - 1 });
}

/**
 * Convert a horizontal pixel drag delta into a beat delta through the
 * given beat window. Sign-neutral: the caller negates for inverse-drag
 * (panning the window opposite the finger) vs. direct-drag (moving an
 * object with the finger). Returns 0 for a degenerate width.
 */
export function clientDeltaToBeatDelta(
	clientDeltaPx: number,
	contentWidthPx: number,
	win: BeatWindow
): number {
	if (contentWidthPx <= 0) return 0;
	const span = win.endBeats - win.startBeats;
	return (clientDeltaPx / contentWidthPx) * span;
}

/**
 * Convert a vertical pixel drag delta into a (rounded) pitch-lane delta
 * through the given pitch window — semitones unfolded, shown lanes folded
 * (apply it with `shiftPitch`). Sign-neutral — the caller negates as
 * needed. Returns 0 for a degenerate height.
 */
export function clientDeltaToPitchDelta(
	clientDeltaPx: number,
	contentHeightPx: number,
	win: PitchWindow
): number {
	if (contentHeightPx <= 0) return 0;
	return Math.round((clientDeltaPx / contentHeightPx) * laneCount(win));
}

/** Width of a note's resize handle, in px back from its right edge. */
export const NOTE_RESIZE_EDGE_PX = 14;

/**
 * Does a grab at `localX` on a note drawn from `noteX` to `noteEndX`
 * resize it rather than move it? Only on the handle at its right edge,
 * and only on a note wide enough to leave a body three handles wide: on
 * the iPad an eighth note is ~55px and a sixteenth ~30px, and a fixed
 * handle took a quarter to half of them, so a move grabbed there changed
 * the note's length instead. A narrower note only moves; zoom in to
 * stretch it.
 */
export function grabResizesNote(
	localX: number,
	noteX: number,
	noteEndX: number,
	edgePx = NOTE_RESIZE_EDGE_PX
): boolean {
	if (noteEndX - noteX < edgePx * 3) return false;
	return noteEndX - localX <= edgePx;
}

/** Pan a beat window by a beat delta, clamped to `[0, totalBeats]`. */
export function panBeatWindow(win: BeatWindow, deltaBeats: number, totalBeats: number): BeatWindow {
	return clampBeatWindow(
		{ startBeats: win.startBeats + deltaBeats, endBeats: win.endBeats + deltaBeats },
		totalBeats
	);
}

/**
 * Default beat window for a freshly-focused clip: the visible loop
 * window fills the width (plan M1 — "sane default zoom = visible loop
 * window fills width"). Falls back to the full clip length when the
 * clip isn't looping or the loop bounds are degenerate.
 */
export function defaultBeatWindow(args: {
	looping: boolean;
	loopStartBeats: number;
	loopEndBeats: number;
	lengthBeats: number;
}): BeatWindow {
	const { looping, loopStartBeats, loopEndBeats, lengthBeats } = args;
	if (looping && loopEndBeats > loopStartBeats) {
		return { startBeats: loopStartBeats, endBeats: loopEndBeats };
	}
	const end = lengthBeats > 0 ? lengthBeats : 4;
	return { startBeats: 0, endBeats: end };
}

/**
 * Default pitch window from a set of note pitches: center the visible
 * range on the notes' span with a little padding, guaranteeing a
 * minimum number of visible lanes so a single-pitch clip doesn't show
 * one fat lane filling the height. Empty → a sensible mid-keyboard band.
 */
export function defaultPitchWindow(pitches: number[], minLanes = 12): PitchWindow {
	if (pitches.length === 0) {
		const center = 60; // middle C
		const half = Math.floor(minLanes / 2);
		return clampPitchWindow({ lowPitch: center - half, highPitch: center - half + minLanes - 1 });
	}
	let lo = Infinity;
	let hi = -Infinity;
	for (const p of pitches) {
		if (p < lo) lo = p;
		if (p > hi) hi = p;
	}
	const pad = 2;
	lo -= pad;
	hi += pad;
	const span = hi - lo + 1;
	if (span < minLanes) {
		const grow = minLanes - span;
		lo -= Math.floor(grow / 2);
		hi += Math.ceil(grow / 2);
	}
	return clampPitchWindow({ lowPitch: lo, highPitch: hi });
}
