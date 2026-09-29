/**
 * playingClipsStore — ADR-360.
 *
 * Per-track playing-clip state for the TrackClipView strip render.
 * Keyed by `trackPath` (e.g. `tracks/0`). Each entry carries the
 * render context the strip needs:
 *
 *   - clip identity (`slotIdx`, `clipPath`, `isAudioClip`, `filePath`)
 *   - render extent (`lengthBeats`, `loopStartBeats`, `loopEndBeats`,
 *     `looping`)
 *   - status (stopped / playing / recording)
 *   - the latest `positionBeats` from the surface's throttled `playhead`
 *     emit — painted as-is, no client-side extrapolation
 *
 * Direct-position model (no anchor/rate):
 * The surface ships `clip.playing_position` straight to the UI at 30 Hz
 * via `/looping/v3/track/playhead`. We paint it. When transport stops,
 * `playing_position` listeners stop firing on the LOM side, so emits
 * stop, so the playhead stops — no extra signalling needed. ~33 ms
 * quantized motion is acceptable on the small track-strip render.
 *
 * Loop-bound observation lives in `clipPropertiesStore` (focused clip).
 * When the playing clip and the focused clip are the same — the common
 * case — the property listeners fire and update loop bounds without a
 * separate channel. The cross-subscriber (`patchLoopWindowFromProperty`)
 * lets `v3Clip.ts` push loop changes into matching entries by
 * `clipPath` so a brace drag on a non-focused-but-playing clip still
 * updates the strip view in real time.
 */

import { SvelteMap } from 'svelte/reactivity';
import { logger } from '$lib/utils/logger';
import { clipViewWindow } from '$lib/utils/waveformPaint';

export interface PlayingClipEntry {
	/** Slot index on the track. `-1` when nothing on the track. */
	slotIdx: number;
	/** 0 stopped, 1 playing, 2 recording. */
	status: number;
	/** True when the playing clip is audio. False for MIDI / unknown. */
	isAudioClip: boolean;
	/** Absolute path for the audio sample (audio clips only). */
	filePath: string;
	/** Canonical clip path (`tracks/<N>/slots/<M>/clip`) — empty when stopped. */
	clipPath: string;
	/** Clip length in beats. */
	lengthBeats: number;
	/** Loop start in beats (0..length). */
	loopStartBeats: number;
	/** Loop end in beats (loopStart..length). */
	loopEndBeats: number;
	/** Whether the clip is looping. False → render full clip. */
	looping: boolean;
	/**
	 * Where the audio file starts and ends in the clip's own time — the
	 * span the peaks array covers. Same unit as the loop fields (beats
	 * warped, seconds unwarped). `0, 0` = unknown: MIDI, a take still
	 * flushing, or a surface older than the field; renderers then fall
	 * back to `[0, lengthBeats]`, which is wrong for any looping clip
	 * whose loop doesn't start at the top of its file — `lengthBeats` is
	 * the loop's length there, not the file's.
	 */
	fileStartBeats: number;
	fileEndBeats: number;
	/** Latest `clip.playing_position` from the surface. Painted directly. */
	positionBeats: number;
}

// Two maps so the high-frequency channel (positionBeats / status from
// the 30 Hz playhead emit) doesn't invalidate the gestural channel
// (slot identity, render context, loop window). Components reading
// `playingClipsStore.get(trackPath)` see a stable object reference
// across position updates; reading `playingClipsStore.position(trackPath)`
// is the audio-rate channel and only the playhead-line consumer
// subscribes to it.
const playingClips = new SvelteMap<string, PlayingClipEntry>();
const playheadPositions = new SvelteMap<string, { positionBeats: number; status: number }>();
// Reverse index: `clipPath → trackPath`. Maintained on every
// `applyPlayingSlot` write so `patchLoopWindowFromProperty` can do an
// O(1) lookup instead of scanning every track on each `loop_start` /
// `loop_end` / `looping` property fire (those can land at 30 Hz during
// a brace drag). Plain Map — only `patchLoopWindowFromProperty` reads
// it, and it's a pure index (no reactive consumers). Cleared on
// `bridge-resync` alongside the other maps.
const clipPathToTrackPath = new Map<string, string>();

function emptyEntry(): PlayingClipEntry {
	return {
		slotIdx: -1,
		status: 0,
		isAudioClip: false,
		filePath: '',
		clipPath: '',
		lengthBeats: 0,
		loopStartBeats: 0,
		loopEndBeats: 0,
		looping: false,
		fileStartBeats: 0,
		fileEndBeats: 0,
		positionBeats: 0
	};
}

/** Public accessor — derived consumers read via `$derived(playingClipsStore.get(...))`. */
export const playingClipsStore = {
	get(trackPath: string): PlayingClipEntry | undefined {
		return playingClips.get(trackPath);
	},
	/**
	 * High-frequency position read for the playhead-line consumer only.
	 * Updates at 30 Hz × N tracks; do not call from $effects that drive
	 * canvas / DOM-heavy work. Returns the `positionBeats` from the
	 * underlying entry if no separate position is set yet (fresh slot
	 * before the first playhead emit lands).
	 */
	position(trackPath: string): number {
		const p = playheadPositions.get(trackPath);
		if (p !== undefined) return p.positionBeats;
		return playingClips.get(trackPath)?.positionBeats ?? 0;
	},
	/** Live status — updates with each playhead emit (recording flips visible promptly). */
	liveStatus(trackPath: string): number {
		const p = playheadPositions.get(trackPath);
		if (p !== undefined) return p.status;
		return playingClips.get(trackPath)?.status ?? 0;
	},
	size(): number {
		return playingClips.size;
	}
};

/**
 * Apply a `playing_slot` wire message. Replaces the entry for
 * `trackPath` wholesale because the slot identity changes — partial
 * patching would leave stale `clipPath` / `filePath` bound to a
 * previous clip.
 *
 * `slotIdx === -1` clears the entry to a stopped frame.
 */
export function applyPlayingSlot(args: {
	trackPath: string;
	slotIdx: number;
	isAudioClip: boolean;
	filePath: string;
	lengthBeats: number;
	loopStartBeats: number;
	loopEndBeats: number;
	looping: boolean;
	status: number;
	/** Absent from a surface older than the field — read as unknown. */
	fileStartBeats?: number;
	fileEndBeats?: number;
}): void {
	const prior = playingClips.get(args.trackPath);
	// Reset the high-frequency position channel on slot identity change
	// — a stale position from the prior clip would otherwise paint until
	// the next 30 Hz tick lands. A re-send of the SAME clip (an edit, a
	// reconnect) keeps it: with the transport stopped no tick follows, and
	// dropping it put a held clip's playhead at its start while Live held
	// it mid-loop. The surface also re-states the position after every
	// re-send of a live clip; this covers the gap between the two.
	const sameClip =
		prior !== undefined &&
		prior.slotIdx === args.slotIdx &&
		args.slotIdx >= 0 &&
		prior.filePath === args.filePath &&
		prior.isAudioClip === args.isAudioClip;
	if (!sameClip) playheadPositions.delete(args.trackPath);
	else {
		// Keep the position, but not a status the frame contradicts:
		// `liveStatus` reads this map first, and after a clip stop (Live's
		// `playing_slot_index` -2, re-sent as the same slot with status 0)
		// no playhead tick follows to correct it. The cell then stayed
		// "playing", so a tap on it sent another stop and the clip could
		// not be relaunched from its slot.
		const pos = playheadPositions.get(args.trackPath);
		if (pos !== undefined && pos.status !== args.status) {
			playheadPositions.set(args.trackPath, { positionBeats: pos.positionBeats, status: args.status });
		}
	}
	// Drop the prior clipPath→trackPath mapping (if any) — the track
	// is rotating to a new slot. Done before re-set so a same-path
	// re-emit lands on a clean slate.
	if (prior !== undefined && prior.clipPath !== '') {
		if (clipPathToTrackPath.get(prior.clipPath) === args.trackPath) {
			clipPathToTrackPath.delete(prior.clipPath);
		}
	}
	if (args.slotIdx < 0) {
		playingClips.set(args.trackPath, emptyEntry());
		return;
	}
	const clipPath = `${args.trackPath}/slots/${args.slotIdx}/clip`;
	playingClips.set(args.trackPath, {
		slotIdx: args.slotIdx,
		status: args.status,
		isAudioClip: args.isAudioClip,
		filePath: args.filePath,
		clipPath,
		lengthBeats: args.lengthBeats,
		loopStartBeats: args.loopStartBeats,
		loopEndBeats: args.loopEndBeats,
		looping: args.looping,
		fileStartBeats: args.fileStartBeats ?? 0,
		fileEndBeats: args.fileEndBeats ?? 0,
		positionBeats: 0
	});
	clipPathToTrackPath.set(clipPath, args.trackPath);
}

/**
 * Apply a `playhead` emit. Re-stamps `positionBeats` + `status` without
 * touching the slot/clip identity. If the `slotIdx` doesn't match the
 * store entry, drop the update — that's a late fire from a slot the UI
 * has already rotated past.
 */
export function applyPlayhead(args: {
	trackPath: string;
	slotIdx: number;
	positionBeats: number;
	status: number;
}): void {
	const entry = playingClips.get(args.trackPath);
	if (!entry || entry.slotIdx < 0) return;
	if (entry.slotIdx !== args.slotIdx) return;
	// Write to the position-only map. The entry object reference stays
	// stable, so derived/effects that consume `playingClipsStore.get(...)`
	// don't fire at audio rate. Components that need the live position
	// (just the playhead-line element) read `playingClipsStore.position(...)`
	// explicitly.
	playheadPositions.set(args.trackPath, {
		positionBeats: args.positionBeats,
		status: args.status
	});
}

/**
 * Cross-subscriber for `clipPropertiesStore` updates. When the
 * focused clip's loop window or `looping` flag changes, scan
 * playing entries by `clipPath` and patch the matching one.
 *
 * Same-frame: no race because both stores are runes-reactive and
 * read from `$derived` in components.
 */
export function patchLoopWindowFromProperty(args: {
	clipPath: string;
	loopStartBeats?: number;
	loopEndBeats?: number;
	looping?: boolean;
}): void {
	const trackPath = clipPathToTrackPath.get(args.clipPath);
	if (trackPath === undefined) return;
	const entry = playingClips.get(trackPath);
	// Double-check: the index might point to a trackPath whose slot
	// has since rotated (the index is updated synchronously inside
	// `applyPlayingSlot`, but a future change to the call order could
	// surface a stale mapping). Only patch if the track still holds
	// the clipPath we were asked about — the SvelteMap entry is the
	// authoritative state.
	if (entry === undefined || entry.clipPath !== args.clipPath) return;
	const next: PlayingClipEntry = { ...entry };
	if (args.loopStartBeats !== undefined) next.loopStartBeats = args.loopStartBeats;
	if (args.loopEndBeats !== undefined) next.loopEndBeats = args.loopEndBeats;
	if (args.looping !== undefined) next.looping = args.looping;
	playingClips.set(trackPath, next);
}

/**
 * Visible window for rendering — `clipViewWindow`, the rule the waveform
 * is drawn against too: the loop when looping, otherwise the whole file
 * (span known), otherwise `[0, lengthBeats]`. One rule for both, so the
 * playhead line can't be placed against a different window than the
 * waveform under it.
 */
export function visibleWindow(entry: PlayingClipEntry): {
	windowStart: number;
	windowEnd: number;
	windowSize: number;
} {
	const { start, end } = clipViewWindow(entry);
	return { windowStart: start, windowEnd: end, windowSize: end - start };
}

/** Map a beat position into a [0, 1] fraction of the visible window. */
export function playheadFraction(entry: PlayingClipEntry, positionBeats: number): number {
	const { windowStart, windowSize } = visibleWindow(entry);
	if (windowSize <= 0) return 0;
	const raw = (positionBeats - windowStart) / windowSize;
	if (raw < 0) return 0;
	if (raw > 1) return 1;
	return raw;
}

/** Test/dev helper — clear every entry. */
export function __resetPlayingClipsStoreForTests(): void {
	playingClips.clear();
	playheadPositions.clear();
	clipPathToTrackPath.clear();
}

// Bridge-resync clears entries so the surface's re-emitted
// `playing_slot` frames don't stack on stale state. Same shape the
// meter store uses (idle until first fire). Guarded for SSR.
if (typeof window !== 'undefined') {
	window.addEventListener('bridge-resync', () => {
		logger.debug('playingClipsStore: clearing on bridge-resync');
		playingClips.clear();
		playheadPositions.clear();
		clipPathToTrackPath.clear();
	});
}
