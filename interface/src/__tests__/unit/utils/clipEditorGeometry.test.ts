import { describe, it, expect } from 'vitest';
import {
	beatToX,
	xToBeat,
	pitchToY,
	yToPitch,
	laneHeight,
	clampBeatWindow,
	clampPitchWindow,
	zoomBeatWindow,
	zoomPitchWindow,
	panBeatWindow,
	clientDeltaToBeatDelta,
	clientDeltaToPitchDelta,
	foldLanes,
	shiftPitch,
	grabResizesNote,
	NOTE_RESIZE_EDGE_PX,
	defaultBeatWindow,
	defaultPitchWindow,
	MIDI_PITCH_MIN,
	MIDI_PITCH_MAX,
	type BeatWindow,
	type PitchWindow,
	noteInCell,
	nearestSpan,
	formatBeatPosition,
	formatNoteLength,
	TOUCH_SLOP_PX
} from '$lib/utils/clip/clipEditorGeometry';

const WIN: BeatWindow = { startBeats: 0, endBeats: 8 };
const PWIN: PitchWindow = { lowPitch: 60, highPitch: 71 }; // one octave, 12 lanes

describe('clipEditorGeometry — beats ↔ px', () => {
	it('maps window start to x=0 and end to x=width', () => {
		expect(beatToX(0, WIN, 800)).toBe(0);
		expect(beatToX(8, WIN, 800)).toBe(800);
	});

	it('maps the midpoint to half width', () => {
		expect(beatToX(4, WIN, 800)).toBe(400);
	});

	it('honors a non-zero window start', () => {
		const w = { startBeats: 4, endBeats: 8 };
		expect(beatToX(4, w, 400)).toBe(0);
		expect(beatToX(6, w, 400)).toBe(200);
		expect(beatToX(8, w, 400)).toBe(400);
	});

	it('xToBeat is the inverse of beatToX', () => {
		for (const beat of [0, 1.5, 4, 7.25, 8]) {
			const x = beatToX(beat, WIN, 800);
			expect(xToBeat(x, WIN, 800)).toBeCloseTo(beat, 6);
		}
	});

	it('returns window start on degenerate width', () => {
		expect(xToBeat(100, WIN, 0)).toBe(WIN.startBeats);
		expect(beatToX(4, { startBeats: 2, endBeats: 2 }, 800)).toBe(0);
	});
});

describe('clipEditorGeometry — pitch ↔ px', () => {
	it('places the highest pitch at the top (y=0)', () => {
		expect(pitchToY(71, PWIN, 240)).toBe(0);
	});

	it('places lower pitches further down', () => {
		// 12 lanes over 240px → 20px per lane.
		expect(pitchToY(70, PWIN, 240)).toBeCloseTo(20, 6);
		expect(pitchToY(60, PWIN, 240)).toBeCloseTo(220, 6);
	});

	it('laneHeight divides height by inclusive lane count', () => {
		expect(laneHeight(PWIN, 240)).toBeCloseTo(20, 6);
	});

	it('yToPitch inverts pitchToY at lane tops', () => {
		for (const p of [60, 65, 71]) {
			const y = pitchToY(p, PWIN, 240);
			expect(yToPitch(y, PWIN, 240)).toBeCloseTo(p, 6);
		}
	});
});

describe('clipEditorGeometry — window clamping', () => {
	it('keeps a beat window inside [0, total]', () => {
		expect(clampBeatWindow({ startBeats: -2, endBeats: 4 }, 16)).toEqual({
			startBeats: 0,
			endBeats: 6
		});
		expect(clampBeatWindow({ startBeats: 14, endBeats: 20 }, 16)).toEqual({
			startBeats: 10,
			endBeats: 16
		});
	});

	it('never lets the span exceed total', () => {
		const c = clampBeatWindow({ startBeats: 0, endBeats: 100 }, 16);
		expect(c.startBeats).toBe(0);
		expect(c.endBeats).toBe(16);
	});

	it('collapses to a unit window when total is non-positive', () => {
		expect(clampBeatWindow({ startBeats: 0, endBeats: 8 }, 0)).toEqual({
			startBeats: 0,
			endBeats: 1
		});
	});

	it('clamps pitch window to MIDI range and never inverts', () => {
		expect(clampPitchWindow({ lowPitch: -5, highPitch: 5 })).toEqual({
			lowPitch: MIDI_PITCH_MIN,
			highPitch: 10
		});
		const hi = clampPitchWindow({ lowPitch: 120, highPitch: 140 });
		expect(hi.highPitch).toBe(MIDI_PITCH_MAX);
		expect(hi.lowPitch).toBe(MIDI_PITCH_MAX - 20);
	});

	it('normalizes an inverted pitch window', () => {
		expect(clampPitchWindow({ lowPitch: 70, highPitch: 60 })).toEqual({
			lowPitch: 60,
			highPitch: 70
		});
	});
});

describe('clipEditorGeometry — zoom', () => {
	it('zooms in (factor<1) narrowing the span around the anchor', () => {
		const z = zoomBeatWindow(WIN, 0.5, 0.5, 16);
		expect(z.endBeats - z.startBeats).toBeCloseTo(4, 6);
		// Anchored at center → stays centered on beat 4.
		expect((z.startBeats + z.endBeats) / 2).toBeCloseTo(4, 6);
	});

	it('keeps the anchor beat under the same pixel when zooming at the left edge', () => {
		const z = zoomBeatWindow(WIN, 0.5, 0, 16);
		expect(z.startBeats).toBeCloseTo(0, 6);
		expect(z.endBeats).toBeCloseTo(4, 6);
	});

	it('zooms out (factor>1) but clamps to total', () => {
		const z = zoomBeatWindow(WIN, 4, 0.5, 16);
		expect(z.startBeats).toBe(0);
		expect(z.endBeats).toBe(16);
	});

	it('pans within bounds', () => {
		expect(panBeatWindow(WIN, 4, 16)).toEqual({ startBeats: 4, endBeats: 12 });
		// Clamps at the right edge.
		expect(panBeatWindow(WIN, 100, 16)).toEqual({ startBeats: 8, endBeats: 16 });
		// Clamps at the left edge.
		expect(panBeatWindow({ startBeats: 4, endBeats: 12 }, -100, 16)).toEqual({
			startBeats: 0,
			endBeats: 8
		});
	});

	it('halves a pitch window span, anchored at the top (exact preserved formula)', () => {
		// PWIN = 60..71 (12 lanes). factor 0.5, anchor 0:
		//   newSpan = max(2, round(12*0.5)) = 6
		//   anchorPitch = 71 - 0*12 = 71
		//   newLow = round(71 - 1*6) = 65 ; high = 65 + 6 - 1 = 70
		const z = zoomPitchWindow(PWIN, 0.5, 0);
		expect(z).toEqual({ lowPitch: 65, highPitch: 70 });
		expect(z.highPitch - z.lowPitch + 1).toBe(6);
	});

	it('never collapses a pitch window below 2 lanes', () => {
		const z = zoomPitchWindow(PWIN, 0.001, 0.5);
		expect(z.highPitch - z.lowPitch + 1).toBeGreaterThanOrEqual(2);
	});
});

describe('clipEditorGeometry — client→window deltas', () => {
	it('maps a pixel delta to a beat delta through the window span (sign-neutral)', () => {
		// half the width across an 8-beat window → 4 beats.
		expect(clientDeltaToBeatDelta(50, 100, WIN)).toBeCloseTo(4, 6);
		expect(clientDeltaToBeatDelta(-50, 100, WIN)).toBeCloseTo(-4, 6);
	});

	it('returns 0 beat delta for a degenerate width', () => {
		expect(clientDeltaToBeatDelta(50, 0, WIN)).toBe(0);
	});

	it('maps a pixel delta to a rounded pitch-lane delta', () => {
		// 12-lane window, half the height → 6 lanes.
		expect(clientDeltaToPitchDelta(50, 100, PWIN)).toBe(6);
		expect(clientDeltaToPitchDelta(-50, 100, PWIN)).toBe(-6);
	});

	it('returns 0 pitch delta for a degenerate height', () => {
		expect(clientDeltaToPitchDelta(50, 0, PWIN)).toBe(0);
	});
});

describe('clipEditorGeometry — default windows', () => {
	it('fills width with the loop window when looping', () => {
		expect(
			defaultBeatWindow({ looping: true, loopStartBeats: 2, loopEndBeats: 6, lengthBeats: 16 })
		).toEqual({ startBeats: 2, endBeats: 6 });
	});

	it('falls back to full clip length when not looping', () => {
		expect(
			defaultBeatWindow({ looping: false, loopStartBeats: 2, loopEndBeats: 6, lengthBeats: 16 })
		).toEqual({ startBeats: 0, endBeats: 16 });
	});

	it('falls back to a default extent for a zero-length clip', () => {
		expect(
			defaultBeatWindow({ looping: false, loopStartBeats: 0, loopEndBeats: 0, lengthBeats: 0 })
		).toEqual({ startBeats: 0, endBeats: 4 });
	});

	it('centers an empty pitch window on middle C with the minimum lanes', () => {
		const w = defaultPitchWindow([], 12);
		expect(w.highPitch - w.lowPitch + 1).toBe(12);
		expect(w.lowPitch).toBeLessThanOrEqual(60);
		expect(w.highPitch).toBeGreaterThanOrEqual(60);
	});

	it('fits notes with padding and guarantees minimum lanes', () => {
		const w = defaultPitchWindow([64], 12);
		expect(w.highPitch - w.lowPitch + 1).toBeGreaterThanOrEqual(12);
		expect(w.lowPitch).toBeLessThanOrEqual(64);
		expect(w.highPitch).toBeGreaterThanOrEqual(64);
	});

	it('spans a wide note set', () => {
		const w = defaultPitchWindow([40, 80], 12);
		expect(w.lowPitch).toBeLessThanOrEqual(40);
		expect(w.highPitch).toBeGreaterThanOrEqual(80);
	});
});

describe('clipEditorGeometry — fold', () => {
	// Three shown pitches out of a 60..71 window: 36 px of roll = 12 px each.
	const FOLD: PitchWindow = { ...PWIN, lanes: [60, 64, 67] };

	it('foldLanes: distinct pitches, ascending', () => {
		expect(foldLanes([67, 60, 64, 60, 67])).toEqual([60, 64, 67]);
		expect(foldLanes([])).toEqual([]);
	});

	it('each shown pitch gets an equal lane, highest on top', () => {
		expect(laneHeight(FOLD, 36)).toBe(12);
		expect(pitchToY(67, FOLD, 36)).toBe(0);
		expect(pitchToY(64, FOLD, 36)).toBe(12);
		expect(pitchToY(60, FOLD, 36)).toBe(24);
	});

	it('yToPitch answers the whole shown pitch under y', () => {
		expect(yToPitch(0, FOLD, 36)).toBe(67);
		expect(yToPitch(11.9, FOLD, 36)).toBe(67);
		expect(yToPitch(12, FOLD, 36)).toBe(64);
		expect(yToPitch(35, FOLD, 36)).toBe(60);
		expect(yToPitch(99, FOLD, 36)).toBe(60); // clamped to the bottom lane
	});

	it('a drag delta counts lanes, and shiftPitch steps between shown pitches', () => {
		expect(clientDeltaToPitchDelta(24, 36, FOLD)).toBe(2);
		expect(shiftPitch(60, 1, FOLD)).toBe(64);
		expect(shiftPitch(60, 2, FOLD)).toBe(67);
		expect(shiftPitch(60, 5, FOLD)).toBe(67); // stops at the top lane
		expect(shiftPitch(67, -9, FOLD)).toBe(60); // and the bottom
		expect(shiftPitch(62, 0, FOLD)).toBe(62); // no move leaves it alone
	});

	it('an empty lane list is the ordinary unfolded window', () => {
		const empty: PitchWindow = { ...PWIN, lanes: [] };
		expect(laneHeight(empty, 120)).toBe(laneHeight(PWIN, 120));
		expect(pitchToY(65, empty, 120)).toBe(pitchToY(65, PWIN, 120));
		expect(shiftPitch(60, 3, empty)).toBe(63);
		expect(shiftPitch(126, 5, PWIN)).toBe(127); // unfolded clamps to MIDI
	});
});

describe('grabResizesNote — a move never becomes a length change', () => {
	it('resizes a wide note only on its right-edge handle', () => {
		// 100px note: the right 14px resize, the rest moves.
		expect(grabResizesNote(95, 0, 100)).toBe(true);
		expect(grabResizesNote(100 - NOTE_RESIZE_EDGE_PX, 0, 100)).toBe(true);
		expect(grabResizesNote(80, 0, 100)).toBe(false);
		expect(grabResizesNote(10, 0, 100)).toBe(false);
	});

	it('only moves a note narrower than three handles, wherever it is grabbed', () => {
		// An eighth (~55px) keeps a handle; a sixteenth (~30px) does not.
		expect(grabResizesNote(52, 0, 55)).toBe(true);
		expect(grabResizesNote(28, 0, 30)).toBe(false);
		expect(grabResizesNote(41, 0, 41)).toBe(false);
	});
});

describe('noteInCell — a thin note is hit across its grid cell', () => {
	const notes = [
		{ noteId: 1, pitch: 60, startBeats: 0, durationBeats: 0.125 }, // a 1/32 in the first 1/16 cell
		{ noteId: 2, pitch: 60, startBeats: 0.5, durationBeats: 0.25 },
		{ noteId: 3, pitch: 62, startBeats: 0.25, durationBeats: 0.25 }
	];
	it('hits a note anywhere in a cell it overlaps, on its own pitch', () => {
		expect(noteInCell(notes, 60, 0.2, 0.25)).toBe(1);
		expect(noteInCell(notes, 60, 0.74, 0.25)).toBe(2);
		expect(noteInCell(notes, 62, 0.3, 0.25)).toBe(3);
	});
	it('leaves an empty cell to draw in, even right beside a note', () => {
		expect(noteInCell(notes, 60, 0.3, 0.25)).toBe(null); // the cell after note 1
		expect(noteInCell(notes, 61, 0.1, 0.25)).toBe(null); // the lane above
	});
	it('prefers the note covering more of the cell', () => {
		const two = [
			{ noteId: 7, pitch: 60, startBeats: 0, durationBeats: 0.3 },
			{ noteId: 8, pitch: 60, startBeats: 0.3, durationBeats: 1 }
		];
		expect(noteInCell(two, 60, 0.26, 0.25)).toBe(8); // cell 0.25..0.5: 7 covers .05, 8 covers .2
		expect(noteInCell(two, 60, 0.1, 0.25)).toBe(7); // cell 0..0.25: only 7
	});
});

describe('nearestSpan — a 3px velocity bar takes a fingertip', () => {
	const bars = [
		{ x: 10, w: 3 },
		{ x: 40, w: 3 }
	];
	it('takes a touch inside a bar, else the nearest within the slop', () => {
		expect(nearestSpan(11, bars)).toBe(0);
		expect(nearestSpan(30, bars)).toBe(1); // 10px from bar 1, 17 from bar 0
		expect(nearestSpan(26, bars)).toBe(0); // 13 from bar 0, 14 from bar 1
	});
	it('takes nothing farther than the slop', () => {
		expect(nearestSpan(100, bars)).toBe(null);
		expect(nearestSpan(43 + TOUCH_SLOP_PX + 1, bars)).toBe(null);
	});
});

describe('drag readout formatting', () => {
	it('names a position as bar.beat.sixteenth', () => {
		expect(formatBeatPosition(0, 4)).toBe('1.1.1');
		expect(formatBeatPosition(5.75, 4)).toBe('2.2.4');
		expect(formatBeatPosition(3, 3)).toBe('2.1.1');
	});
	it('names a length as a note value', () => {
		expect(formatNoteLength(0.25)).toBe('1/16');
		expect(formatNoteLength(1.5)).toBe('3/8');
		expect(formatNoteLength(4)).toBe('1');
		expect(formatNoteLength(1 / 6)).toBe('1/24');
	});
});
