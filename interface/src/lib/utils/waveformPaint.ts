/**
 * waveformPaint — the one canvas routine behind every waveform that draws
 * `/api/sample-peaks` data: the strip and session-grid clip preview
 * (`ClipPreview`), the clip editor (`ClipEditorView`) and the Simpler
 * overview (`SimplerLoopControl`). The browser's baked sample thumbnails
 * (`BrowserPresetWaveform`) are one-sided bars in a different look and
 * stay on their own.
 *
 * Why one routine: each of those used to pick "which slice of the peaks
 * array is on screen" for itself, and two of them got it wrong the same
 * way. A peaks array covers the WHOLE audio file; the clip views assumed
 * that file spans `[0, clip.length]`, but Live's `length` on a looping
 * clip is the loop's length. A 28-beat take looping 16..24 reports length
 * 8, so the strip went looking for beats 16..24 inside a file it believed
 * ended at 8 and drew nothing (measured on the rig, 2026-09-18).
 *
 * So the geometry here is in TIME, not bins: `span` is the time the peaks
 * array covers, `view` is the time the canvas shows, and each bar is placed
 * where its own slice of time falls. A view that runs past either end of
 * the file leaves canvas empty there instead of stretching what's left.
 */

export type PeakPair = [number, number];

/** A stretch of clip time — beats for warped audio, seconds unwarped. */
export interface TimeRange {
	start: number;
	end: number;
}

/**
 * The time a clip's peaks array covers.
 *
 * `fileStart` / `fileEnd` come off the wire (`playing_slot`, `clip/sample`)
 * and are `0, 0` when unknown — MIDI, a take still flushing, a surface from
 * before the field. Unknown falls back to `[0, fallbackEnd]`, the old guess,
 * which is right for a clip whose file starts at beat 0 and is played whole.
 */
export function peakSpan(fileStart: number, fileEnd: number, fallbackEnd: number): TimeRange {
	if (fileEnd > fileStart) return { start: fileStart, end: fileEnd };
	return { start: 0, end: fallbackEnd };
}

/**
 * The time a clip preview shows: `[loopStart, loopEnd]` whenever that is a
 * real range — whether or not the clip is looping — otherwise the whole
 * file (span known), otherwise `[0, lengthBeats]`.
 *
 * Live reports a clip's playable range in the loop fields either way. A
 * looping clip's are its loop; a clip that isn't looping reports its START
 * and END MARKERS there — measured 2026-09-18: a warped clip looping 0..4
 * with its end marker at 8 read `loop_end` 8 the moment looping went off,
 * and an unwarped take (which can't loop) read `loop_start` equal to its
 * start marker, 10.16 s. Don't read the markers themselves: on that
 * unwarped take `end_marker` read 28.0 — beats — beside a 17.78 s file, and
 * `length` was stale the same way.
 *
 * The playhead reads this too (`playingClipsStore.visibleWindow`), so the
 * line and the waveform are placed against one window by construction.
 */
export function clipViewWindow(args: {
	loopStartBeats: number;
	loopEndBeats: number;
	lengthBeats: number;
	fileStartBeats: number;
	fileEndBeats: number;
}): TimeRange {
	if (args.loopEndBeats > args.loopStartBeats) {
		return { start: args.loopStartBeats, end: args.loopEndBeats };
	}
	return peakSpan(args.fileStartBeats, args.fileEndBeats, args.lengthBeats);
}

/**
 * Which bins of an `count`-long peaks array covering `span` fall inside
 * `view`: `[binStart, binEnd)`, or null when none do (a view wholly outside
 * the file, or a degenerate range).
 */
export function peakBinRange(
	count: number,
	span: TimeRange,
	view: TimeRange
): { binStart: number; binEnd: number } | null {
	const spanSize = span.end - span.start;
	if (count <= 0 || !(spanSize > 0) || !(view.end > view.start)) return null;
	const binStart = Math.max(0, Math.floor(((view.start - span.start) / spanSize) * count));
	const binEnd = Math.min(count, Math.ceil(((view.end - span.start) / spanSize) * count));
	return binEnd > binStart ? { binStart, binEnd } : null;
}

/**
 * How peaks become bar heights.
 *
 * - `perceptual` (the clip views): normalized to the loudest visible bin
 *   with a 20× gain cap, then a 0.6-power curve — quiet takes read tall
 *   without amplifying a noise floor.
 * - `linear` (the Simpler overview): plain normalization to the loudest bin.
 */
export type AmplitudeCurve = 'perceptual' | 'linear';

const MAX_GAIN = 20;
const SHAPE = 0.6;

export interface PaintPeaksOptions {
	/** Time the peaks array covers. */
	span: TimeRange;
	/** Time the canvas shows, left edge to right edge. */
	view: TimeRange;
	amplitude: AmplitudeCurve;
	/** Fraction of the half-height the loudest bar reaches. */
	headroom: number;
	/**
	 * Where a point of the file lands on the view's time axis, for a file
	 * that is not laid out evenly across `span` — a warped clip, placed
	 * through its warp markers. `fraction` is 0 at the file's first sample
	 * and 1 at its last; must be increasing. Absent: evenly across `span`.
	 */
	place?: (fraction: number) => number;
	/**
	 * Fill for one bar. `x0` / `x1` are its UNROUNDED canvas-pixel edges, so
	 * an in-loop test reads the same fractional position it always did.
	 */
	ink: (x0: number, x1: number) => string | CanvasGradient;
}

/**
 * Paint `peaks` onto the whole of `ctx`'s canvas (`width` × `height` in
 * backing pixels). Does not clear — callers own the canvas.
 *
 * Both edges of each bar snap to the pixel grid (`round`), so adjacent bars
 * share an exact edge; `floor(x) + ceil(width)` left 1px seams wherever the
 * fractional bar width drifted against the grid.
 */
export function paintPeaks(
	ctx: CanvasRenderingContext2D,
	peaks: readonly PeakPair[],
	width: number,
	height: number,
	opts: PaintPeaksOptions
): void {
	const count = peaks.length;
	const place = opts.place;
	const range = place ? placedBinRange(count, place, opts.view) : peakBinRange(count, opts.span, opts.view);
	if (!range || width <= 0 || height <= 0) return;
	const { binStart, binEnd } = range;

	let maxAbs = 0;
	for (let i = binStart; i < binEnd; i++) {
		const [min, max] = peaks[i];
		const a = Math.max(Math.abs(min), Math.abs(max));
		if (a > maxAbs) maxAbs = a;
	}
	const perceptual = opts.amplitude === 'perceptual';
	const norm = maxAbs > 0 ? (perceptual ? Math.min(1 / maxAbs, MAX_GAIN) : 1 / maxAbs) : 1;
	const shape = (v: number) =>
		perceptual ? Math.pow(Math.min(1, Math.abs(v) * norm), SHAPE) * Math.sign(v) : v * norm;

	const mid = height / 2;
	const ampScale = mid * opts.headroom;
	const binTime = (opts.span.end - opts.span.start) / count;
	const pxPerTime = width / (opts.view.end - opts.view.start);
	const timeAt = place
		? (bin: number) => place(bin / count)
		: (bin: number) => opts.span.start + bin * binTime;
	const xAt = (bin: number) => (timeAt(bin) - opts.view.start) * pxPerTime;

	for (let i = binStart; i < binEnd; i++) {
		const [min, max] = peaks[i];
		const x0 = xAt(i);
		const x1 = xAt(i + 1);
		const y1 = mid - shape(max) * ampScale;
		const y2 = mid - shape(min) * ampScale;
		const left = Math.round(x0);
		const right = Math.round(x1);
		ctx.fillStyle = opts.ink(x0, x1);
		ctx.fillRect(left, Math.floor(y1), Math.max(1, right - left), Math.max(1, y2 - y1));
	}
}

/** `peakBinRange` for a file placed by `place` rather than evenly. */
function placedBinRange(
	count: number,
	place: (fraction: number) => number,
	view: TimeRange
): { binStart: number; binEnd: number } | null {
	if (count <= 0 || !(view.end > view.start)) return null;
	let binStart = 0;
	while (binStart < count && place((binStart + 1) / count) <= view.start) binStart++;
	let binEnd = count;
	while (binEnd > binStart && place((binEnd - 1) / count) >= view.end) binEnd--;
	return binEnd > binStart ? { binStart, binEnd } : null;
}
