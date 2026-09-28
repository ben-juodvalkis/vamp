/**
 * Clip State Store
 *
 * Derives track-filter state from `v3Store.tracks`. The v3 surface's
 * `V3StateFullComponent` emits S/C records for every `ClipSlot`, and
 * `ClipsComponent`'s per-slot `has_clip` listeners advance generation
 * on clip create/delete — the coalesced `state/invalidate` tick
 * republishes state/full, keeping `TrackRecord.slots` live. This store
 * is now a thin `$derived` projection + UI filter-mode bit.
 *
 * ROW 13a (2026-04-21): rewired from the M4L `query_track_summaries`
 * round-trip to direct v3Store reads. `_trackSummaries`, `requestRefresh`,
 * `handleTrackSummaries`, `requestSingleTrackRefresh`,
 * `handleSingleTrackSummary`, `_isLoading`, `_lastRefresh`, `_sceneCount`,
 * and the `TrackSummary` interface all deleted. The M4L dispatch branches
 * and UI handler registration go in pr13a-2.
 */

import { v3Store } from '$lib/stores/v3/normalized.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { isPatternRackMacroName } from '$lib/utils/macroLayoutUtils';
import {
	isTrackHidden,
	groupBandLayout,
	type GroupNode,
	type GroupBandLayout
} from '$lib/utils/trackGroups';

// --- filter mode (the only remaining stateful bit) ------------------------

let _filterMode = $state<'all' | 'active'>('all');

// --- derived readers over v3Store ------------------------------------------

/** Group-tree lookup for `$lib/utils/trackGroups` walks. */
function groupNodeFromV3(trackIndex: number): GroupNode | undefined {
	return v3Store.tracks.get(`tracks/${trackIndex}`);
}

/** True when the track is a Live Group Track. */
function isGroupTrackFromV3(trackIndex: number): boolean {
	return v3Store.tracks.get(`tracks/${trackIndex}`)?.isFoldable ?? false;
}

/**
 * True when any slot on the track has `state !== 'empty'`.
 *
 * ADR-410: a Group Track always answers `false` here no matter what its
 * children hold — Live gives a group its own `clip_slots`, but they're
 * never `has_clip`, they only mirror the row. So this is a real answer
 * for a regular track and a meaningless one for a group; callers that
 * mean "is this track free to take a new instrument" must gate on
 * `isGroupTrackFromV3` first (see `emptyTracksOfType`), or a group will
 * present itself as an empty audio track.
 */
function trackHasSessionClipsFromV3(trackIndex: number): boolean {
	const track = v3Store.tracks.get(`tracks/${trackIndex}`);
	if (!track) return false;
	for (const slot of track.slots.values()) {
		if (slot.state !== 'empty') return true;
	}
	return false;
}

function trackHasArrangementClipsFromV3(trackIndex: number): boolean {
	return v3Store.tracks.get(`tracks/${trackIndex}`)?.hasArrangementClips ?? false;
}

/**
 * ADR-410: a Group Track reports `hasAudioInput === true` (verified
 * against Live 12.4.5b8), so without this guard every group classifies
 * as an audio track — and, having no clips of its own, as an *empty*
 * one. Groups have no type; they're structure.
 */
function trackTypeFromV3(trackIndex: number): 'midi' | 'audio' | null {
	const track = v3Store.tracks.get(`tracks/${trackIndex}`);
	if (!track) return null;
	if (track.isFoldable) return null;
	if (track.hasMidiInput) return 'midi';
	if (track.hasAudioInput) return 'audio';
	return null;
}

/** Iterate regular tracks (`tracks/<N>`) in numeric order. */
function* regularTrackIndices(): IterableIterator<number> {
	const indices: number[] = [];
	for (const trackPath of v3Store.tracks.keys()) {
		if (!trackPath.startsWith('tracks/')) continue;
		const idx = parseInt(trackPath.slice('tracks/'.length), 10);
		if (!Number.isNaN(idx)) indices.push(idx);
	}
	indices.sort((a, b) => a - b);
	for (const i of indices) yield i;
}

/**
 * The metronome track (in practice the Skaka Metronome Rack, which
 * generates its own notes off the transport and so carries no clips of
 * its own): protecting it by *position* (track 0's own long-standing
 * carve-out, below) breaks the moment it is grouped or otherwise moved
 * off the first slot. This structural test -- an Instrument Rack whose
 * macro 1 reads "Pattern N" -- travels with the rack instead, wherever
 * it ends up. Same test the Pattern Rack central view uses to route
 * itself, and Python's `TrackPrepareComponent._is_metronome_track`
 * mirrors it; this UI-side copy is advisory only, same as the group
 * check above.
 */
function isMetronomeTrackFromV3(trackIndex: number): boolean {
	const track = v3Store.tracks.get(`tracks/${trackIndex}`);
	if (!track) return false;
	for (const device of track.devices.values()) {
		const names = selectedTrackStore.paramNamesForDevice(device);
		if (isPatternRackMacroName(names[1])) return true;
	}
	return false;
}

function emptyTracksOfType(type: 'midi' | 'audio'): number[] {
	const out: number[] = [];
	for (const idx of regularTrackIndices()) {
		if (idx === 0) continue; // exclude scratch track 0
		// ADR-410: never offer a group as a reuse target. Python's
		// `TrackPrepareComponent._is_reusable` holds the same line
		// (ADR-385) and is the authority, but a UI-side list that
		// disagreed would still surface a group in the picker.
		if (isGroupTrackFromV3(idx)) continue;
		if (isMetronomeTrackFromV3(idx)) continue;
		if (trackTypeFromV3(idx) !== type) continue;
		if (trackHasSessionClipsFromV3(idx)) continue;
		if (trackHasArrangementClipsFromV3(idx)) continue;
		out.push(idx);
	}
	return out;
}

class ClipStateStore {
	get filterMode() {
		return _filterMode;
	}

	set filterMode(value: 'all' | 'active') {
		_filterMode = value;
	}

	/** Empty MIDI tracks available for reuse (excludes track 0). */
	get emptyMidiTracks(): number[] {
		return emptyTracksOfType('midi');
	}

	/** Empty audio tracks available for reuse (excludes track 0). */
	get emptyAudioTracks(): number[] {
		return emptyTracksOfType('audio');
	}

	/** True when the track at `trackIndex` is a Live Group Track. */
	isGroupTrack(trackIndex: number): boolean {
		return isGroupTrackFromV3(trackIndex);
	}

	/** True when the group at `trackIndex` is collapsed. */
	isGroupFolded(trackIndex: number): boolean {
		return v3Store.tracks.get(`tracks/${trackIndex}`)?.foldState ?? false;
	}

	/**
	 * Visible track indices for the current filter mode.
	 *
	 * `all` — every index in `[0, totalTracks)`.
	 * `active` — track 0 (scratch) + selected + any track with session or
	 * arrangement clips.
	 *
	 * ADR-410: both modes then drop tracks hidden inside a folded group,
	 * mirroring Live's own arrangement. The filter runs *last* and
	 * outranks every other inclusion rule — a selected track that gets
	 * folded away disappears here, the same as it does in Live, rather
	 * than lingering as an orphan strip with no visible parent. The
	 * indices themselves are untouched: they stay LOM positions, so
	 * hiding a strip never re-points a `tracks/<N>` path.
	 */
	getVisibleTracks(totalTracks: number, selectedTrackIndex: number): number[] {
		let candidates: number[];
		if (_filterMode === 'all') {
			candidates = Array.from({ length: totalTracks }, (_, i) => i);
		} else {
			const visible = new Set<number>();
			visible.add(0);
			visible.add(selectedTrackIndex);
			for (const idx of regularTrackIndices()) {
				if (trackHasSessionClipsFromV3(idx) || trackHasArrangementClipsFromV3(idx)) {
					visible.add(idx);
				}
			}
			candidates = Array.from(visible).sort((a, b) => a - b);
		}
		return candidates.filter((idx) => !isTrackHidden(idx, groupNodeFromV3));
	}

	/**
	 * Group-bracket geometry for a row of visible tracks (ADR-413).
	 *
	 * Takes the output of `getVisibleTracks` and returns where each open
	 * group's arm sits and how far each column is pushed down beneath it.
	 * Pure math in `$lib/utils/trackGroups`; this only supplies the
	 * lookup.
	 */
	groupBands(visibleTracks: readonly number[]): GroupBandLayout {
		return groupBandLayout(visibleTracks, groupNodeFromV3);
	}
}

export const clipStateStore = new ClipStateStore();
