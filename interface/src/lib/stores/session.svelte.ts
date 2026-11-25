/**
 * Session Store — the song-level state the v3 surface reports (transport,
 * tempo, signature, loop, scale, launch quantization, session settings)
 * and the UI's selected track, scene and focused clip.
 *
 * The v3 handlers (`api/handlers/v3Session.ts`, `v3SelectedTrack.ts`,
 * `v3SelectedScene.ts`, `v3Clip.ts`) call the `handle*` setters below
 * directly. The UI's own writes paint first through the `*Optimistically`
 * methods; a pending latch per value drops the one stale echo a rapid
 * A→B tap can produce.
 */

import type { TimeSignature } from '$lib/domain/live-objects.js';
import { logger } from '$lib/utils/logger';
import { parseClipPath, regularTrackIndexOf } from '$lib/utils/livePaths';
import { getRootNoteName, getScaleName, getScaleIndex } from '$lib/data/scales';
import {
  DEFAULT_LAUNCH_QUANTIZATION,
  isValidLaunchQuantization
} from '$lib/data/launchQuantization';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import { clipPropertiesStore } from '$lib/stores/v6/clipPropertiesStore.svelte';
import { clipGrooveStore } from '$lib/stores/v6/clipGrooveStore.svelte';
import { focusedNotesStore } from '$lib/stores/v6/focusedNotesStore.svelte';
import { v3Store } from '$lib/stores/v3/normalized.svelte';

// Session state using Svelte 5 runes
let _tempo = $state(120.0);
let _isPlaying = $state(false);
let _currentTime = $state(0.0);
let _loopStart = $state(0.0);
let _loopEnd = $state(4.0);
let _isLooping = $state(false);
let _timeSignature = $state<TimeSignature>({ numerator: 4, denominator: 4 });
let _selectedTrackIndex = $state(0);
// When an optimistic selection is in-flight, holds the index we're waiting
// to confirm. Stale echoes (index !== _pendingTrackIndex) are ignored so a
// rapid A→B tap sequence doesn't flash A's highlight when A's echo arrives
// after B's optimistic write. Cleared to null once the confirming echo lands
// or an Ableton-initiated selection arrives with no pending write.
let _pendingTrackIndex: number | null = null;
let _selectedSceneIndex = $state(0);
let _sessionRecord = $state(false);
let _metronome = $state(false);
let _pendingMetronome: boolean | null = null;
let _pendingIsPlaying: boolean | null = null;
// Tempo pending: the last value sent by the UI. Echoes that match are
// confirmations; echoes that don't match during a drag are Ableton's
// clamped/rounded value and should be accepted (clear pending on any echo).
let _pendingTempo: number | null = null;
let _groove = $state(0.0);

// ROW 6.9 (2026-04-21): track count derived from v3Store.tracks — the
// state/full T-records are the single source of truth. Regular tracks
// are keyed `tracks/<N>`; master and returns/<N> are excluded because
// it mirrors LOM's `live_set.tracks` count.
const _trackCount = $derived.by(() => {
  let count = 0;
  for (const key of v3Store.tracks.keys()) {
    if (regularTrackIndexOf(key) !== null) count++;
  }
  return count;
});
// PR-5e1: v3 focused clipPath authored by the Python Control Surface.
// Empty string on the wire means "no focused clip" — normalized to null here.
// Surviving clearSession (owned by v3, not legacy v6 track list).
let _focusedClipPath = $state<string | null>(null);

// Cached parse of _focusedClipPath into {track, scene} indices.
// Parse once on change rather than in the getter, both for perf and
// to prevent reference inequality causing infinite $effect loops.
let _cachedFocusedClipIndices = $state<{ track: number; scene: number } | null>(null);

// Scale/Root Note state - from Max4Live live_set.root_note and live_set.scale_name
let _rootNote = $state(0); // 0-11 (C, C#, D, D#, E, F, F#, G, G#, A, A#, B)
let _scaleName = $state(0); // 0-31 (Major, Minor, Dorian, etc.)
let _scaleMode = $state(false); // Whether scale highlighting is enabled in Live

// ADR-446: the last key detection the surface answered, whole — the picker
// shows key, band and runner-up, and the reasons ride its tooltip.
export type ScaleDetectedBand = 'sure' | 'plausible' | 'unsure' | 'no-key';
const SCALE_DETECTED_BANDS: ReadonlySet<string> = new Set(['sure', 'plausible', 'unsure', 'no-key']);
export interface ScaleDetected {
  /** 0..11, or -1 under `no-key`. */
  root: number;
  /** One of Live's scale names, or '' under `no-key`. */
  scale: string;
  band: ScaleDetectedBand;
  /** (winner - runner-up) / winner, in percent. */
  gapPct: number;
  runnerRoot: number;
  runnerScale: string;
  /** 12-bit mask of the sounding pitch classes, bit 0 = C. */
  pitchClasses: number;
  /** The vote ladder as text, ' | '-joined. */
  reasons: string;
  /** The surface already wrote the key (the root/scale/mode echoes follow). */
  applied: boolean;
  /** Receipt time (ms), so a sender can tell a fresh answer from the last one. */
  at: number;
}
let _scaleDetected = $state<ScaleDetected | null>(null);

// SessionSettings runtime toggles (Python: SessionSettingsComponent,
// shipped 2026-04-22). Default-on — matches surface default so UI
// doesn't flash out-of-sync during cold-start before the init-emit
// arrives.
let _autoArmEnabled = $state(true);
let _moveVolumeKnobEnabled = $state(true);
// auto_capture (gate for auto-record-on-play + save-as-on-stop). Unlike the
// two above it is NOT default-on: the surface cold-starts it `false`
// (dev-safe) and upgrades to the launch-mode default on the first heartbeat,
// so `false` is the honest pre-seed value here too.
let _autoCaptureEnabled = $state(false);
// ADR-447: the key follows the loops. Default on, like the surface's.
let _keyFollowEnabled = $state(true);

// Global launch quantization — Live's `song.clip_trigger_quantization`
// enum, 0..13 (0 = None, 4 = 1 Bar, 13 = 1/32). Seeded by the surface's
// init-emit / on-accept re-emit; `4` matches Live's own default so a
// cold-start UI doesn't flash "None" (which would read as *no* quantize
// — the one value with audibly different launch behavior).
let _clipTriggerQuantization = $state(DEFAULT_LAUNCH_QUANTIZATION);

/**
 * Track-change side effects (the FX grid's reset, dropping param arms, the
 * `track-changed` window event) belong to whoever owns them; they register
 * here and run once per real change of the selected track, whether the UI
 * selected it or Live did. A stale echo the pending latch drops never
 * reaches them.
 */
type SelectedTrackListener = (trackIndex: number, previous: number) => void;
const _selectedTrackListeners = new Set<SelectedTrackListener>();

export function onSelectedTrackChange(listener: SelectedTrackListener): () => void {
  _selectedTrackListeners.add(listener);
  return () => _selectedTrackListeners.delete(listener);
}

function setSelectedTrack(trackIndex: number): void {
  const previous = _selectedTrackIndex;
  if (previous === trackIndex) return;
  _selectedTrackIndex = trackIndex;
  for (const listener of _selectedTrackListeners) {
    try {
      listener(trackIndex, previous);
    } catch (error) {
      logger.error('Selected-track listener failed', { error, trackIndex, previous });
    }
  }
}

/**
 * The session store's reactive surface.
 */
export const session = {
  // Core song properties
  get tempo() { return _tempo; },
  get isPlaying() { return _isPlaying; },
  get currentTime() { return _currentTime; },
  get loopStart() { return _loopStart; },
  get loopEnd() { return _loopEnd; },
  get isLooping() { return _isLooping; },
  get timeSignature() { return _timeSignature; },
  get selectedTrackIndex() { return _selectedTrackIndex; },
  get selectedSceneIndex() { return _selectedSceneIndex; },
  get sessionRecord() { return _sessionRecord; },
  get metronome() { return _metronome; },
  get groove() { return _groove; },

  // Track list state
  get numTracks() { return _trackCount; },

  // PR-5e1: v3 focused clipPath (positional ref like `tracks/0/slots/2/clip`).
  // Authoritative source for clip property addressing in v3 UI.
  get focusedClipPath() { return _focusedClipPath; },
  get hasFocusedClipPath(): boolean { return _focusedClipPath !== null; },

  // Positional {track, scene} parse of focusedClipPath. Returns null
  // for paths that aren't of the canonical `tracks/<N>/slots/<M>/clip`
  // shape (e.g. arrangement-only clips that currently emit "").
  // Replaces legacy `detailClipIndices` as the canonical source of
  // "which clip does the central view/clip-ops target" now that the
  // M4L `/looping/clip/detail` path is unreliable.
  get focusedClipIndices(): { track: number; scene: number } | null {
    return _cachedFocusedClipIndices;
  },

  // Scale/Root Note state
  get rootNote() { return _rootNote; },
  get scaleName() { return _scaleName; },
  get rootNoteName(): string {
    return getRootNoteName(_rootNote);
  },
  get scaleDisplayName(): string {
    return getScaleName(_scaleName);
  },
  get scaleMode() { return _scaleMode; },
  /** ADR-446: the last key detection, or null before the first. */
  get scaleDetected(): ScaleDetected | null { return _scaleDetected; },

  // SessionSettings runtime toggles
  get autoArmEnabled() { return _autoArmEnabled; },
  get moveVolumeKnobEnabled() { return _moveVolumeKnobEnabled; },
  get autoCaptureEnabled() { return _autoCaptureEnabled; },
  get keyFollowEnabled() { return _keyFollowEnabled; },
  get clipTriggerQuantization() { return _clipTriggerQuantization; },

  // Computed properties
  get timeSignatureString(): string {
    return `${_timeSignature.numerator}/${_timeSignature.denominator}`;
  },

  // Optimistically update selected track index before the OSC round-trip
  // completes. Records a pending index so stale echoes from previous taps
  // are ignored — see _pendingTrackIndex above. The track-change side
  // effects run from here, once (`onSelectedTrackChange`).
  selectTrackOptimistically(trackIndex: number) {
    if (_selectedTrackIndex === trackIndex) return;
    logger.debug('Track selection optimistic update', { from: _selectedTrackIndex, to: trackIndex });
    _pendingTrackIndex = trackIndex;
    if (trackIndex === -1) {
      centralDisplayStore.setView('system');
    }
    setSelectedTrack(trackIndex);
  },

  // Optimistically move the selected scene before Live echoes it back.
  //
  // This is the foot pedal's row: the highlighted clip slot is the
  // intersection of the selected track and the selected scene, so this
  // and `selectTrackOptimistically` together are what move the pedal's
  // target. The write goes out as `selected_clip`, and Live answers on
  // `selected_scene` — over WiFi to the iPad that round trip is long
  // enough to see, and a cursor that lags the finger is exactly what
  // makes a performance surface feel unreliable.
  //
  // Nothing to reconcile: the echo carries the same index and simply
  // re-lands on it. If Live disagrees (an out-of-range row, a set that
  // changed underneath), its value wins the moment it arrives — the
  // same shape `selectTrackOptimistically` has.
  selectSceneOptimistically(sceneIndex: number) {
    if (sceneIndex < 0 || _selectedSceneIndex === sceneIndex) return;
    logger.debug('Scene selection optimistic update', {
      from: _selectedSceneIndex,
      to: sceneIndex
    });
    _selectedSceneIndex = sceneIndex;
  },

  toggleMetronomeOptimistically() {
    const next = !_metronome;
    _metronome = next;
    _pendingMetronome = next;
  },

  toggleTransportOptimistically() {
    const next = !_isPlaying;
    _isPlaying = next;
    _pendingIsPlaying = next;
  },

  // Valid range is 20–999 BPM (enforced by the call site before calling this).
  setTempoOptimistically(bpm: number) {
    _tempo = bpm;
    _pendingTempo = bpm;
  },

  // Launch quantization: paint the tapped value immediately, then let the
  // surface's echo confirm. No pending-slot bookkeeping — unlike tempo
  // there's no drag stream to reconcile, and the surface rejects
  // out-of-range writes without echoing, so a bad value can only come
  // from a UI bug the guard below catches first.
  setClipTriggerQuantizationOptimistically(value: number) {
    if (!isValidLaunchQuantization(value)) {
      logger.warn('Ignoring out-of-range launch quantization', { value });
      return;
    }
    _clipTriggerQuantization = value;
  }
};

/**
 * Read `session.focusedClipPath` with a single, consistent miss policy.
 *
 * Returns the path string when a clip is focused, or null when not.
 * Pass `{ component, op }` to emit a logger.warn on miss; omit the
 * argument when the caller wants silent fallback (e.g. setter writes
 * gated on a focused clip but where logging would spam during normal
 * "no clip selected yet" UI states).
 *
 * Centralizes the ~10 inline `if (!clipPath) { logger.warn(...); return; }`
 * blocks the code-quality audit flagged.
 */
export function requireFocusedClip(opts?: {
  component: string;
  op: string;
}): string | null {
  const clipPath = session.focusedClipPath;
  if (!clipPath) {
    if (opts) {
      logger.warn(`${opts.op}: no focused clip`, { component: opts.component });
    }
    return null;
  }
  return clipPath;
}

// ============================================
// Setters the v3 handlers call
// ============================================

/** `/looping/session/tempo`. Always accepts the echo — it may carry
 *  Ableton's clamped/rounded value — and clears the pending flag so later
 *  Live-initiated changes (automation, tap tempo) are not suppressed. */
export function handleTempoUpdate(bpm: number): void {
  _pendingTempo = null;
  const oldTempo = _tempo;
  _tempo = bpm;
  logger.debug('Tempo updated', { oldTempo: oldTempo.toFixed(1), newTempo: bpm.toFixed(1) });
}

/** `/looping/v3/session/is_playing`. */
export function handleTransportUpdate(isPlaying: boolean): void {
  if (_pendingIsPlaying !== null && isPlaying !== _pendingIsPlaying) {
    logger.debug('Transport echo dropped (stale)', { echo: isPlaying, pending: _pendingIsPlaying });
    // Clear the latch even though this echo is dropped. The latch exists to
    // swallow the ONE stale echo from a rapid A→B tap; it is not a filter
    // that should persist. Nothing else writes these back to null and there
    // is no timer, so a latch left set here is set forever — and the
    // confirming echo can legitimately never arrive, because the surface
    // emits only on an actual change (a write landing on the value Live is
    // already on produces no echo at all). `_pendingTempo` has always done
    // this correctly.
    _pendingIsPlaying = null;
    return;
  }
  _pendingIsPlaying = null;
  _isPlaying = isPlaying;
  logger.debug('Transport updated', { state: isPlaying ? 'Playing' : 'Stopped' });
}

/** `/looping/v3/session/session_record`. */
export function handleSessionRecordUpdate(enabled: boolean): void {
  _sessionRecord = enabled;
  logger.debug('Session Record updated', { state: enabled ? 'On' : 'Off' });
}

/** `/looping/v3/session/signature_num` / `signature_den`: the surface sends
 *  the two halves separately, so a caller passes the half it did not get
 *  from the store. */
export function handleTimeSignatureUpdate(numerator: number, denominator: number): void {
  _timeSignature = { numerator, denominator };
  logger.debug('Time Signature updated', { signature: `${numerator}/${denominator}` });
}

/** `/looping/v3/session/song_time`: beats since the arrangement start. */
export function handleSongTimeUpdate(beats: number): void {
  _currentTime = beats;
}

/** `/looping/v3/session/loop`, `loop_start`, `loop_length` (the store keeps
 *  start and end; the caller converts from Live's start and length). */
export function handleLoopUpdate(isLooping: boolean, loopStart: number, loopEnd: number): void {
  _isLooping = isLooping;
  _loopStart = loopStart;
  _loopEnd = loopEnd;
  logger.debug('Loop updated', {
    enabled: isLooping,
    loopStart: loopStart.toFixed(1),
    loopEnd: loopEnd.toFixed(1)
  });
}

/** `/looping/v3/session/metronome`, with the same self-healing latch as
 *  the transport. */
export function handleMetronomeUpdate(enabled: boolean): void {
  if (_pendingMetronome !== null && enabled !== _pendingMetronome) {
    logger.debug('Metronome echo dropped (stale)', { echo: enabled, pending: _pendingMetronome });
    _pendingMetronome = null;
    return;
  }
  _pendingMetronome = null;
  _metronome = enabled;
  logger.debug('Metronome updated', { state: enabled ? 'On' : 'Off' });
}

/** `/looping/v3/session/groove_amount`, 0..1. */
export function handleGrooveUpdate(amount: number): void {
  _groove = amount;
  logger.debug('Groove updated', { groove: `${(amount * 100).toFixed(0)}%` });
}

/**
 * `/looping/v3/selected_track`: Live's selected track (-1 is master).
 *
 * While an optimistic selection is in flight, only the echo matching the
 * latest pending index applies; an echo for an earlier tap is dropped so a
 * rapid A→B sequence neither flashes A's highlight nor runs A's
 * track-change side effects. A Live-initiated selection (nothing pending)
 * always applies. Arm-follows-selection is the surface's
 * `ExclusiveArmComponent`, not the UI's.
 */
export function handleTrackSelectionUpdate(trackIndex: number): void {
  if (_pendingTrackIndex !== null && trackIndex !== _pendingTrackIndex) {
    logger.debug('Track selection echo dropped (stale)', {
      echo: trackIndex,
      pending: _pendingTrackIndex
    });
    // Same self-healing clear as the transport latch.
    _pendingTrackIndex = null;
    return;
  }
  _pendingTrackIndex = null;
  logger.debug('Track Selection updated', { from: _selectedTrackIndex, to: trackIndex });
  // Master shows the system view; a regular track's view is the
  // instrumentDisplayCoordinator's.
  if (trackIndex === -1) {
    centralDisplayStore.setView('system');
  }
  setSelectedTrack(trackIndex);
}

/** `/looping/v3/selected_scene`. */
export function handleSceneSelectionUpdate(sceneIndex: number): void {
  const oldScene = _selectedSceneIndex;
  _selectedSceneIndex = sceneIndex;
  logger.debug('Scene Selection updated', { oldScene, newScene: sceneIndex });
}

/**
 * Clear session state for initialization.
 *
 * PR-5d: v3 SessionComponent.emit_on_accept() now seeds tempo/transport/
 * loop/signature/scale + metronome/session_record on handshake accept,
 * and listener echoes keep them current. Resetting them here in
 * onConnected() raced with that re-emit (clearSession fires ~500ms AFTER
 * handshake accept in simpleClient.onConnected → race clobbered
 * Live-truth values back to defaults). So this function no longer touches
 * any v3-owned session scalar — only legacy v6 things that still need
 * explicit reset on reconnect (track list, stats).
 */
export function clearSession(): void {
  // ADR-446: a detection is about the set that was playing; a new session
  // (surface restart, set load, reconnect) starts with none.
  _scaleDetected = null;

  logger.info('Session data cleared');
}

/**
 * PR-5e1: Handle focused clipPath updates from the Python Control Surface.
 *
 * Wire: `/looping/v3/clip/focused [clipPath | ""]`
 *
 * - Empty string → null (no focused clip).
 * - On change, clear the scalar `clipPropertiesStore` so stale values from
 *   the previous clip don't bleed through while listener echoes for the
 *   new clip are in flight.
 * - The late-echo filter in `clipHandler` uses this path to drop
 *   `/looping/v3/clip/property` fires whose clipPath no longer matches.
 */
export function handleFocusedClipPath(path: string): void {
  const normalized = path === '' ? null : path;
  if (_focusedClipPath === normalized) {
    return;
  }

  _focusedClipPath = normalized;

  // Update the cached {track, scene} parse synchronously so readers
  // (ClipCentralView, clipDisplayCoordinator, clipOperations) see
  // consistent values on the same tick that focusedClipPath updates.
  if (normalized === null) {
    _cachedFocusedClipIndices = null;
  } else {
    const ref = parseClipPath(normalized);
    _cachedFocusedClipIndices = ref ? { track: ref.trackIndex, scene: ref.sceneIndex } : null;
  }

  // Clear scalar property + groove stores on any focus change (including → null).
  // Must be synchronous: property writes from the Python surface arrive in
  // the same batch as the focused-path message, so a deferred clearAll
  // (e.g. via dynamic import) would wipe values that just landed.
  clipPropertiesStore.clearAll();
  clipGrooveStore.clearAll();
  // clip-view-mirror M3: drop the editor's rich note map on focus change —
  // the ClipEditorView re-pulls the rich channel for the new clip.
  focusedNotesStore.clearAll();
}

/**
 * Handle root note updates from Max Observer
 * Called when we receive /looping/song/root_note message
 */
export function handleRootNoteUpdate(rootNote: number): void {
  const previousNote = _rootNote;
  _rootNote = rootNote;
  logger.debug('Root Note updated', {
    previousNote: getRootNoteName(previousNote),
    newNote: getRootNoteName(rootNote)
  });
}

/**
 * Handle scale name updates from Max Observer
 * Called when we receive /looping/song/scale_name message
 * Note: Receives string name from Live API, converts to index for UI state
 */
export function handleScaleNameUpdate(scaleNameStr: string | number): void {
  const previousScale = _scaleName;

  // If we receive a number (shouldn't happen but handle it), use it directly
  if (typeof scaleNameStr === 'number') {
    _scaleName = scaleNameStr;
  } else {
    // Convert string name to index using shared utility
    _scaleName = getScaleIndex(scaleNameStr);
  }

  logger.debug('Scale updated', {
    previousScale: getScaleName(previousScale),
    newScale: getScaleName(_scaleName)
  });
}

/**
 * Handle scale mode updates from Max Observer
 * Called when we receive /looping/song/scale_mode message
 * Tracks whether scale highlighting is enabled in Ableton Live
 */
export function handleScaleModeUpdate(enabled: number | boolean): void {
  const previousMode = _scaleMode;
  _scaleMode = Boolean(enabled);
  if (previousMode !== _scaleMode) {
    logger.debug('Scale Mode updated', {
      previousMode: previousMode ? 'ON' : 'OFF',
      newMode: _scaleMode ? 'ON' : 'OFF'
    });
  }
}

/**
 * ADR-446: the surface answered `/looping/v3/session/scale/detected`.
 * An unknown band reads as `unsure` rather than as a key we trust.
 */
export function handleScaleDetected(d: Omit<ScaleDetected, 'band'> & { band: string }): void {
  const band: ScaleDetectedBand = SCALE_DETECTED_BANDS.has(d.band) ? (d.band as ScaleDetectedBand) : 'unsure';
  _scaleDetected = { ...d, band };
  logger.info('Key detected', {
    key: d.root >= 0 ? `${getRootNoteName(d.root)} ${d.scale}` : 'none',
    band,
    gapPct: d.gapPct,
    applied: d.applied
  });
}

/** ADR-446: forget the last detection (the picker closing, a new set). */
export function clearScaleDetected(): void {
  _scaleDetected = null;
}

/**
 * Global launch quantization update (2026-07-27).
 *
 * Called from `v3Session.ts` on
 * `/looping/v3/session/clip_trigger_quantization [0..13]` — both the
 * surface's seed/on-accept emits and the echo after a UI write. Values
 * outside Live's enum are dropped rather than stored: they'd render as
 * a picker with nothing selected.
 */
export function handleClipTriggerQuantizationUpdate(value: number): void {
  if (!isValidLaunchQuantization(value)) {
    logger.warn('Ignoring out-of-range launch quantization echo', { value });
    return;
  }
  if (_clipTriggerQuantization === value) return;
  _clipTriggerQuantization = value;
  logger.debug('Launch quantization updated', { value });
}

/**
 * SessionSettings: auto_arm toggle update (2026-04-22).
 *
 * Called from `v3Session.ts` on `/looping/v3/session/auto_arm [0|1]`.
 * Mirrors the surface state set by SessionSettingsComponent; writers
 * live in UI controls that send the same address back to the surface.
 */
export function handleAutoArmUpdate(enabled: number | boolean): void {
  const next = Boolean(typeof enabled === 'number' ? enabled : enabled);
  if (_autoArmEnabled === next) return;
  _autoArmEnabled = next;
  logger.info('SessionSettings: auto_arm', { enabled: next });
}

/**
 * SessionSettings: move_volume_knob toggle update (2026-04-22).
 */
export function handleMoveVolumeKnobUpdate(enabled: number | boolean): void {
  const next = Boolean(typeof enabled === 'number' ? enabled : enabled);
  if (_moveVolumeKnobEnabled === next) return;
  _moveVolumeKnobEnabled = next;
  logger.info('SessionSettings: move_volume_knob', { enabled: next });
}

/**
 * SessionSettings: auto_capture toggle update (2026-07-06).
 *
 * Gates auto-record-on-play + save-as-on-stop. Arrives from the surface's
 * init-emit, its first-heartbeat mode seed, the bridge's override replay
 * (ADR-405), and any client's write echo — all on the one address.
 */
export function handleAutoCaptureUpdate(enabled: number | boolean): void {
  const next = Boolean(typeof enabled === 'number' ? enabled : enabled);
  if (_autoCaptureEnabled === next) return;
  _autoCaptureEnabled = next;
  logger.info('SessionSettings: auto_capture', { enabled: next });
}

/**
 * ADR-447: key_follow toggle update, from `/looping/v3/session/key_follow [0|1]`.
 * Writers are the picker's Follow / Locked button, the Behavior card, and the
 * surface itself — it turns Follow off when a key arrives from any client's
 * `scale_root` / `scale_name`, or changes by hand inside Live.
 */
export function handleKeyFollowUpdate(enabled: number | boolean): void {
  const next = Boolean(enabled);
  if (_keyFollowEnabled === next) return;
  _keyFollowEnabled = next;
  logger.info('SessionSettings: key_follow', { enabled: next });
}
