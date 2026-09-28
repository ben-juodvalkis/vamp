/**
 * Track preparation — atomic create-or-reuse + load via the Python
 * surface's `/looping/v3/track/prepare_for_preset` endpoint.
 *
 * The previous version of this module ran a multi-step UI-side state
 * machine: query clip state via stale store reads → decide reuse-vs-
 * create → send a separate create wire → wait for ack → select →
 * load. Each hop had a race window; rapid taps spawned duplicate
 * tracks; loads occasionally landed on the wrong (occupied) track
 * during the `/looping/v3/selected_track` echo lag.
 *
 * The current version sends a single message carrying the user's
 * intent (`trackType`, `presetPath`) plus a UUID `requestId`. Python
 * decides reuse-vs-create against authoritative LOM reads, executes
 * within at most two ticks, and replies with one ack/nack carrying
 * the same `requestId`. Retransmits hit Python's LRU and replay the
 * cached ack — never spawning a second track.
 *
 * Concurrency: per-trackType single-flight queue. A request for
 * `'midi'` while a previous `'midi'` request is in flight waits for
 * the first to land before sending — so two rapid taps reuse the
 * track the first one created instead of racing to make two.
 *
 * Permute placement is server-side: the Python ``TrackPrepareComponent``
 * appends Permute on every successful prep (idempotent — skipped when
 * already on the chain), so a single ``prepare_for_preset`` round-trip
 * leaves the track ready. The previous design fired a follow-up
 * ``/looping/v3/device/load`` from the UI after each ack; under
 * multi-client subscriptions that double-loaded the device, and on
 * MIDI loads it added a perceptible second hop after the instrument
 * landed. Foot-pedal hold continues to append Permute inline on the
 * Python side via its own path (FootTriggerComponent).
 */

import { send } from '$lib/api/simpleClient';
import {
    addOscMessageListener,
    removeOscMessageListener,
    type OscBusMessage
} from '$lib/api/connection/oscMessageBus';
import { setTrackName } from '$lib/services/trackCommands';
import { v3Store } from '$lib/stores/v3/normalized.svelte';
import { logger } from '$lib/utils/logger';

// --- wire addresses -------------------------------------------------------

const PREPARE_ADDRESS = '/looping/v3/track/prepare_for_preset';
const PREPARE_ACK_ADDRESS = '/looping/v3/track/prepare_for_preset/ack';
const PREPARE_NACK_ADDRESS = '/looping/v3/track/prepare_for_preset/nack';

// --- timing ---------------------------------------------------------------

// Outer timeout for one prepare round-trip. Python's audio-create path
// defers one tick (≤100ms typical) for template settling, plus the
// browser-cache build cost on first load (~hundreds of ms on a heavy
// library). 8s is generous headroom; past that, Live is unhealthy.
const PREPARE_TIMEOUT_MS = 8000;

// --- types ---------------------------------------------------------------

export type TrackType = 'midi' | 'audio';

export interface PrepareResult {
    /** Canonical wire path of the prepared track, e.g. ``tracks/3``. */
    trackPath: string;
    /** Track index parsed from ``trackPath``; convenience for callers. */
    trackIndex: number;
    /** True when Python created a new track; false when it reused one. */
    wasCreated: boolean;
}

// --- single-flight per-trackType queue -----------------------------------

// One promise chain per trackType. A rapid tap for the same type waits
// for the prior in-flight request to settle before sending its own —
// so the second tap sees the first tap's track in v3 state and reuses
// it (Python's reuse decision needs the prior create to have landed).
//
// Cross-type requests run independently; preparing a midi track and
// an audio track concurrently is fine.
const queues: Map<TrackType, Promise<unknown>> = new Map();

/**
 * Atomic prepare-and-(optionally-)load. Returns the resolved track
 * after Python finishes the requested work.
 *
 * `presetPath` empty = create-or-reuse + (audio) configure routing/arm
 * but skip the instrument load. Used by the browser's open-up-front
 * prep so the user sees the new track immediately even before tapping
 * a preset.
 *
 * `presetPath` non-empty = same prep, then load the preset onto the
 * resolved track in the same Python tick.
 *
 * `targetTrackPath` non-empty (replace-instrument mode) = skip the
 * reuse-vs-create decision entirely and load onto that exact track.
 * Live swaps the instrument in the instrument slot in place; clips,
 * Permute, and FX on the track are preserved. Python nacks if the
 * track doesn't exist.
 */
/**
 * `source` and `rel` (protocol 3.11.0, onboarding.plan.md §6.3): the Place
 * the preset is in (`place:<name>`, `library`, `pack:<name>`) and its path
 * inside it, so the surface looks it up there rather than by a root typed
 * into the config. Optional: a Recent entry or a config preset sends none and
 * the surface resolves the path through Live's own library.
 */
export async function prepareForPreset(
    trackType: TrackType,
    presetPath: string = '',
    targetTrackPath: string = '',
    source: string = '',
    rel: string = ''
): Promise<PrepareResult> {
    const previous = queues.get(trackType) ?? Promise.resolve();
    const myPromise: Promise<PrepareResult> = previous
        .catch(() => undefined) // a previous failure must not block us
        .then(() => doPrepareForPreset(trackType, presetPath, targetTrackPath, source, rel));
    queues.set(trackType, myPromise);
    try {
        return await myPromise;
    } finally {
        // Only clear if we're still the latest entry — a newer request
        // may have already replaced the queue value with its own.
        if (queues.get(trackType) === myPromise) {
            queues.delete(trackType);
        }
    }
}

async function doPrepareForPreset(
    trackType: TrackType,
    presetPath: string,
    targetTrackPath: string,
    source = '',
    rel = ''
): Promise<PrepareResult> {
    const requestId = generateRequestId();
    logger.debug('prepareForPreset: sending', {
        component: 'trackPreparation', requestId, trackType,
        presetPath: presetPath || '(none)',
        targetTrackPath: targetTrackPath || '(auto)',
    });

    return new Promise<PrepareResult>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            removeOscMessageListener(handler);
            clearTimeout(timer);
            fn();
        };

        const handler = (msg: OscBusMessage) => {
            if (!msg || !msg.address || !msg.args) return;
            if (msg.address !== PREPARE_ACK_ADDRESS && msg.address !== PREPARE_NACK_ADDRESS) return;
            if (msg.args[0] !== requestId) return;

            if (msg.address === PREPARE_ACK_ADDRESS) {
                const trackPath = String(msg.args[1] ?? '');
                const wasCreated = Number(msg.args[2] ?? 0) !== 0;
                const trackIndex = parseTrackIndex(trackPath);
                if (trackIndex < 0) {
                    settle(() => reject(new Error(
                        `prepareForPreset: malformed trackPath in ack: ${trackPath}`
                    )));
                    return;
                }
                logger.debug('prepareForPreset: ack', {
                    component: 'trackPreparation',
                    requestId, trackPath, wasCreated,
                });
                settle(() => resolve({ trackPath, trackIndex, wasCreated }));
            } else {
                const code = String(msg.args[1] ?? '');
                const detail = String(msg.args[2] ?? '');
                logger.warn('prepareForPreset: nack', {
                    component: 'trackPreparation',
                    requestId, code, detail,
                });
                settle(() => reject(new Error(`prepareForPreset ${code}: ${detail}`)));
            }
        };

        addOscMessageListener(handler);
        // 4th arg (target_track_path) pins replace-mode loads to an exact
        // track. Empty string = auto (reuse-vs-create). Always sent so the
        // wire shape is stable; Python treats a 3-arg message as auto too.
        send(PREPARE_ADDRESS, source && rel ? [requestId, trackType, presetPath, targetTrackPath, source, rel] : [requestId, trackType, presetPath, targetTrackPath]);

        const timer = setTimeout(() => {
            settle(() => reject(new Error(
                `prepareForPreset timeout (${PREPARE_TIMEOUT_MS}ms) for ${trackType}`
            )));
        }, PREPARE_TIMEOUT_MS);
    });
}

export function generateRequestId(): string {
    // crypto.randomUUID is available in iPad Safari 12.3+ and every
    // modern Chromium / Firefox build. The fallback path covers
    // Vitest/jsdom environments where crypto isn't fully populated.
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function parseTrackIndex(trackPath: string): number {
    const m = trackPath.match(/^tracks\/(\d+)$/);
    if (!m) return -1;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : -1;
}

// --- backward-compat: `prepareTrack` returning trackIndex only ----------

/**
 * Legacy entry point — prep an empty track and return its index.
 *
 * Equivalent to ``prepareForPreset(trackType, '').trackIndex`` with
 * the failure mode collapsed to ``undefined`` instead of throwing,
 * matching the prior contract that callers already handle.
 */
export async function prepareTrack(trackType: TrackType): Promise<number | undefined> {
    try {
        const result = await prepareForPreset(trackType, '');
        return result.trackIndex;
    } catch (err) {
        logger.warn('prepareTrack failed', { component: 'trackPreparation', trackType, err: String(err) });
        return undefined;
    }
}

// --- view focus helper ---------------------------------------------------

export type LiveViewName = 'Browser' | 'Arranger' | 'Session' | 'Detail' | 'Detail/Clip' | 'Detail/DeviceChain';

export function focusView(viewName: LiveViewName): void {
    logger.debug(`Focusing view: ${viewName}`, { component: 'trackPreparation' });
    send('/looping/v3/view/focus', [viewName]);
}

// --- file-extension classification ---------------------------------------

const VALID_PRESET_EXTENSIONS = [
    '.adg', '.adv', '.aupreset', '.vstpreset', '.fxp',
] as const;

const AUDIO_FILE_EXTENSIONS = [
    '.wav', '.aif', '.aiff', '.mp3', '.flac',
    '.ogg', '.m4a', '.wma', '.aac',
] as const;

function classifyFile(filePath: string): 'audio' | 'preset' | 'unknown' {
    const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
    if (AUDIO_FILE_EXTENSIONS.includes(ext as any)) return 'audio';
    if (VALID_PRESET_EXTENSIONS.includes(ext as any)) return 'preset';
    return 'unknown';
}

// --- loadPreset: routes audio files to clip slots, presets through atomic prep -----

/**
 * Load a file (audio or instrument preset) onto a specific track.
 *
 * `trackPath` is required — there is no fallback to the lagging
 * `selectedTrackStore.selectedTrackPath`. Callers MUST pass an
 * explicit trackPath returned by `prepareForPreset()` (or any other
 * source that knows the canonical path). Without this, an instrument
 * could land on the previously-selected (occupied) track during the
 * `/looping/v3/selected_track` echo window — that's the catastrophic
 * "wrong-track load" bug; making `trackPath` mandatory removes it
 * structurally.
 *
 * For audio files (`.wav`/`.aif`/...) this routes through
 * `clip/load_file` which calls `ClipSlot.create_audio_clip` and
 * accepts arbitrary absolute paths. The Browser-tree walk used by
 * `device/load` cannot resolve raw audio leaves under user_library,
 * so audio loads must travel a different wire.
 *
 * For instrument presets, this routes through the atomic
 * `prepare_for_preset` endpoint — which reuses the (already-prepared,
 * empty) target track or creates a new one if the caller's view of
 * the track became stale. Permute is appended by Python as part of
 * the prep, so no UI follow-up is needed.
 */
export async function loadPreset(
    filePath: string,
    fileName: string | undefined,
    trackPath: string
): Promise<void> {
    if (!trackPath) {
        // Defensive — shouldn't happen with the type-required signature
        // but a JS caller could still hand us "". Fail loud rather than
        // silently retargeting to whoever's selected.
        throw new Error('loadPreset: trackPath is required');
    }

    const cls = classifyFile(filePath);
    logger.debug('loadPreset', { component: 'trackPreparation', filePath, trackPath, cls });

    if (cls === 'unknown') {
        logger.warn('loadPreset: unknown extension; treating as preset', {
            component: 'trackPreparation', filePath,
        });
    }

    if (cls === 'audio') {
        // Empty slotPath tells ClipsComponent to pick the first empty
        // slot on trackPath.
        send('/looping/v3/clip/load_file', [trackPath, '', filePath]);
        if (fileName) {
            setTrackName(trackPath, fileName);
        }
        return;
    }

    // Preset file (or unknown — treat as preset). Route through the
    // atomic endpoint so reuse-vs-create stays server-decided. The
    // already-prepared empty track will be reused by Python; if the
    // user managed to make it dirty since, Python creates a fresh one
    // and we get the new index back.
    const trackType: TrackType = inferTrackTypeFromPath(trackPath);
    const result = await prepareForPreset(trackType, filePath);

    // Rename the track to the preset name. Use the resolved trackPath
    // from the ack (which may differ from the hint trackPath if Python
    // created a fresh track instead of reusing).
    if (fileName && result.trackPath !== 'master') {
        setTrackName(result.trackPath, fileName);
    }
}

function inferTrackTypeFromPath(trackPath: string): TrackType {
    const idx = parseTrackIndex(trackPath);
    if (idx < 0) return 'midi';
    const track = v3Store.tracks.get(`tracks/${idx}`);
    if (!track) return 'midi';
    return track.hasMidiInput ? 'midi' : 'audio';
}
