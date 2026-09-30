/**
 * v3 Clip handler (PR-5e1)
 *
 * Consumes the two inbound wire addresses owned by the Python Control
 * Surface's `ClipPropertiesComponent`:
 *
 *   Surf → UI   /looping/v3/clip/focused   [clipPath | ""]
 *   Surf → UI   /looping/v3/clip/property  [clipPath, name, value]
 *
 * `clip/focused` routes into `session.handleFocusedClipPath`, which
 * normalizes empty-string → null and clears the scalar
 * `clipPropertiesStore` so stale values from the previous clip don't
 * bleed through while listener echoes for the new clip arrive.
 *
 * `clip/property` routes into the scalar `clipPropertiesStore` **only
 * when** the incoming clipPath matches `session.focusedClipPath`.
 * Mismatches are dropped as late echoes from a prior focus — the
 * Python component keeps 6 listeners on the focused clip and detaches
 * them on focus change, but a listener firing in flight can still
 * arrive after the UI has advanced focus.
 *
 * See [04-wire-protocol.md §3.6] for the full contract and the
 * ClipPropertiesComponent docstring for the focus-scoped design.
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { handleFocusedClipPath, session } from '$lib/stores/session.svelte';
import { clipPropertiesStore } from '$lib/stores/v6/clipPropertiesStore.svelte';
import { patchLoopWindowFromProperty } from '$lib/stores/v6/playingClipsStore.svelte';
import { triggeredSlotsStore } from '$lib/stores/v6/triggeredSlotsStore.svelte';
import { toNumber, toString } from './oscTypeHelpers';
import { parseWarpMarkers } from '$lib/utils/clip/warpMarkers';

export const V3_CLIP_FOCUSED_ADDRESS = '/looping/v3/clip/focused';
export const V3_CLIP_PROPERTY_ADDRESS = '/looping/v3/clip/property';
/**
 * Launch-queued edge from `ClipsComponent`'s per-slot `is_triggered`
 * listener — fired, but the transport hasn't reached the quantization
 * boundary yet. Both edges are emitted, so the UI never times a blink
 * out on its own.
 */
export const V3_CLIP_TRIGGERED_ADDRESS = '/looping/v3/clip/triggered';
/**
 * The focused audio clip's warp markers:
 * `[clipPath, warping, fileSeconds, beat0, sec0, beat1, sec1, …]`.
 */
export const V3_CLIP_WARP_MARKERS_ADDRESS = '/looping/v3/clip/warp_markers';

// Write addresses (UI → Surf). Re-exported from one place so senders
// don't rebuild the string literals.
export const V3_CLIP_SET_LOOP_START_ADDRESS = '/looping/v3/clip/set/loop_start';
export const V3_CLIP_SET_LOOP_END_ADDRESS = '/looping/v3/clip/set/loop_end';
export const V3_CLIP_SET_START_MARKER_ADDRESS = '/looping/v3/clip/set/start_marker';
export const V3_CLIP_SET_END_MARKER_ADDRESS = '/looping/v3/clip/set/end_marker';
export const V3_CLIP_SET_WARP_MODE_ADDRESS = '/looping/v3/clip/set/warp_mode';
export const V3_CLIP_SET_LOOPING_ADDRESS = '/looping/v3/clip/set/looping';
export const V3_CLIP_SET_PITCH_COARSE_ADDRESS = '/looping/v3/clip/set/pitch_coarse';
export const V3_CLIP_SET_PITCH_FINE_ADDRESS = '/looping/v3/clip/set/pitch_fine';
export const V3_CLIP_SET_GAIN_ADDRESS = '/looping/v3/clip/set/gain';
/** `[clipPath, beatTime, distance]` — move one warp marker by `distance` beats. */
export const V3_CLIP_WARP_MARKER_MOVE_ADDRESS = '/looping/v3/clip/warp_marker/move';
/** `[clipPath, sampleTime, beatTime]` — add a marker pinning file seconds to a beat. */
export const V3_CLIP_WARP_MARKER_ADD_ADDRESS = '/looping/v3/clip/warp_marker/add';
/** `[clipPath, beatTime]` — remove the marker at that beat. */
export const V3_CLIP_WARP_MARKER_REMOVE_ADDRESS = '/looping/v3/clip/warp_marker/remove';

export function isV3ClipAddress(address: string): boolean {
	return (
		address === V3_CLIP_FOCUSED_ADDRESS ||
		address === V3_CLIP_PROPERTY_ADDRESS ||
		address === V3_CLIP_TRIGGERED_ADDRESS ||
		address === V3_CLIP_WARP_MARKERS_ADDRESS
	);
}

export function handleV3Clip(address: string, args: OSCArg[]): void {
	if (address === V3_CLIP_TRIGGERED_ADDRESS) {
		// args: [slotPath, 0|1] — launch queued / no longer queued.
		if (args.length < 2) {
			logger.warn('v3 clip/triggered wrong arity', { args });
			return;
		}
		triggeredSlotsStore.set(toString(args[0]), toNumber(args[1]) === 1);
		return;
	}

	if (address === V3_CLIP_WARP_MARKERS_ADDRESS) {
		if (args.length < 3) {
			logger.warn('v3 clip/warp_markers wrong arity', { args });
			return;
		}
		// Same late-echo rule as clip/property.
		if (toString(args[0]) !== session.focusedClipPath) return;
		clipPropertiesStore.handleWarpMarkers(
			toNumber(args[1]) === 1,
			toNumber(args[2]),
			parseWarpMarkers(args.slice(3).map(toNumber))
		);
		return;
	}

	if (address === V3_CLIP_FOCUSED_ADDRESS) {
		// args: [clipPath | ""]
		if (args.length < 1) {
			logger.warn('v3 clip/focused missing clipPath arg', { args });
			return;
		}
		const clipPath = toString(args[0]);
		handleFocusedClipPath(clipPath);
		return;
	}

	if (address === V3_CLIP_PROPERTY_ADDRESS) {
		// args: [clipPath, name, value]
		if (args.length < 3) {
			logger.warn('v3 clip/property wrong arity', { args });
			return;
		}
		const clipPath = toString(args[0]);
		const name = toString(args[1]);
		const rawValue = args[2];
		const value = toNumber(rawValue);

		// ADR-360 cross-subscription: mirror loop_start / loop_end /
		// looping into playingClipsStore so the TrackClipView's visible
		// window updates without waiting for the next slot change.
		// Runs BEFORE the focus filter — even when the playing clip
		// isn't focused, we still want loop-bound changes to propagate.
		if (name === 'loop_start') {
			patchLoopWindowFromProperty({ clipPath, loopStartBeats: value });
		} else if (name === 'loop_end') {
			patchLoopWindowFromProperty({ clipPath, loopEndBeats: value });
		} else if (name === 'looping') {
			patchLoopWindowFromProperty({ clipPath, looping: value === 1 });
		}

		// Late-echo filter: drop fires whose clipPath no longer matches
		// focus. The Python surface detaches listeners on focus change,
		// but a listener that already fired can still arrive.
		if (clipPath !== session.focusedClipPath) {
			return;
		}

		switch (name) {
			case 'loop_start':
				clipPropertiesStore.handleLoopStart(value);
				return;
			case 'loop_end':
				clipPropertiesStore.handleLoopEnd(value);
				return;
			case 'start_marker':
				clipPropertiesStore.handleStartMarker(value);
				return;
			case 'end_marker':
				clipPropertiesStore.handleEndMarker(value);
				return;
			case 'warp_mode':
				clipPropertiesStore.handleWarpMode(value);
				return;
			case 'looping':
				clipPropertiesStore.handleLoopEnabled(value === 1);
				return;
			case 'pitch_coarse':
				clipPropertiesStore.handlePitchCoarse(value);
				return;
			case 'pitch_fine':
				clipPropertiesStore.handlePitchFine(value);
				return;
			case 'gain':
				clipPropertiesStore.handleGain(value);
				return;
			case 'gain_display':
				clipPropertiesStore.handleGainDisplay(toString(rawValue));
				return;
			default:
				logger.warn('v3 clip/property unknown name', { name, clipPath });
				return;
		}
	}
}
