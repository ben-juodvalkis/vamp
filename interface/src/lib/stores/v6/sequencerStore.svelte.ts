/**
 * Sequencer Store — Phase 10 PR-10c: derived from v3Store.
 *
 * Permute exposes its pattern controls on the standard `Device.parameters`
 * wire. This store reads them out of `v3Store.paramByPath` for the
 * selected track's Permute device and writes via `/looping/v3/param/set`
 * — the same path every other device uses. The v5-era broadcast cache,
 * origin tagging, and echo filtering are gone: LOM owns the state,
 * listeners fire on every change (surface write, Max UI click, or Live
 * automation), and the UI converges automatically.
 *
 * Parameters are addressed by ROLE and resolved by NAME (permute ADR-020,
 * `$lib/config/permuteLayout`): `Mute 1 … Mute 16`, `Mute Length`,
 * `Mute Rate`, `Pitch 1 … Pitch 16`, `Pitch Length`, `Pitch Rate`,
 * `Chance`, `Temperature`. The positional table in that module is only
 * the fallback for records that carry no names, so a re-ordered device
 * cannot shift a step onto the wrong control again.
 *
 * Step position is telemetry (`/looping/v3/permute/step`, see
 * stores/v3/permuteSteps.svelte.ts), never a parameter read.
 *
 * Ghost editing (steps edited before a device is loaded onto the
 * track) is still supported: edits accumulate in a local map keyed by
 * role, a `/looping/v3/device/load` is fired on first edit, and when
 * the Permute device appears in `v3Store`, the pending edits flush
 * through as individual `/looping/v3/param/set` writes against the
 * loaded device's resolved layout.
 *
 * A PAD's Permute (ADR-435, 2026-09-14). While a pad is held or latched
 * on the selected track's Drum Rack (`activeDrumRackScope`), the store is
 * that pad's Permute — the one inside its chain, found by class and name
 * through the pad's map — and the ghost is the pad without one: the first
 * edit loads a Permute INTO the pad (`device/load` with the pad path),
 * the pending edits are keyed by the pad path so a track's ghost edits and
 * a pad's never mix, and every read and write is the same param wire on a
 * pad-shaped path. The surface's engine then drives that pad alone. Lift
 * the finger and the store is the track's again. Temperature is inert on
 * a pad (`temperatureInert`): a pitch swap among one pitch does nothing.
 */

import { SvelteMap } from 'svelte/reactivity';
import { selectedTrackStore } from './selectedTrackStore.svelte';
import { activeDrumRackScope } from '$lib/services/deviceViewRouter.svelte';
import type { FxScope } from '$lib/components/v6/central/fxScope';
import { parsePadPath } from '$lib/utils/padPaths';
import { session } from '../session.svelte';
import { send } from '$lib/api/simpleClient';
import { DEVICE_PRESETS, deviceLoadArgs } from '$lib/config/devicePresets';
import {
  MUTE_STEP_ROLES,
  PERMUTE_PARAM_DEFAULTS,
  PERMUTE_ROLES,
  PITCH_STEP_ROLES,
  findPermute,
  positionalPermuteLayout,
  resolvePermuteLayout
} from '$lib/config/permuteLayout';
import type { PermuteLayout, PermuteRole } from '$lib/config/permuteLayout';
import { v3Store, UNSET_GENERATION, applyParamValue } from '$lib/stores/v3/normalized.svelte';
import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';
import { permuteStepStore } from '$lib/stores/v3/permuteSteps.svelte';
import { logger } from '$lib/utils/logger';

// Division options — unchanged since v5; enum index order matches
// Permute's ENUM_RATES (longest → shortest), the same order the
// surface's sequencer engine uses.
export const DIVISION_OPTIONS = [
  { label: '8 bars', value: 8, mode: 'bars' as const, division: [8, 0, 0] },
  { label: '4 bars', value: 4, mode: 'bars' as const, division: [4, 0, 0] },
  { label: '2 bars', value: 2, mode: 'bars' as const, division: [2, 0, 0] },
  { label: '1 bar', value: 1, mode: 'bars' as const, division: [1, 0, 0] },
  { label: '1/2', value: 8, mode: '16ths' as const, division: [0, 2, 0] },
  { label: '1/4', value: 4, mode: '16ths' as const, division: [0, 1, 0] },
  { label: '1/8', value: 2, mode: '16ths' as const, division: [0, 0, 240] },
  { label: '1/16', value: 1, mode: '16ths' as const, division: [0, 0, 120] }
];

/**
 * Kept as an exported constant only so any legacy test still importing
 * it continues to type-check. The post-push grace period it gated no
 * longer exists — LOM is the single source of truth.
 */
export const PUSH_STATE_GRACE_MS = 200;

// ============================================================
// Helpers
// ============================================================

function readRole(layout: PermuteLayout | undefined, role: PermuteRole): number | undefined {
  if (!layout) return undefined;
  return v3Store.paramByPath.get(layout.paths[role])?.value;
}

function writeRole(layout: PermuteLayout, role: PermuteRole, value: number): void {
  if (v3Store.generation === UNSET_GENERATION) {
    logger.warn('Sequencer writeRole blocked: generation unset', {
      devicePath: layout.devicePath,
      role,
      value
    });
    return;
  }
  const paramPath = layout.paths[role];
  // Optimistic local write — mirrors the selectedTrackStore.setParamValue
  // pattern (ADR-001 + ADR-002). The Python surface suppresses the first
  // echo after a UI-driven write (one-shot in MutationComponent); without
  // this line the store stays at the pre-write value and no $derived
  // consumer updates.
  applyParamValue(paramPath, value);
  send('/looping/v3/param/set', [paramPath, value, v3Store.generation]);
}

/**
 * Reset a Permute device's pattern params to the device defaults by
 * devicePath. Unlike the private `writeRole`, this targets an arbitrary
 * (likely non-selected) track's device — used by the duplicate-track
 * flow, which resets the copied Permute on the new track. Resolves the
 * layout by name from the device's records in the store; a device the
 * store hasn't seen yet falls back to the positional table. Preserves
 * writeRole's generation guard and optimistic-write posture.
 */
export function resetParamsToDefaultsForDevice(devicePath: string): void {
  if (v3Store.generation === UNSET_GENERATION) {
    logger.warn('resetParamsToDefaultsForDevice blocked: generation unset', {
      devicePath
    });
    return;
  }
  const record = v3Store.deviceByPath.get(devicePath);
  const layout = record ? resolvePermuteLayout(record) : positionalPermuteLayout(devicePath);
  for (const role of PERMUTE_ROLES) {
    const paramPath = layout.paths[role];
    const value = PERMUTE_PARAM_DEFAULTS[role];
    applyParamValue(paramPath, value);
    send('/looping/v3/param/set', [paramPath, value, v3Store.generation]);
  }
}

// ============================================================
// Ghost-mode pending edits
// ============================================================
//
// Until a Permute device exists on the selected track, the user's
// step toggles / length / rate / temperature / chance changes live
// here, keyed by role. `flushPending` runs when the Permute device
// appears and replays each edit through the standard v3 param wire
// against the loaded device's resolved layout.

type PendingEdits = Map<PermuteRole, number>;

/** Scope key (a track path, or a pad path under ADR-435) → pending edits keyed by role. */
//
// `SvelteMap`, not `$state(new Map())`. The re-set below carried a comment
// claiming it made "SvelteMap fire derived consumers", but this was a plain
// Map: `$state` deep-proxies plain objects and arrays only, so it was handed
// back raw and neither the inner `.set()` nor the re-set signalled anything.
const pending = new SvelteMap<string, PendingEdits>();

function setPending(key: string, role: PermuteRole, value: number): void {
  // New inner Map, then re-insert. Mutating the held one signals nothing,
  // and re-setting the same reference is not guaranteed to either — the
  // reference has to change for the entry to read as new.
  const next = new Map(pending.get(key) ?? []);
  next.set(role, value);
  pending.set(key, next);
}

function readPending(key: string, role: PermuteRole): number | undefined {
  return pending.get(key)?.get(role);
}

function clearPending(key: string): void {
  pending.delete(key);
}

function flushPending(layout: PermuteLayout, key: string): void {
  const edits = pending.get(key);
  if (!edits || edits.size === 0) return;
  logger.info('Sequencer: flushing ghost edits to loaded device', {
    devicePath: layout.devicePath,
    count: edits.size
  });
  for (const [role, value] of edits) {
    writeRole(layout, role, value);
  }
  clearPending(key);
}

/** The pending-edit key a device path belongs to: its pad path, else its track path. */
function pendingKeyFor(devicePath: string): string | null {
  const pad = parsePadPath(devicePath);
  if (pad) return pad.padPath;
  const trackPath = devicePath.split('/devices/')[0];
  return trackPath || null;
}

/** The key the CURRENT scope's ghost edits go under: the scoped pad's path, else the selected track's. */
function currentPendingKey(): string | null {
  const trackPath = selectedTrackStore.selectedTrackPath;
  if (!trackPath) return null;
  return scope ? scope.padPath : trackPath;
}

// ============================================================
// Device-load lifecycle
// ============================================================

let isLoading = $state(false);
let loadingInitiated = $state(false);
let lastLoadedDevicePath: string | null = null;
let loadTimeout: ReturnType<typeof setTimeout> | null = null;

function triggerLoad() {
  if (isLoading || loadingInitiated) return;
  const trackPath = selectedTrackStore.selectedTrackPath;
  if (!trackPath) return;
  loadingInitiated = true;
  isLoading = true;
  // Under a pad scope the Permute goes INTO the pad's chain (ADR-435):
  // the surface places a non-native preset through the browser and moves
  // it after the pad's instrument.
  send('/looping/v3/device/load', deviceLoadArgs(trackPath, scope?.padPath ?? '', DEVICE_PRESETS.sequencer));
  if (loadTimeout) clearTimeout(loadTimeout);
  loadTimeout = setTimeout(() => {
    if (isLoading) {
      logger.warn('Sequencer device load timed out after 10s', {
        presetPath: DEVICE_PRESETS.sequencer.presetPath
      });
      isLoading = false;
      loadingInitiated = false;
    }
    loadTimeout = null;
  }, 10000);
}

/**
 * Called by the sequencer components' $effect when `device` transitions
 * from undefined → defined. Flushes pending ghost edits through the v3
 * param wire, then drops the loading flag.
 */
function onDeviceLoaded(loadedDevice: { devicePath?: string } | DeviceRecord): void {
  const devicePath = (loadedDevice as DeviceRecord).devicePath;
  if (!devicePath) return;
  if (devicePath === lastLoadedDevicePath) return;
  lastLoadedDevicePath = devicePath;

  if (loadTimeout) {
    clearTimeout(loadTimeout);
    loadTimeout = null;
  }
  isLoading = false;
  loadingInitiated = false;

  // The edits queued for THIS device's scope — its pad, else its track
  // (ADR-435): a pad's ghost load never flushes the track's edits.
  const key = pendingKeyFor(devicePath);
  if (key) {
    const record = loadedDevice as DeviceRecord;
    const layout = record.params
      ? resolvePermuteLayout(record)
      : positionalPermuteLayout(devicePath);
    flushPending(layout, key);
  }
}

function resetToGhost() {
  isLoading = false;
  loadingInitiated = false;
  lastLoadedDevicePath = null;
  if (loadTimeout) {
    clearTimeout(loadTimeout);
    loadTimeout = null;
  }
}

// ============================================================
// Rate enum helpers — legacy division format kept for
// backwards-compatibility at the UI layer (DIVISION_OPTIONS shape).
// ============================================================

/** Find a rate enum index (0..7) by division tuple. Used by any caller
 *  that still speaks the legacy `[bars, beats, ticks]` shape. */
export function divisionToRateIndex(division: [number, number, number]): number {
  const [bars, beats, ticks] = division;
  for (let i = 0; i < DIVISION_OPTIONS.length; i++) {
    const opt = DIVISION_OPTIONS[i].division;
    if (opt[0] === bars && opt[1] === beats && opt[2] === ticks) return i;
  }
  return 3;
}

// ============================================================
// Derived state — selected track's sequencer
// ============================================================

// ADR-435 (2026-09-14): while a pad is scoped on the selected track's
// Drum Rack, the store is THAT PAD's Permute — the one in its chain, by
// class and name, through the pad's map (its records, or presence
// stand-ins before the bundle lands) — and the ghost is the pad without
// one. Nothing scoped, and it is the track's Permute as it always was.
let scope = $derived<FxScope | null>(activeDrumRackScope());
let device = $derived.by<DeviceRecord | undefined>(() =>
  scope ? findPermute(selectedTrackStore.padDevices(scope.padPath)) : selectedTrackStore.sequencerByPath
);
let isGhost = $derived(!device);
// Role → paramPath, by name with positional fallback. Re-resolves when the
// device's record set changes (a load, a structural republish).
let layout = $derived<PermuteLayout | undefined>(device ? resolvePermuteLayout(device) : undefined);

function readStep(role: PermuteRole): boolean {
  if (layout) {
    const v = readRole(layout, role);
    // A record the store holds by presence alone (a pad's stand-in before
    // its bundle lands) carries no values: the device's defaults, never
    // "every step off".
    return v === undefined ? PERMUTE_PARAM_DEFAULTS[role] === 1 : v === 1;
  }
  const key = currentPendingKey();
  if (!key) return false;
  const pendingVal = readPending(key, role);
  if (pendingVal !== undefined) return pendingVal === 1;
  // Ghost defaults: mute steps all ON, pitch steps all OFF — the device's
  // own defaults.
  return PERMUTE_PARAM_DEFAULTS[role] === 1;
}

function readScalar(role: PermuteRole, ghostDefault: number): number {
  if (layout) {
    const v = readRole(layout, role);
    return v ?? ghostDefault;
  }
  const key = currentPendingKey();
  if (!key) return ghostDefault;
  return readPending(key, role) ?? ghostDefault;
}

let muteSteps = $derived.by<boolean[]>(() => MUTE_STEP_ROLES.map((r) => readStep(r)));
let pitchSteps = $derived.by<boolean[]>(() => PITCH_STEP_ROLES.map((r) => readStep(r)));

let muteLength = $derived(readScalar('muteLength', PERMUTE_PARAM_DEFAULTS.muteLength));
let pitchLength = $derived(readScalar('pitchLength', PERMUTE_PARAM_DEFAULTS.pitchLength));
let muteRate = $derived(readScalar('muteRate', PERMUTE_PARAM_DEFAULTS.muteRate));
let pitchRate = $derived(readScalar('pitchRate', PERMUTE_PARAM_DEFAULTS.pitchRate));
let temperature = $derived(readScalar('temperature', PERMUTE_PARAM_DEFAULTS.temperature));
let chance = $derived(readScalar('chance', PERMUTE_PARAM_DEFAULTS.chance));

// Step position rides the telemetry wire (0-indexed, -1 = idle) — already
// the domain these expose, so no transform. See permuteSteps.svelte.ts.
let muteCurrentStep = $derived.by<number>(() =>
  device ? permuteStepStore.get(device.devicePath).mute : -1
);
let pitchCurrentStep = $derived.by<number>(() =>
  device ? permuteStepStore.get(device.devicePath).pitch : -1
);

// "Enabled" semantics preserved from v6.0: non-default pattern = active.
// Only the steps inside the length play: a muted step 12 under the default
// length 8 does nothing, so it must not wake the row (ADR-443).
let muteEnabled = $derived(muteSteps.slice(0, muteLength).some((s) => !s));
let pitchEnabled = $derived(pitchSteps.slice(0, pitchLength).some((s) => s));

let isPlaying = $derived(session.isPlaying);
let color = $derived(DEVICE_PRESETS.sequencer?.color ?? DEVICE_PRESETS.utility.color);

// ============================================================
// Write handlers — active device vs. ghost (pending + load)
// ============================================================
//
// Each handler is one of two shapes, factored into a pair of private
// helpers so the per-param functions stay one-liners (and individually
// greppable / exported):
//   - writeActive: write straight to the live device param (no-op if none).
//   - writePending: stash a pending edit keyed by track path and kick a
//     ghost device load. The component picks active vs. ghost via isGhost.

function writeActive(role: PermuteRole, value: number) {
  if (!layout) return;
  writeRole(layout, role, value);
}

function writePending(role: PermuteRole, value: number) {
  const key = currentPendingKey();
  if (!key) return;
  setPending(key, role, value);
  triggerLoad();
}

// --- Active-device handlers ---
function handleMuteStepSet(stepIndex: number, value: boolean) {
  writeActive(MUTE_STEP_ROLES[stepIndex], value ? 1 : 0);
}
function handleMuteStepToggle(stepIndex: number) {
  handleMuteStepSet(stepIndex, !muteSteps[stepIndex]);
}
function handleMuteLengthChange(length: number) {
  writeActive('muteLength', length);
}
function handleMuteRateChange(rateIndex: number) {
  writeActive('muteRate', rateIndex);
}
function handlePitchStepSet(stepIndex: number, value: boolean) {
  writeActive(PITCH_STEP_ROLES[stepIndex], value ? 1 : 0);
}
function handlePitchStepToggle(stepIndex: number) {
  handlePitchStepSet(stepIndex, !pitchSteps[stepIndex]);
}
function handlePitchLengthChange(length: number) {
  writeActive('pitchLength', length);
}
function handlePitchRateChange(rateIndex: number) {
  writeActive('pitchRate', rateIndex);
}
function handleTemperatureChange(value: number) {
  writeActive('temperature', value);
}
function handleChanceChange(value: number) {
  writeActive('chance', value);
}

// --- Ghost handlers (accumulate pending edits + trigger device load) ---
function handleMuteStepSetGhost(stepIndex: number, value: boolean) {
  writePending(MUTE_STEP_ROLES[stepIndex], value ? 1 : 0);
}
function handleMuteStepToggleGhost(stepIndex: number) {
  handleMuteStepSetGhost(stepIndex, !muteSteps[stepIndex]);
}
function handleMuteLengthChangeGhost(length: number) {
  writePending('muteLength', length);
}
function handleMuteRateChangeGhost(rateIndex: number) {
  writePending('muteRate', rateIndex);
}
function handlePitchStepSetGhost(stepIndex: number, value: boolean) {
  writePending(PITCH_STEP_ROLES[stepIndex], value ? 1 : 0);
}
function handlePitchStepToggleGhost(stepIndex: number) {
  handlePitchStepSetGhost(stepIndex, !pitchSteps[stepIndex]);
}
function handlePitchLengthChangeGhost(length: number) {
  writePending('pitchLength', length);
}
function handlePitchRateChangeGhost(rateIndex: number) {
  writePending('pitchRate', rateIndex);
}
function handleTemperatureChangeGhost(value: number) {
  writePending('temperature', value);
}
function handleChanceChangeGhost(value: number) {
  writePending('chance', value);
}

// ============================================================
// Track-change + cache cleanup stubs (kept for API compatibility)
// ============================================================

function onTrackChanged(_newTrackIndex: number) {
  // v3Store and $derived handle the visible state flip automatically.
  // We only need to clear loading flags so a stale load on a different
  // track doesn't carry over.
  resetToGhost();
}

function clearCachedState(trackIndex: number) {
  // Pending ghost edits are keyed by track path — or by a pad path under
  // it (ADR-435); every key of the track goes.
  const trackPath = `tracks/${trackIndex}`;
  for (const key of [...pending.keys()]) {
    if (key === trackPath || key.startsWith(`${trackPath}/`)) clearPending(key);
  }
}

// ============================================================
// Export
// ============================================================

export const sequencerStore = {
  // Derived state (unchanged shape)
  get muteSteps() { return muteSteps; },
  get pitchSteps() { return pitchSteps; },
  get muteLength() { return muteLength; },
  get pitchLength() { return pitchLength; },
  get muteRate() { return muteRate; },
  get pitchRate() { return pitchRate; },
  get muteCurrentStep() { return muteCurrentStep; },
  get pitchCurrentStep() { return pitchCurrentStep; },
  get muteEnabled() { return muteEnabled; },
  get pitchEnabled() { return pitchEnabled; },
  get temperature() { return temperature; },
  get chance() { return chance; },
  get device() { return device; },
  /** The pad the store is scoped to (ADR-435), or null for the track's Permute. */
  get scope() { return scope; },
  /** Temperature does nothing on a pad's Permute: one pitch has nothing to swap (ADR-435). */
  get temperatureInert() { return scope !== null; },
  /** Role → paramPath for the scoped device (undefined in ghost mode). */
  get layout() { return layout; },
  get isGhost() { return isGhost; },
  get isLoading() { return isLoading; },
  get isPlaying() { return isPlaying; },
  get color() { return color; },

  // Lifecycle
  triggerLoad,
  onDeviceLoaded,
  onTrackChanged,
  clearCachedState,
  resetToGhost,

  // Active-device handlers
  handleMuteStepToggle,
  handleMuteStepSet,
  handleMuteLengthChange,
  handleMuteRateChange,
  handlePitchStepToggle,
  handlePitchStepSet,
  handlePitchLengthChange,
  handlePitchRateChange,
  handleTemperatureChange,
  handleChanceChange,

  // Ghost handlers
  handleMuteStepToggleGhost,
  handleMuteStepSetGhost,
  handleMuteLengthChangeGhost,
  handleMuteRateChangeGhost,
  handlePitchStepToggleGhost,
  handlePitchStepSetGhost,
  handlePitchLengthChangeGhost,
  handlePitchRateChangeGhost,
  handleTemperatureChangeGhost,
  handleChanceChangeGhost
};
