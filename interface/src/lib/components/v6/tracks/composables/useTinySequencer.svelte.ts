/**
 * useTinySequencer — per-track read-only view of the Permute sequencer on
 * `trackPath`, derived from `v3Store`. Used by `TrackStrip` to feed the
 * `MiniSequencer` thumbnail in each track's permute section.
 *
 * Shape matches the old broadcast-driven `TrackSequencerState` so the
 * `MiniSequencer` component works without changes.
 *
 * A PAD's Permute (ADR-435, 2026-09-14): while a pad is held or latched
 * on THIS track's Drum Rack (`activeDrumRackScope`), the thumbnail is
 * that pad's Permute — the one inside its chain — or the ghost rows when
 * the pad has none, and `scope` names the pad so the strip can frame the
 * section in its ink. Lift, and it is the track's again. The pure
 * `tinySequencerState` is shared with the pad tiles' own step strips.
 */

import { v3Store } from '$lib/stores/v3/normalized.svelte';
import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { permuteStepStore } from '$lib/stores/v3/permuteSteps.svelte';
import { activeDrumRackScope } from '$lib/services/deviceViewRouter.svelte';
import type { FxScope } from '$lib/components/v6/central/fxScope';
import {
	MUTE_STEP_ROLES,
	PERMUTE_PARAM_DEFAULTS,
	PITCH_STEP_ROLES,
	findPermute,
	resolvePermuteLayout
} from '$lib/config/permuteLayout';
import type { PermuteLayout, PermuteRole } from '$lib/config/permuteLayout';

// Pattern/length are real parameters (user-settable, automatable,
// persisted; Live notifies on them) so they ride paramByPath, resolved
// by NAME through `$lib/config/permuteLayout` (permute ADR-020) — the
// same resolver `sequencerStore` uses, so the strip thumbnail and the
// central view can never disagree about which record is which step.
// Step position does NOT live here — it's telemetry off
// `/looping/v3/permute/step`; see permuteSteps.svelte.ts for why.

export interface TinySequencerTypeState {
	pattern: boolean[];
	length: number;
	position: number;
	enabled: boolean;
}

export interface TinySequencerState {
	active: boolean;
	mute: TinySequencerTypeState;
	pitch: TinySequencerTypeState;
}

/**
 * A role's value, or the device's default when the record carries none —
 * a pad's stand-in record (presence alone, before its bundle lands) has
 * no params, and must read as a fresh device, never as "every step off".
 */
function readRole(layout: PermuteLayout, role: PermuteRole): number {
	return v3Store.paramByPath.get(layout.paths[role])?.value ?? PERMUTE_PARAM_DEFAULTS[role];
}

/** The thumbnail's state for one Permute record: its two patterns, lengths, and live step positions. */
export function tinySequencerState(permute: DeviceRecord): TinySequencerState {
	const layout = resolvePermuteLayout(permute);
	const mutePattern = MUTE_STEP_ROLES.map((r) => readRole(layout, r) === 1);
	const pitchPattern = PITCH_STEP_ROLES.map((r) => readRole(layout, r) === 1);
	const muteLength = readRole(layout, 'muteLength');
	const pitchLength = readRole(layout, 'pitchLength');
	// Step position rides the telemetry wire, already 0-indexed with -1
	// for idle — exactly the domain `position` wants, so no transform. A
	// pad's device path is just a longer key there.
	const { mute: mutePosition, pitch: pitchPosition } = permuteStepStore.get(permute.devicePath);
	return {
		active: true,
		mute: {
			pattern: mutePattern,
			length: muteLength,
			position: mutePosition,
			enabled: mutePattern.slice(0, muteLength).some((s) => !s)
		},
		pitch: {
			pattern: pitchPattern,
			length: pitchLength,
			position: pitchPosition,
			enabled: pitchPattern.slice(0, pitchLength).some((s) => s)
		}
	};
}

function trackPermute(trackPath: string): DeviceRecord | undefined {
	const track = v3Store.tracks.get(trackPath);
	if (!track) return undefined;
	return findPermute(track.devices.values());
}

export function useTinySequencer(trackPath: string): {
	readonly state: TinySequencerState | null;
	/** The pad the thumbnail is scoped to (a pad on this track's Drum Rack), or null. */
	readonly scope: FxScope | null;
} {
	// The scope counts only when it is on THIS track's rack: every other
	// strip keeps showing its own track's Permute.
	const scope = $derived.by<FxScope | null>(() => {
		const s = activeDrumRackScope();
		return s && s.rackPath.startsWith(`${trackPath}/`) ? s : null;
	});
	const permute = $derived(
		scope ? findPermute(selectedTrackStore.padDevices(scope.padPath)) : trackPermute(trackPath)
	);
	const state = $derived.by<TinySequencerState | null>(() => (permute ? tinySequencerState(permute) : null));

	return {
		get state() {
			return state;
		},
		get scope() {
			return scope;
		}
	};
}
