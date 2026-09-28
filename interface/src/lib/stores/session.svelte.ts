/**
 * V6 Session Store - AbletonOSC Integration
 * Type-safe session state management using validated domain updates
 */

import type { LiveSong, TimeSignature } from '$lib/domain/live-objects.js';
import type {
  DomainUpdate,
  TempoUpdate,
  TransportUpdate,
  SessionRecordUpdate,
  TimeSignatureUpdate,
  CurrentTimeUpdate,
  LoopUpdate,
  MetronomeUpdate,
  GrooveUpdate,
  TrackSelectionUpdate,
  SceneSelectionUpdate,
  FocusedViewUpdate
} from '$lib/domain/updates.js';
import {
  isTempoUpdate,
  isTransportUpdate,
  createErrorUpdate
} from '$lib/domain/updates.js';
import { logger } from '$lib/utils/logger';
import { ROOT_NOTES, SCALE_NAMES, getRootNoteName, getScaleName, getScaleIndex } from '$lib/data/scales';
import {
  DEFAULT_LAUNCH_QUANTIZATION,
  isValidLaunchQuantization
} from '$lib/data/launchQuantization';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import { clipPropertiesStore } from '$lib/stores/v6/clipPropertiesStore.svelte';
import { clipGrooveStore } from '$lib/stores/v6/clipGrooveStore.svelte';
import { focusedNotesStore } from '$lib/stores/v6/focusedNotesStore.svelte';
import { v3Store } from '$lib/stores/v3/normalized.svelte';
import { createErrorGrouper } from './sessionErrorGrouper';

// Session state using Svelte 5 runes
let _tempo = $state(120.0);
let _isPlaying = $state(false);
let _isRecording = $state(false);
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
let _arrangementOverdub = $state(false);
let _backToArranger = $state(false);
let _metronome = $state(false);
let _pendingMetronome: boolean | null = null;
let _pendingIsPlaying: boolean | null = null;
// Tempo pending: the last value sent by the UI. Echoes that match are
// confirmations; echoes that don't match during a drag are Ableton's
// clamped/rounded value and should be accepted (clear pending on any echo).
let _pendingTempo: number | null = null;
let _songLength = $state(0.0);
let _groove = $state(0.0);

// ROW 6.9 (2026-04-21): track list derived from v3Store.tracks — the
// state/full T-records are the single source of truth. Regular tracks
// are keyed `tracks/<N>`; master and returns/<N> are excluded because
// `_trackCount` historically mirrored LOM's `live_set.tracks` count.
const TRACK_PATH_RE = /^tracks\/(\d+)$/;
const _trackCount = $derived.by(() => {
  let count = 0;
  for (const key of v3Store.tracks.keys()) {
    if (TRACK_PATH_RE.test(key)) count++;
  }
  return count;
});
const _trackIndices = $derived.by(() => {
  const indices: number[] = [];
  for (const key of v3Store.tracks.keys()) {
    const m = TRACK_PATH_RE.exec(key);
    if (m) indices.push(Number(m[1]));
  }
  indices.sort((a, b) => a - b);
  return indices;
});

// PR-5e1: v3 focused clipPath authored by the Python Control Surface.
// Empty string on the wire means "no focused clip" — normalized to null here.
// Surviving clearSession (owned by v3, not legacy v6 track list).
let _focusedClipPath = $state<string | null>(null);

// Cached parse of _focusedClipPath into {track, scene} indices.
// Parse once on change rather than in the getter, both for perf and
// to prevent reference inequality causing infinite $effect loops.
let _cachedFocusedClipIndices = $state<{ track: number; scene: number } | null>(null);

// Focused view state - tracks whether Session or Arranger view is focused
let _focusedDocumentView = $state<'Session' | 'Arranger' | null>(null);

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

/**
 * The foot switch (`FootSwitchComponent` on the surface): a user setting with
 * Learn, from `/looping/v3/session/foot_switch`. `cc` is -1 until something
 * is learned; `channel` 0 means all 16. `learn` is `listening` while the
 * surface takes the next CC on its Input, and `timeout` when nothing came —
 * almost always because the pedal is not Looping's Input in Live's MIDI
 * settings. `heard` is whether the mapped CC has arrived since the surface
 * was built.
 */
export interface FootSwitchState {
  enabled: boolean;
  channel: number;
  cc: number;
  mode: 'momentary' | 'latching' | '';
  learn: 'idle' | 'listening' | 'timeout';
  heard: boolean;
}
// Nothing learned, off: what the surface itself starts from with no seed.
let _footSwitch = $state<FootSwitchState>({
  enabled: false,
  channel: 0,
  cc: -1,
  mode: '',
  learn: 'idle',
  heard: false
});

// Global launch quantization — Live's `song.clip_trigger_quantization`
// enum, 0..13 (0 = None, 4 = 1 Bar, 13 = 1/32). Seeded by the surface's
// init-emit / on-accept re-emit; `4` matches Live's own default so a
// cold-start UI doesn't flash "None" (which would read as *no* quantize
// — the one value with audibly different launch behavior).
let _clipTriggerQuantization = $state(DEFAULT_LAUNCH_QUANTIZATION);

// Groove state for selected clip (from liveAPI-v6.js)
let _selectedClipHasGroove = $state(false);
let _selectedClipGrooveBase = $state(1); // 0=1/8, 1=1/8T, 2=1/16
let _selectedClipGrooveTiming = $state(0);
let _selectedClipGrooveQuantization = $state(0);
let _selectedClipGrooveRandom = $state(0);

// Validation statistics for monitoring
let _updateCount = $state(0);
let _errorCount = $state(0);
let _lastUpdateTime = $state(0);
let _connectionStatus = $state<'connected' | 'disconnected' | 'error'>('disconnected');

// Error grouping to prevent spam (delegated to sessionErrorGrouper).
const _errorGrouper = createErrorGrouper();

/**
 * V6 Session Store Interface
 * Reactive getters with Svelte 5 integration
 */
export const session = {
  // Core song properties
  get tempo() { return _tempo; },
  get isPlaying() { return _isPlaying; },
  get isRecording() { return _isRecording; },
  get currentTime() { return _currentTime; },
  get loopStart() { return _loopStart; },
  get loopEnd() { return _loopEnd; },
  get isLooping() { return _isLooping; },
  get timeSignature() { return _timeSignature; },
  get selectedTrackIndex() { return _selectedTrackIndex; },
  get selectedSceneIndex() { return _selectedSceneIndex; },
  get sessionRecord() { return _sessionRecord; },
  get arrangementOverdub() { return _arrangementOverdub; },
  get backToArranger() { return _backToArranger; },
  get metronome() { return _metronome; },
  get songLength() { return _songLength; },
  get groove() { return _groove; },

  // Track list state
  get trackCount() { return _trackCount; },
  get numTracks() { return _trackCount; }, // Alias for UI components
  get trackIndices() { return _trackIndices; },

  // Focused view state - Session or Arranger
  get focusedDocumentView() { return _focusedDocumentView; },

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
  get scaleDisplayString(): string {
    return `${this.rootNoteName} ${this.scaleDisplayName}`;
  },
  get scaleMode() { return _scaleMode; },
  /** ADR-446: the last key detection, or null before the first. */
  get scaleDetected(): ScaleDetected | null { return _scaleDetected; },

  // SessionSettings runtime toggles
  get autoArmEnabled() { return _autoArmEnabled; },
  get moveVolumeKnobEnabled() { return _moveVolumeKnobEnabled; },
  get autoCaptureEnabled() { return _autoCaptureEnabled; },
  get keyFollowEnabled() { return _keyFollowEnabled; },
  get footSwitch(): FootSwitchState { return _footSwitch; },
  get clipTriggerQuantization() { return _clipTriggerQuantization; },

  // Groove state
  get selectedClipHasGroove() { return _selectedClipHasGroove; },
  get selectedClipGrooveBase() { return _selectedClipGrooveBase; },
  get selectedClipGrooveTiming() { return _selectedClipGrooveTiming; },
  get selectedClipGrooveQuantization() { return _selectedClipGrooveQuantization; },
  get selectedClipGrooveRandom() { return _selectedClipGrooveRandom; },

  // Whether a clip is currently selected (track with valid scene selection)
  get hasSelectedClip(): boolean {
    return _selectedTrackIndex >= 0 && _selectedSceneIndex >= 0;
  },

  // Computed properties
  get timeSignatureString(): string {
    return `${_timeSignature.numerator}/${_timeSignature.denominator}`;
  },
  get tempoString(): string {
    return `${_tempo.toFixed(1)} BPM`;
  },
  /**
   * Song position as Live's own transport readout: `bar.beat.sixteenth`,
   * all 1-based.
   *
   * The old form was `${bars}.${beats.toFixed(1)}` — which rendered as
   * three numbers by accident (`2.3.0`) where the last was a TENTH of a
   * beat dressed as Live's sixteenth. Fed by
   * `/looping/v3/session/song_time` (10 Hz off the surface's
   * `current_song_time` listener); before that channel existed nothing
   * moved this at all and the header showed a frozen `1.1.0`.
   */
  get currentTimeString(): string {
    const num = _timeSignature.numerator || 4;
    const t = Math.max(0, _currentTime);
    const bar = Math.floor(t / num) + 1;
    const beat = Math.floor(t % num) + 1;
    const sixteenth = Math.floor((t % 1) * 4) + 1;
    return `${bar}.${beat}.${sixteenth}`;
  },

  // Complete LiveSong object
  get liveSong(): LiveSong {
    return {
      tempo: _tempo,
      isPlaying: _isPlaying,
      isRecording: _isRecording,
      currentTime: _currentTime,
      loopStart: _loopStart,
      loopEnd: _loopEnd,
      timeSignature: _timeSignature,
      selectedTrackIndex: _selectedTrackIndex,
      selectedSceneIndex: _selectedSceneIndex,
      sessionRecord: _sessionRecord,
      arrangementOverdub: _arrangementOverdub,
      backToArranger: _backToArranger,
      metronome: _metronome,
      songLength: _songLength,
      groove: _groove
    };
  },

  // Store statistics
  get updateCount() { return _updateCount; },
  get errorCount() { return _errorCount; },
  get lastUpdateTime() { return _lastUpdateTime; },
  get connectionStatus() { return _connectionStatus; },
  get errorRate(): number {
    return _updateCount > 0 ? (_errorCount / _updateCount) : 0;
  },

  // Reset error count
  resetErrorCount() {
    logger.info('Resetting error count', { previousCount: _errorCount });
    _errorCount = 0;
  },

  // Optimistically update selected track index before the OSC round-trip
  // completes. Records a pending index so stale echoes from previous taps
  // are ignored — see _pendingTrackIndex above.
  selectTrackOptimistically(trackIndex: number) {
    if (_selectedTrackIndex === trackIndex) return;
    logger.debug('Track selection optimistic update', { from: _selectedTrackIndex, to: trackIndex });
    _selectedTrackIndex = trackIndex;
    _pendingTrackIndex = trackIndex;
    if (trackIndex === -1) {
      centralDisplayStore.setView('system');
    }
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
  },

  // Validation method
  validateSession(): { valid: boolean; errors: string[] } {
    return validateSession();
  },

  // Performance metrics
  getSessionMetrics() {
    return getSessionMetrics();
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

/**
 * Handle domain updates from AbletonOSC router
 * Type-safe discriminated union handling
 */
export function handleSessionUpdate(update: DomainUpdate): boolean {
  try {
    _updateCount++;
    _lastUpdateTime = update.timestamp;
    
    // Handle session-relevant updates
    switch (update.type) {
      case 'tempo':
        handleTempoUpdate(update);
        return true;

      case 'transport':
        handleTransportUpdate(update);
        return true;

      case 'session-record':
        handleSessionRecordUpdate(update);
        return true;

      case 'time-signature':
        handleTimeSignatureUpdate(update);
        return true;

      case 'current-time':
        handleCurrentTimeUpdate(update);
        return true;

      case 'loop':
        handleLoopUpdate(update);
        return true;

      case 'metronome':
        handleMetronomeUpdate(update);
        return true;

      case 'groove':
        handleGrooveUpdate(update);
        return true;

      case 'track-selection':
        handleTrackSelectionUpdate(update);
        return true;

      case 'scene-selection':
        handleSceneSelectionUpdate(update);
        return true;

      case 'focused-view':
        handleFocusedViewUpdate(update);
        return true;

      case 'connection':
        if (update.source === 'pythonSurface') {
          const previousStatus = _connectionStatus;
          _connectionStatus = update.status;
          // Only log connection errors or status changes from connected to disconnected
          if (update.status === 'error' || (previousStatus === 'connected' && update.status !== 'connected')) {
            logger.error('Python Surface connection lost', { status: update.status, previousStatus });
          }
        }
        return true;

      case 'error': {
        _errorCount++;

        const errorType = update.error || 'Unknown error';
        const grouped = _errorGrouper.recordError(errorType);

        if (grouped.isRepeat) {
          if (grouped.shouldLogRepeat) {
            logger.warn('Error repeated', { repeatCount: grouped.repeatCount, errorType });
          }
          return false;
        }

        const errorInfo = {
          count: _errorCount,
          error: errorType,
          message: update.error,
          failedOperation: (update as any).failedOperation,
          originalMessage: update.originalMessage,
          source: update.source,
          timestamp: new Date(update.timestamp).toLocaleTimeString()
        };

        if (update.error?.includes('Observer not connected')) {
          logger.error('Observer Not Connected', {
            ...errorInfo,
            action: 'To fix: Restart the AbletonOSC device in Ableton Live',
            details: 'The observer component is required for listener operations (start_listen/stop_listen)',
            lastOperation: errorInfo.failedOperation || errorInfo.originalMessage?.address
          });
        } else {
          logger.error('AbletonOSC Error', errorInfo);
        }
        return false;
      }

      default:
        // Not a session-relevant update
        return false;
    }
  } catch (error) {
    _errorCount++;
    logger.error('Failed to handle session update', { error, update });
    return false;
  }
}

// Individual update handlers with validation and logging

function handleTempoUpdate(update: TempoUpdate) {
  // Always accept the echo — it may carry Ableton's clamped/rounded value.
  // Just clear the pending flag so we stop suppressing future Ableton-
  // initiated changes (e.g. tempo automation, tap-tempo from hardware).
  _pendingTempo = null;
  const oldTempo = _tempo;
  _tempo = update.bpm;
  logger.debug('Tempo updated', { oldTempo: oldTempo.toFixed(1), newTempo: update.bpm.toFixed(1) });
}

function handleTransportUpdate(update: TransportUpdate) {
  if (_pendingIsPlaying !== null && update.isPlaying !== _pendingIsPlaying) {
    logger.debug('Transport echo dropped (stale)', { echo: update.isPlaying, pending: _pendingIsPlaying });
    // Clear the latch even though this echo is dropped. The latch exists to
    // swallow the ONE stale echo from a rapid A→B tap; it is not a filter
    // that should persist. Nothing else writes these back to null and there
    // is no timer, so a latch left set here is set forever — and the
    // confirming echo can legitimately never arrive, because the surface
    // emits only on an actual change (a write landing on the value Live is
    // already on produces no echo at all). One missed echo used to mean
    // every subsequent Live-initiated change was dropped here until a
    // reconnect. `_pendingTempo` has always done this correctly.
    _pendingIsPlaying = null;
    return;
  }
  _pendingIsPlaying = null;
  const oldPlaying = _isPlaying;
  _isPlaying = update.isPlaying;
  logger.debug('Transport updated', { oldState: oldPlaying ? 'Playing' : 'Stopped', newState: update.isPlaying ? 'Playing' : 'Stopped' });
}

function handleSessionRecordUpdate(update: SessionRecordUpdate) {
  const oldRecording = _sessionRecord;
  _sessionRecord = update.isRecording;
  logger.debug('Session Record updated', { oldState: oldRecording ? 'On' : 'Off', newState: update.isRecording ? 'On' : 'Off' });
}

function handleTimeSignatureUpdate(update: TimeSignatureUpdate) {
  const oldSig = _timeSignature;

  // Simply accept incoming values. AbletonOSC sends numerator and denominator
  // as separate messages, but each message contains valid values (with parser
  // defaults for the missing component). We just take what we're given.
  _timeSignature = {
    numerator: update.timeSignature.numerator,
    denominator: update.timeSignature.denominator
  };

  logger.debug('Time Signature updated', {
    oldSig: `${oldSig.numerator}/${oldSig.denominator}`,
    newSig: `${_timeSignature.numerator}/${_timeSignature.denominator}`
  });
}

function handleCurrentTimeUpdate(update: CurrentTimeUpdate) {
  _currentTime = update.beats;
  // Only log occasionally to avoid spam
  if (Math.floor(update.beats) % 4 === 0 && update.beats % 1 < 0.1) {
    logger.debug('Position updated', { beats: update.beats.toFixed(1) });
  }
}

function handleLoopUpdate(update: LoopUpdate) {
  _isLooping = update.isLooping;
  _loopStart = update.loopStart;
  _loopEnd = update.loopEnd;
  logger.debug('Loop updated', {
    enabled: update.isLooping,
    loopStart: update.loopStart.toFixed(1),
    loopEnd: update.loopEnd.toFixed(1)
  });
}

function handleMetronomeUpdate(update: MetronomeUpdate) {
  if (_pendingMetronome !== null && update.enabled !== _pendingMetronome) {
    logger.debug('Metronome echo dropped (stale)', { echo: update.enabled, pending: _pendingMetronome });
    // Same self-healing clear as the transport latch above.
    _pendingMetronome = null;
    return;
  }
  _pendingMetronome = null;
  const oldMetronome = _metronome;
  _metronome = update.enabled;
  logger.debug('Metronome updated', { oldState: oldMetronome ? 'On' : 'Off', newState: update.enabled ? 'On' : 'Off' });
}

function handleGrooveUpdate(update: GrooveUpdate) {
  const oldGroove = _groove;
  _groove = update.amount;
  logger.debug('Groove updated', {
    oldGroove: `${(oldGroove * 100).toFixed(0)}%`,
    newGroove: `${(update.amount * 100).toFixed(0)}%`
  });
}

function handleTrackSelectionUpdate(update: TrackSelectionUpdate) {
  // If we have an optimistic write in-flight, only apply an echo that
  // matches the latest pending index. An echo for an earlier tap (stale)
  // is dropped so rapid A→B sequences don't flash A's highlight.
  // An Ableton-initiated selection (no pending write) always applies.
  if (_pendingTrackIndex !== null && update.trackIndex !== _pendingTrackIndex) {
    logger.debug('Track selection echo dropped (stale)', {
      echo: update.trackIndex,
      pending: _pendingTrackIndex
    });
    // Same self-healing clear as the transport latch above.
    _pendingTrackIndex = null;
    return;
  }
  _pendingTrackIndex = null;

  const oldTrack = _selectedTrackIndex;
  _selectedTrackIndex = update.trackIndex;
  const oldType = oldTrack === -1 ? 'Master' : `Track ${oldTrack}`;
  const newType = update.trackIndex === -1 ? 'Master' : `Track ${update.trackIndex}`;
  logger.debug('Track Selection updated', { oldTrack, oldType, newTrack: update.trackIndex, newType });

  // ROW 13a (2026-04-21): the per-track-leave M4L refresh is gone.
  // `clipStateStore` $derives from v3Store.tracks; `ClipsComponent`
  // advances generation on clip create/delete, which publishes a
  // fresh state/full on the next tick — the active-filter visibility
  // stays current without a poll.

  // Master track: show system view
  // Regular tracks: view is handled by instrumentDisplayCoordinator.
  if (update.trackIndex === -1) {
    centralDisplayStore.setView('system');
  }

  // Arm-follows-selection is owned by Python ``ExclusiveArmComponent``
  // (surface-side LOM listener on ``song.view.selected_track``). The UI
  // used to mirror that logic here via ``updateTrackArming``, firing
  // N-1 disarms + one arm on every selection update, which (a) raced
  // with the surface component and (b) disarmed user-manually-armed
  // tracks, violating the "allow user override" requirement. Deleted
  // 2026-04-22 — surface is the single source of truth for arm-
  // follows-selection now. ``armTrackWithRetry`` still arms fresh
  // tracks at creation time via ``trackPreparation``.
}

function handleSceneSelectionUpdate(update: SceneSelectionUpdate) {
  const oldScene = _selectedSceneIndex;
  _selectedSceneIndex = update.sceneIndex;
  logger.debug('Scene Selection updated', { oldScene, newScene: update.sceneIndex });
}

function handleFocusedViewUpdate(update: FocusedViewUpdate) {
  const oldView = _focusedDocumentView;
  _focusedDocumentView = update.view;
  logger.debug('Focused View updated', { oldView: oldView || 'Unknown', newView: update.view });
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

  // ROW 6.9 (2026-04-21): _trackCount / _trackIndices are now $derived
  // from v3Store.tracks; nothing to reset here. v3Store resets itself
  // on handshake via replaceTree / resetTree.

  _focusedDocumentView = null;

  _updateCount = 0;
  _errorCount = 0;
  _lastUpdateTime = 0;
  _connectionStatus = 'disconnected';

  logger.info('Session data cleared - ready for AbletonOSC');
}

// Stub kept only to satisfy legacy vitest mocks
// (`v3SelectedTrack.test.ts`, `selectedTrackStore.trackSelected.test.ts`).
// No runtime caller — `/looping/tracks/count` handler was retired in
// ROW 6.9, and the track list is $derived from v3Store.tracks. Remove
// once the test mocks are cleaned up.
/** @deprecated ROW 6.9 — use v3Store.tracks for track count/indices */
export function handleTrackListUpdate(_trackCountArg: number): void {
  const elapsed = 0;
  logger.debug('handleTrackListUpdate is a no-op post-ROW-6.9', {
    elapsedMs: elapsed,
    previousCount: 0,
    newCount: _trackCountArg,
    previousIndices: '',
    newIndices: _trackIndices.join(', ')
  });
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
    const m = normalized.match(/^tracks\/(\d+)\/slots\/(\d+)\/clip$/);
    _cachedFocusedClipIndices = m
      ? { track: parseInt(m[1], 10), scene: parseInt(m[2], 10) }
      : null;
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

/**
 * The foot switch's state, from
 * `/looping/v3/session/foot_switch [enabled, channel, cc, mode, learn, heard]`.
 * Anything malformed is dropped whole rather than half-applied.
 */
export function handleFootSwitchUpdate(state: FootSwitchState | null): void {
  if (!state) return;
  _footSwitch = state;
  logger.info('SessionSettings: foot_switch', { ...state });
}

/**
 * Debug function for testing session updates
 */
export function debugSetTempo(bpm: number): void {
  if (bpm >= 20 && bpm <= 999) {
    _tempo = bpm;
    logger.debug('DEBUG: Tempo set', { bpm });
  } else {
    logger.error('DEBUG: Invalid tempo', { bpm, validRange: '20-999 BPM' });
  }
}

/**
 * Debug function for testing transport
 */
export function debugToggleTransport(): void {
  _isPlaying = !_isPlaying;
  logger.debug('DEBUG: Transport toggled', { state: _isPlaying ? 'started' : 'stopped' });
}

/**
 * Session store validation - checks for data consistency
 */
export function validateSession(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (_tempo < 20 || _tempo > 999) {
    errors.push(`Invalid tempo: ${_tempo} (must be 20-999 BPM)`);
  }

  if (_timeSignature.numerator < 1 || _timeSignature.numerator > 32) {
    errors.push(`Invalid time signature numerator: ${_timeSignature.numerator} (must be 1-32)`);
  }

  if (![1, 2, 4, 8, 16].includes(_timeSignature.denominator)) {
    errors.push(`Invalid time signature denominator: ${_timeSignature.denominator} (must be 1, 2, 4, 8, or 16)`);
  }

  if (_groove < 0 || _groove > 1) {
    errors.push(`Invalid groove amount: ${_groove} (must be 0.0-1.0)`);
  }

  if (_selectedTrackIndex < -1) {
    errors.push(`Invalid selected track index: ${_selectedTrackIndex} (must be >= -1)`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get session performance metrics
 */
export function getSessionMetrics(): {
  updatesPerSecond: number;
  errorRate: number;
  uptime: number;
  connectionStatus: string;
} {
  const now = Date.now();
  const uptime = _lastUpdateTime > 0 ? (now - _lastUpdateTime) / 1000 : 0;
  const updatesPerSecond = uptime > 0 ? _updateCount / uptime : 0;

  return {
    updatesPerSecond: Number(updatesPerSecond.toFixed(2)),
    errorRate: Number((session.errorRate * 100).toFixed(1)),
    uptime: Number(uptime.toFixed(1)),
    connectionStatus: _connectionStatus
  };
}