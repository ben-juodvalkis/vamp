/**
 * Warp markers of the focused audio clip (`/looping/v3/clip/warp_markers`):
 * where each marker sits in clip beats and in the file, and the
 * piecewise-linear map between them that places a warped waveform.
 *
 * Measured on the rig (`docs/reference/live-api-measurements.md`): a fresh
 * warped clip has three markers — start, end, and a hidden one 1/32 beat
 * past the end, which moves with the end marker. The hidden one is not
 * drawn, not draggable, and not used to extrapolate.
 */

export interface WarpMarker {
	/** Clip time, beats. */
	beat: number;
	/** File time, seconds. */
	sec: number;
}

/** Live's hidden trailing marker sits this far past the last one. */
export const HIDDEN_MARKER_BEATS = 1 / 32;
const HIDDEN_EPS = 1e-3;

/** `[b0, s0, b1, s1, …]` off the wire → markers; a trailing odd value is dropped. */
export function parseWarpMarkers(values: readonly number[]): WarpMarker[] {
	const out: WarpMarker[] = [];
	for (let i = 0; i + 1 < values.length; i += 2) {
		const beat = values[i];
		const sec = values[i + 1];
		if (Number.isFinite(beat) && Number.isFinite(sec)) out.push({ beat, sec });
	}
	return out;
}

/** Whether the last marker is Live's hidden one. */
function hasHidden(markers: readonly WarpMarker[]): boolean {
	const n = markers.length;
	if (n < 2) return false;
	const gap = markers[n - 1].beat - markers[n - 2].beat;
	return gap > 0 && gap <= HIDDEN_MARKER_BEATS + HIDDEN_EPS;
}

/** The markers a performer sees and drags: all but the hidden one. */
export function shownMarkers(markers: readonly WarpMarker[]): WarpMarker[] {
	return hasHidden(markers) ? markers.slice(0, -1) : markers.slice();
}

/**
 * File seconds → clip beats through the markers, straight lines between
 * neighbors and the outermost segments extended past either end. Null when
 * fewer than two markers make a line.
 */
export function secToBeat(shown: readonly WarpMarker[], sec: number): number | null {
	const n = shown.length;
	if (n < 2) return null;
	let i = 0;
	if (sec >= shown[n - 1].sec) i = n - 2;
	else if (sec > shown[0].sec) {
		while (i < n - 2 && sec > shown[i + 1].sec) i++;
	}
	const a = shown[i];
	const b = shown[i + 1];
	const ds = b.sec - a.sec;
	if (!(ds > 0)) return a.beat;
	return a.beat + ((sec - a.sec) / ds) * (b.beat - a.beat);
}

/**
 * Where marker `index` of `shown` may be dragged: strictly between its
 * neighbors by `minGap`. The last marker has no ceiling — Live carries the
 * hidden one with it.
 */
export function markerBounds(
	shown: readonly WarpMarker[],
	index: number,
	minGap: number
): { min: number; max: number } {
	const min = index > 0 ? shown[index - 1].beat + minGap : -Infinity;
	const max = index < shown.length - 1 ? shown[index + 1].beat - minGap : Infinity;
	return { min, max };
}

/**
 * The drop point for a marker dragged to `beat`: snapped to `gridBeats`,
 * then held inside its bounds (which win over the grid).
 */
export function dragTarget(
	shown: readonly WarpMarker[],
	index: number,
	beat: number,
	gridBeats: number,
	minGap: number
): number {
	const snapped = gridBeats > 0 ? Math.round(beat / gridBeats) * gridBeats : beat;
	const { min, max } = markerBounds(shown, index, minGap);
	return Math.min(max, Math.max(min, snapped));
}

/**
 * `markers` with the one at `fromBeat` moved to `toBeat`, as Live would
 * leave them: its audio point stays, and moving the last shown marker
 * carries the hidden one the same distance.
 */
export function moveMarker(
	markers: readonly WarpMarker[],
	fromBeat: number,
	toBeat: number
): WarpMarker[] {
	const hidden = hasHidden(markers);
	const lastShown = hidden ? markers.length - 2 : markers.length - 1;
	const distance = toBeat - fromBeat;
	return markers.map((m, i) => {
		if (Math.abs(m.beat - fromBeat) < 1e-9) return { ...m, beat: toBeat };
		if (hidden && i === markers.length - 1 && Math.abs(markers[lastShown].beat - fromBeat) < 1e-9) {
			return { ...m, beat: m.beat + distance };
		}
		return m;
	});
}
