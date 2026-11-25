/**
 * Reading the v3 wire's positional paths (`tracks/<N>`, `master`,
 * `returns/<N>`, `tracks/<N>/slots/<M>/clip` …) in one place.
 *
 * Pure string helpers with no imports, so any layer can use them without
 * closing an import cycle. Pad paths live in `padPaths.ts`, the FX grid's
 * track-scope keys in `trackScopePaths.ts`, and the param/device splitters
 * the store's reconciler needs (`splitParamPath`, `splitTrackPath`) in
 * `stores/v3/normalized.svelte.ts`.
 */

const TRACK_RE = /^tracks\/(\d+)$/;
const TRACK_PREFIX_RE = /^(tracks\/\d+|returns\/\d+|master)(?:\/|$)/;
const SLOT_RE = /^(tracks\/(\d+))\/slots\/(\d+)$/;
const CLIP_RE = /^(tracks\/(\d+))\/slots\/(\d+)\/clip$/;

/**
 * The index the UI's track selection uses for a track path: `tracks/<N>` →
 * N, `master` → -1. Null for anything else (a return, a deeper path, junk).
 */
export function trackIndexOf(trackPath: string): number | null {
	if (trackPath === 'master') return -1;
	const m = TRACK_RE.exec(trackPath);
	return m ? Number(m[1]) : null;
}

/** The regular track a path is `tracks/<N>` exactly, as N; else null. */
export function regularTrackIndexOf(trackPath: string): number | null {
	const m = TRACK_RE.exec(trackPath);
	return m ? Number(m[1]) : null;
}

/**
 * The track any path sits on (`tracks/3/devices/1/params/0` → `tracks/3`;
 * `master/devices/0` → `master`; `returns/1` → `returns/1`), or null.
 */
export function trackOf(path: string): string | null {
	const m = TRACK_PREFIX_RE.exec(path);
	return m ? m[1] : null;
}

export interface SlotRef {
	trackPath: string;
	trackIndex: number;
	sceneIndex: number;
	slotPath: string;
}

/** `tracks/<N>/slots/<M>` → its track and scene; null for any other shape. */
export function parseSlotPath(slotPath: string): SlotRef | null {
	const m = SLOT_RE.exec(slotPath);
	if (!m) return null;
	return { trackPath: m[1], trackIndex: Number(m[2]), sceneIndex: Number(m[3]), slotPath };
}

/** `tracks/<N>/slots/<M>/clip` → its track, scene and slot; null otherwise
 *  (an arrangement clip, a return's slot, junk). */
export function parseClipPath(clipPath: string): SlotRef | null {
	const m = CLIP_RE.exec(clipPath);
	if (!m) return null;
	return {
		trackPath: m[1],
		trackIndex: Number(m[2]),
		sceneIndex: Number(m[3]),
		slotPath: `${m[1]}/slots/${m[3]}`
	};
}
