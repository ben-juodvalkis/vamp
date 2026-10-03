/**
 * useTrackData Composable
 *
 * Track state and actions for TrackStrip. All scalars now flow through
 * the v3 normalized store:
 *   - name/color/mute/solo/arm/panning/hasMidiInput/hasAudioInput via
 *     `/looping/v3/track/<attr>` listener fires (PR-5a/5d/5e)
 *   - volume on the T-record of the v3 state/full bundle (ROW 6.5,
 *     arity 10). For master, `/looping/v3/master/volume` writes to
 *     `v3Store.tracks.get('master')`.
 *   - meter off the dedicated v3 meter wire (PR-5c)
 *
 * The legacy `useMaxTrackObserver` hook is GONE (2026-09-11). Its comment
 * claimed it was "retained purely for setProperty / selectTrack writes";
 * neither method had a caller, and the only thing `initialize()` did was
 * register a `max-track-property` window listener for an event the app
 * stopped dispatching with the T-record volume migration — one permanently
 * inert listener per mounted strip.
 */

import type { LiveTrack } from '$lib/domain/live-objects';
import { session } from '$lib/stores/session.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { instrumentDisplayCoordinator } from '$lib/services/instrumentDisplayCoordinator.svelte';
import { setTrackMute } from '$lib/services/trackCommands';
import { sendSelectClip } from '$lib/services/clipCommands';
import { selectTrack } from '$lib/services/trackCommands';
import { playingClipsStore } from '$lib/stores/v6/playingClipsStore.svelte';
import { TRACK_DEFAULTS, MASTER_TRACK_DEFAULTS } from '../TrackStrip/utils/trackConstants';
import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
import { paintModeReactive } from '$lib/utils/paintMode.svelte';
import { v3Store } from '$lib/stores/v3/normalized.svelte';
import { groupGestureStore } from '$lib/stores/v6/groupGestureStore.svelte';
import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';
import { meterStore } from '$lib/stores/v3/meters.svelte';
import { permuteStepStore } from '$lib/stores/v3/permuteSteps.svelte';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';

// Permute v4.0.0 mute-step layout — kept in sync with sequencerStore.
// `Mute 1..8` (params 1..8) are 0/1 where 1 means the step PLAYS (audible)
// and 0 means the step is MUTED (silent) — same polarity the old
// MiniSequencer rendered (`.mute-step.active` = lit = step plays). These
// are real parameters (user-settable, automatable, persisted) so they ride
// paramByPath.
//
// The *current step* does not: it's telemetry off `/looping/v3/permute/step`
// (0-indexed, -1 = idle). See stores/v3/permuteSteps.svelte.ts for why it
// can't be read as a parameter.
const MUTE_STEP_INDICES = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function readPermuteMuteCurrent(trackPath: string): boolean {
    const track = v3Store.tracks.get(trackPath);
    if (!track) return false;
    const presetName = DEVICE_PRESETS.sequencer.defaultName;
    const presetClassName = DEVICE_PRESETS.sequencer.expectedClassName;
    let permute: DeviceRecord | undefined;
    for (const device of track.devices.values()) {
        if (device.className === presetClassName && device.name === presetName) {
            permute = device;
            break;
        }
    }
    if (!permute) return false;
    const stepIdx0 = permuteStepStore.get(permute.devicePath).mute;
    if (stepIdx0 < 0 || stepIdx0 >= MUTE_STEP_INDICES.length) return false;
    const stepParamIdx = MUTE_STEP_INDICES[stepIdx0];
    const stepValue = v3Store.paramByPath.get(
        `${permute.devicePath}/params/${stepParamIdx}`
    )?.value;
    // Step plays when value === 1; "muted" is the absence of that.
    return stepValue !== undefined && stepValue !== 1;
}

type TrackView = {
    -readonly [K in keyof LiveTrack]: LiveTrack[K]
};

export interface UseTrackDataOptions {
    trackIndex: number;
    isMaster?: boolean;
    onTrackSelect?: (trackIndex: number) => void;
}

export interface HandleSelectOptions {
    showInstrumentView?: boolean;
    /**
     * Move the pedal's target onto whatever this track is PLAYING.
     *
     * A strip tap passes this; a session-grid tap does not, because that
     * gesture names a slot itself and would only be overruled. No-op when
     * the track has nothing running — the highlight stays where the
     * performer last put it rather than jumping to slot 0.
     */
    aimAtPlayingClip?: boolean;
}

export interface UseTrackDataReturn {
    track: TrackView;
    isSelected: boolean;
    trackColor: string;
    permuteMutedNow: boolean;

    handleSelect: (options?: HandleSelectOptions) => Promise<void>;
    handleMuteToggle: (event?: MouseEvent | PointerEvent) => void;
}

/**
 * Slot index this track is currently playing or recording into, or -1.
 *
 * Reads the live channel (`playing_slot` + its status) rather than the
 * S-record snapshot, for the same reason `SlotGrid` does: a clip
 * launched since the last `state/full` is only in the live one. A
 * stopped entry lingers in the store, so the status is what makes this
 * "is playing" rather than "played at some point".
 */
function playingSlotIndex(trackPath: string): number {
    const entry = playingClipsStore.get(trackPath);
    if (!entry || entry.slotIdx < 0) return -1;
    const status = playingClipsStore.liveStatus(trackPath);
    // 1 = playing, 2 = recording. A take in progress counts: it is the
    // clip the performer is working on.
    return status === 1 || status === 2 ? entry.slotIdx : -1;
}

/**
 * If a group gesture is active, a tap on `trackIndex` means "toggle it into
 * the pending group", never a real selection. Every "tap a track" entry
 * point — a strip, the session clip grid, the master strip — calls this
 * first, so the whole gesture bypasses selection, the central-view switch
 * and the pedal aim uniformly, in ONE place, rather than re-checking
 * `groupGestureStore.active` at each of them and risking one drifting out
 * of step (found missing on the session grid the first time this shipped,
 * 2026-09-20 — a cell tap there has never gone through `TrackStrip`).
 *
 * Returns `true` when it intercepted, in which case the caller does
 * nothing else at all. The master track cannot be grouped, so a tap on it
 * is simply swallowed rather than turned into a tap that can only fail.
 */
export function interceptForGroupGesture(trackIndex: number, isMaster = false): boolean {
    if (!groupGestureStore.active) return false;
    if (!isMaster) {
        const trackPath = `tracks/${trackIndex}`;
        groupGestureStore.tap(trackPath, v3Store.tracks.get(trackPath)?.name ?? '');
    }
    return true;
}

/**
 * Select a track the way a strip section tap does — optimistic local
 * selection first, then the OSC write whose echo confirms or corrects it.
 *
 * Standalone rather than a method on the composable because the session
 * clip grid (ADR-415) selects tracks too, and it is rendered by
 * `TracksPanelV6` rather than by any one strip, so it has no
 * `useTrackData` instance of its own. One implementation, two callers.
 */
export async function selectTrackByIndex(
    trackIndex: number,
    options?: HandleSelectOptions & {
        isMaster?: boolean;
        onTrackSelect?: (trackIndex: number) => void;
    }
): Promise<void> {
    const {
        showInstrumentView = true,
        isMaster = false,
        onTrackSelect,
        aimAtPlayingClip = false
    } = options ?? {};
    if (interceptForGroupGesture(trackIndex, isMaster)) return;
    const wasAlreadySelected = session.selectedTrackIndex === trackIndex;
    if (!showInstrumentView) {
        instrumentDisplayCoordinator.suppressAutoViewSwitch();
    }
    // Optimistically apply selection before the OSC round-trip so the
    // highlight, central view, and FX grid update immediately. The echo
    // from Ableton confirms or corrects this when it arrives.
    if (!wasAlreadySelected) {
        session.selectTrackOptimistically(trackIndex);
        selectedTrackStore.handleTrackSelected(trackIndex);
    }
    // Aim the pedal at this track's running clip, when it has one.
    //
    // The highlight is the intersection of the selected track and the
    // selected scene, so selecting a track alone leaves the pedal on
    // whatever ROW was last chosen — which on a set where each track's
    // loop lives in a different scene means the stomp after a strip tap
    // lands on an empty slot of the track you just picked. Following the
    // playing clip puts the pedal where the performer's attention
    // already is. Optimistic, exactly like the selection above.
    const playingSlot = aimAtPlayingClip && !isMaster
        ? playingSlotIndex(`tracks/${trackIndex}`)
        : -1;
    if (playingSlot >= 0) session.selectSceneOptimistically(playingSlot);

    await selectTrack(isMaster ? 'master' : `tracks/${trackIndex}`);
    if (playingSlot >= 0) sendSelectClip(`tracks/${trackIndex}`, playingSlot);
    onTrackSelect?.(trackIndex);
    if (wasAlreadySelected && showInstrumentView) {
        instrumentDisplayCoordinator.showCurrentInstrument();
    }
}

export function useTrackData(options: UseTrackDataOptions): UseTrackDataReturn {
    const { trackIndex, isMaster = false, onTrackSelect } = options;
    const trackPath = `tracks/${trackIndex}`;

    // PR-5c — meter comes off the v3 meter store, written by
    // `/looping/v3/{track,master}/meter` fires. `meterLevel` is the L
    // channel (UI shows a single bar), matching the scalar semantics
    // the legacy `output_meter_left` → `meterLevel` mapping had.
    const meterRecord = $derived(
        meterStore.get(isMaster ? 'master' : trackPath)
    );
    const meterLevel = $derived(meterRecord?.left ?? 0);

    // v3 store-sourced metadata. Master rides path `master`; regular
    // tracks ride `tracks/<N>`. The store IS the optimistic value
    // during an interaction — `setTrackMute` / `setTrackSolo` apply
    // locally before sending OSC (ADR-358), so we don't need a
    // parallel optimistic field here.
    const storeRecord = $derived(
        v3Store.tracks.get(isMaster ? 'master' : trackPath)
    );

    const track: TrackView = $derived.by(() => {
        const rec = storeRecord;
        if (isMaster) {
            return {
                ...MASTER_TRACK_DEFAULTS,
                index: trackIndex,
                name: 'Master',
                volume: rec?.volume ?? MASTER_TRACK_DEFAULTS.volume,
                pan: rec?.panning ?? MASTER_TRACK_DEFAULTS.pan,
                meterLevel,
                mute: rec?.mute ?? MASTER_TRACK_DEFAULTS.mute,
                isMaster: true,
                isReturn: false,
                isGroup: false,
                groupParentIndex: -1,
                deviceCount: 0,
                clipCount: 0,
                foldState: false,
                isVisible: true,
                canBeArmed: false,
                hasAudioInput: false,
                hasAudioOutput: true,
                hasMidiInput: false,
                hasMidiOutput: false,
                playingSlotIndex: -1,
                firedSlotIndex: -1
            };
        }
        return {
            index: trackIndex,
            name: rec?.name ?? `Track ${trackIndex + 1}`,
            volume: rec?.volume ?? TRACK_DEFAULTS.volume,
            pan: rec?.panning ?? TRACK_DEFAULTS.pan,
            meterLevel,
            mute: rec?.mute ?? TRACK_DEFAULTS.mute,
            solo: rec?.solo ?? TRACK_DEFAULTS.solo,
            arm: rec?.arm ?? TRACK_DEFAULTS.arm,
            color: rec?.color ?? TRACK_DEFAULTS.color,
            isMaster: false,
            isReturn: false,
            isGroup: false,
            groupParentIndex: -1,
            deviceCount: rec?.devices.size ?? 0,
            clipCount: rec?.slots.size ?? 0,
            foldState: false,
            isVisible: true,
            canBeArmed: true,
            hasAudioInput: rec?.hasAudioInput ?? true,
            hasAudioOutput: true,
            hasMidiInput: rec?.hasMidiInput ?? true,
            hasMidiOutput: true,
            playingSlotIndex: -1,
            firedSlotIndex: -1
        };
    });

    const isSelected = $derived(session.selectedTrackIndex === trackIndex);
    // GRATICULE (§2.5): the raw Live hex is normalized through trackInk() into
    // the calibrated ink envelope (hue preserved). This ONE string drives both
    // the --track-color CSS var on the strip and the canvas fillStyle. paintModeReactive()
    // is a non-reactive read; theme A/B re-inks on the next color tick.
    const trackColor = $derived(trackInk(rgbToHex(track.color), paintModeReactive()));
    // True when this track has a Permute device whose Mute sequencer
    // is currently sitting on a muted step. Used by TrackClipView to
    // grey out the playing-clip render — same per-moment visibility
    // the retired MiniSequencer offered, scoped to a boolean.
    const permuteMutedNow = $derived(
        isMaster ? false : readPermuteMuteCurrent(trackPath)
    );
    // GRATICULE (§2.5): the old hex+alpha-suffix borderStyle is retired — the
    // strip wash and ink border now derive purely in CSS via .glass-card over
    // the --track-color var, so there is a single source of truth per track.

    // ADR-360: per-track Permute thumbnail moved off the strip — the
    // strip now shows TrackClipView (playing-clip waveform / MIDI
    // notes) and Permute step state is rendered exclusively by
    // ClipCentralView when the track is selected.

    async function handleSelect(options?: HandleSelectOptions) {
        await selectTrackByIndex(trackIndex, {
            // A strip tap is the gesture that means "this track now" with
            // no slot named, so it is the one that follows the playing
            // clip. Callers can still say otherwise.
            aimAtPlayingClip: true,
            ...options,
            isMaster,
            onTrackSelect
        });
    }

    function handleMuteToggle(event?: MouseEvent | PointerEvent) {
        event?.stopPropagation();
        if (isMaster) return;
        setTrackMute(trackPath, !track.mute);
    }

    return {
        get track() { return track; },
        get isSelected() { return isSelected; },
        get trackColor() { return trackColor; },
        get permuteMutedNow() { return permuteMutedNow; },

        handleSelect,
        handleMuteToggle
    };
}
