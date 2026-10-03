/**
 * trackCommands.ts — UI-initiated track-metadata writes with
 * optimistic store apply.
 *
 * Wire-write commands that pair `applyTrackMetadata` (or
 * `applyMasterMetadata`) with the matching OSC send. Components and
 * services call these instead of hand-rolling the (apply, send) pair
 * so the v3 store always reflects what the UI just sent — without
 * waiting for the surface's listener echo, which is single-shot
 * suppressed by `TrackMetadataComponent._handle_set` to avoid jitter
 * loops during rapid drags.
 *
 * Same pattern as `selectedTrackStore.setParamValue` /
 * `setPropertyValue`. Track metadata had no equivalent until issue
 * #399 surfaced the same failure mode for volume sliders: outbound
 * writes echo-suppressed, store stays at load-time value, slider
 * snaps back when optimistic UI state clears. ADR-358 documents the
 * full design rationale.
 *
 * Path conventions:
 * - Regular tracks ride the `tracks/<N>` shape on the wire and in the
 *   store. Most call sites already have a `trackPath` string in hand
 *   (from `result.trackPath` on a prepare ack, from
 *   `selectedTrackStore.selectedTrackPath`, or constructed locally),
 *   so the public API takes `trackPath` directly. A thin helper
 *   `setTrackVolumeByIndex` exists for the few call sites that hold
 *   an index instead.
 * - Master rides a different wire shape (no `trackPath` arg) and a
 *   dedicated apply primitive. Master commands take no path arg.
 *
 * Reconciliation: outside edits (Live → UI) and rare LOM rejections
 * (out-of-range, invalid-routing, name-too-long) bypass suppression
 * and reach `applyTrackMetadata` via the standard listener echo
 * path. State/full bundles also re-hydrate the value on the
 * T-record. The local apply here is "the UI knows what it sent"; if
 * the LOM disagrees, the next non-suppressed echo overwrites.
 *
 * Drop-on-invalid-input is silent (consistent with
 * `applyTrackMetadata`'s drop-on-missing policy) — calling
 * `setTrackVolumeByIndex(-1, …)` or with a malformed path is a
 * no-op rather than a throw, matching the rest of the v3 write
 * surface.
 */

import { send } from '$lib/api/simpleClient';
import {
	applyMasterMetadata,
	applyTrackFoldState,
	applyTrackMetadata
} from '$lib/stores/v3/normalized.svelte';
import { logger } from '$lib/utils/logger';

const V3_TRACK_VOLUME_ADDRESS = '/looping/v3/track/volume';
const V3_MASTER_VOLUME_ADDRESS = '/looping/v3/master/volume';
const V3_TRACK_NAME_ADDRESS = '/looping/v3/track/name';

function isRegularTrackPath(trackPath: string): boolean {
	return trackPath.startsWith('tracks/');
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

/**
 * Set a regular track's volume (0..1). Applies optimistically to the
 * v3 store and emits `/looping/v3/track/volume [trackPath, value]`.
 *
 * Drops with a debug log if `trackPath` doesn't have the
 * `tracks/<N>` shape; master must use `setMasterVolume` (different
 * wire address, no `trackPath` arg).
 */
export function setTrackVolume(trackPath: string, value: number): void {
	if (!isRegularTrackPath(trackPath)) {
		logger.debug('setTrackVolume dropped — non-regular trackPath', {
			trackPath,
			value
		});
		return;
	}
	applyTrackMetadata(trackPath, 'volume', value);
	send(V3_TRACK_VOLUME_ADDRESS, [trackPath, value]);
}

/**
 * Index-keyed convenience wrapper for {@link setTrackVolume}. Builds
 * `tracks/<N>` from `trackIndex` and forwards. Use when the caller
 * has an index but not a path (e.g. `TrackVolumeMeter` props).
 */
export function setTrackVolumeByIndex(trackIndex: number, value: number): void {
	if (!Number.isInteger(trackIndex) || trackIndex < 0) {
		logger.debug('setTrackVolumeByIndex dropped — invalid trackIndex', {
			trackIndex,
			value
		});
		return;
	}
	setTrackVolume(`tracks/${trackIndex}`, value);
}

/**
 * Set the master track's volume (0..1). Applies optimistically to
 * the v3 store and emits `/looping/v3/master/volume [value]`.
 *
 * Master rides a different wire shape (no `trackPath` arg) and a
 * dedicated apply primitive (`applyMasterMetadata`) per the PR-5b
 * master/track seam.
 */
export function setMasterVolume(value: number): void {
	applyMasterMetadata('volume', value);
	send(V3_MASTER_VOLUME_ADDRESS, [value]);
}

// ---------------------------------------------------------------------------
// Name
// ---------------------------------------------------------------------------

/**
 * Set a regular track's name. Applies optimistically to the v3 store
 * and emits `/looping/v3/track/name [trackPath, name]`.
 *
 * Master / returns paths drop silently with a debug log — the wire
 * rejects them as `path-not-supported` anyway and the existing call
 * sites already pre-filter (e.g. `presetLoader` skips when
 * `result.trackPath === 'master'`).
 */
export function setTrackName(trackPath: string, name: string): void {
	if (!isRegularTrackPath(trackPath)) {
		logger.debug('setTrackName dropped — non-regular trackPath', {
			trackPath,
			name
		});
		return;
	}
	applyTrackMetadata(trackPath, 'name', name);
	send(V3_TRACK_NAME_ADDRESS, [trackPath, name]);
}

// ---------------------------------------------------------------------------
// Mute / Solo
// ---------------------------------------------------------------------------

const V3_TRACK_MUTE_ADDRESS = '/looping/v3/track/mute';
const V3_TRACK_SOLO_ADDRESS = '/looping/v3/track/solo';
const V3_TRACK_SET_FOLD_STATE_ADDRESS = '/looping/v3/track/set/fold_state';

/**
 * Set a regular track's mute. Applies optimistically to the v3
 * store and emits `/looping/v3/track/mute [trackPath, 0|1]`.
 *
 * Wire shape carries `int 0/1`; the LOM field is `bool`.
 * `TrackMetadataComponent` coerces both directions per the PR-5a
 * contract — we mirror that on the apply side by storing
 * `boolean`.
 */
export function setTrackMute(trackPath: string, muted: boolean): void {
	if (!isRegularTrackPath(trackPath)) {
		logger.debug('setTrackMute dropped — non-regular trackPath', {
			trackPath,
			muted
		});
		return;
	}
	applyTrackMetadata(trackPath, 'mute', muted);
	send(V3_TRACK_MUTE_ADDRESS, [trackPath, muted ? 1 : 0]);
}

/**
 * Set a regular track's solo. Applies optimistically to the v3
 * store and emits `/looping/v3/track/solo [trackPath, 0|1]`. Same
 * int-on-wire / bool-on-LOM coercion as
 * {@link setTrackMute}.
 */
export function setTrackSolo(trackPath: string, soloed: boolean): void {
	if (!isRegularTrackPath(trackPath)) {
		logger.debug('setTrackSolo dropped — non-regular trackPath', {
			trackPath,
			soloed
		});
		return;
	}
	applyTrackMetadata(trackPath, 'solo', soloed);
	send(V3_TRACK_SOLO_ADDRESS, [trackPath, soloed ? 1 : 0]);
}

// ---------------------------------------------------------------------------
// Group fold (ADR-410)
// ---------------------------------------------------------------------------

/**
 * Fold / unfold a Group Track. Applies optimistically to the v3 store
 * and emits `/looping/v3/track/set/fold_state [trackPath, 0|1]`.
 *
 * Optimism matters more here than for the other writes: folding hides
 * every descendant strip, so waiting for the round-trip would leave a
 * visible lag between tapping the triangle and the row closing. The
 * surface echoes back on `/looping/v3/track/fold_state`, which
 * reconciles if Live disagreed (e.g. the track stopped being a group
 * between render and tap — the write nacks and the echo never comes,
 * so the next state/full restores the truth).
 *
 * Goes through `applyTrackFoldState` rather than `applyTrackMetadata`
 * because `foldState` isn't one of the table-driven metadata attrs on
 * either side of the wire — it has no LOM listener at all.
 */
export function setTrackFoldState(trackPath: string, folded: boolean): void {
	if (!isRegularTrackPath(trackPath)) {
		logger.debug('setTrackFoldState dropped — non-regular trackPath', {
			trackPath,
			folded
		});
		return;
	}
	applyTrackFoldState(trackPath, folded);
	send(V3_TRACK_SET_FOLD_STATE_ADDRESS, [trackPath, folded ? 1 : 0]);
}

// ---------------------------------------------------------------------------
// Selection and sends (no optimistic apply here)
// ---------------------------------------------------------------------------

const V3_TRACK_SELECT_ADDRESS = '/looping/v3/track/select';
const V3_TRACK_SEND_ADDRESS = '/looping/v3/track/send';

/**
 * Select a track in Live: `tracks/<N>` or `'master'`. The optimistic half
 * (`session.selectTrackOptimistically`, `selectedTrackStore.handleTrackSelected`)
 * stays with the caller, which knows whether the track was already
 * selected; this is the wire write alone.
 */
export function selectTrack(trackPath: string): void {
	send(V3_TRACK_SELECT_ADDRESS, [trackPath]);
}

/** Set a track's send `sendIndex` (0 = Send A) to `value` (0..1). */
export function setTrackSend(trackPath: string, sendIndex: number, value: number): void {
	send(V3_TRACK_SEND_ADDRESS, [trackPath, sendIndex, value]);
}

// ---------------------------------------------------------------------------
// Notes on commands not yet added
// ---------------------------------------------------------------------------
//
// - **arm**: `track/arm` today is fired only by `armTrackWithRetry`
//   in `$lib/utils/trackArming.ts`, which is currently unreferenced
//   from non-test code (arm-follows-selection is owned by the Python
//   `ExclusiveArmComponent`; the comment in `session.svelte.ts:467`
//   is stale). If a real arm-write call site lands, add `setTrackArm`
//   here following the volume / name shape.
//
// - **color, pan**: no UI write sites today. Color is read-only from
//   the wire (Live owns it via the track-color picker UI), and pan
//   has no slider in v6.
//
// - **input_routing_type, input_routing_channel**: no UI write sites
//   today. Track creation owns initial routing via the prepare
//   endpoint.
