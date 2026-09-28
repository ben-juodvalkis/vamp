/**
 * V3 Normalized Store — Phase 2 PR-2a.
 *
 * Single source of truth for the v3 LOM tree, per
 * [03 §5](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/03-target-architecture.md#5-the-normalized-ui-store).
 * The v2 era's four-cache tangle (`deviceParameterStorage.paramIds`,
 * `selectedTrackStore` internals, `allTracksDeviceCache`,
 * `parameterNames`/`_properties`) collapses into one
 * `$state` tree keyed by path string. Every incoming v3 wire event
 * mutates this tree directly; derived views are `$derived` off it.
 *
 * ## Identity model
 *
 * Keys are full canonical paths — the same strings that ride the wire
 * per [04 §2](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#2-path-grammar):
 *
 * - trackPath: `tracks/0`, `master`, `returns/0`
 * - devicePath: `<trackPath>/devices/<N>`
 * - paramPath:  `<devicePath>/params/<N>`
 * - slotPath:   `tracks/<N>/slots/<N>`
 * - clipPath:   `<slotPath>/clip`
 *
 * Maps (not arrays) so invalidation of a subtree drops entries by key
 * without shifting indices, and lookup by path is O(1).
 *
 * ## Generation
 *
 * Surface holds authoritative `generation:int32`. This store holds a
 * mirror copy, updated by `state/full/tree` and `state/invalidate`.
 * Every outbound `/looping/v3/param/set` (Phase 2 PR-2b) reads
 * `v3Store.generation` to build its args. `UNSET_GENERATION = 0` is
 * the "we've never seen a state/full" sentinel — matches Python side.
 *
 * ## Session
 *
 * `sessionId` is minted by the surface at handshake. Stored here for
 * log correlation; not load-bearing for correctness.
 *
 * ## Scope
 *
 * PR-2a scope: store + handlers only, no component wiring, no flag,
 * no simpleClient dispatch. Tests drive the handlers directly.
 *
 * @see Looping's documentation/archive/m4l-to-python-v3/03-target-architecture.md §5
 * @see Looping's documentation/archive/m4l-to-python-v3/04-wire-protocol.md §5
 */

import { SvelteMap } from 'svelte/reactivity';
import { parsePadPath } from '$lib/utils/padPaths';
import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import { reconcileEcho, resetParamArming } from './paramArming.svelte';
import { clearHeldEtags } from '$lib/api/handlers/stateFullEtagStore';

// ============================================
// Constants
// ============================================

/** Matches Python `GenerationComponent.UNSET_GENERATION`. */
export const UNSET_GENERATION = 0;

/** Matches Python `GenerationComponent.INITIAL_GENERATION`. */
export const INITIAL_GENERATION = 1;

// ============================================
// Record types — mirror the v3 state/full T/D/P/V/S/C records
// per [04 §5](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#5-state-full-tree-args-layout).
// ============================================

export interface TrackRecord {
	trackPath: string;
	name: string;
	color: number;
	mute: boolean;
	solo: boolean;
	arm: boolean;
	/** PR-3.5.3 (2026-04-16) — track-input capability flags from
	 * `Live.Track.Track.has_midi_input` / `.has_audio_input`. Both can
	 * be true on the same track (External Instrument). Master tracks
	 * have neither. UI consumers that need a single
	 * `'midi' | 'audio' | null` classification (see
	 * `selectedTrackStore.trackType`) should treat `hasMidiInput` as
	 * the dominant flag — that matches v2 semantics for view routing
	 * (a track that can host an instrument is MIDI). Per [04 §5.1]
	 * doctrine, these are stable-per-track capability flags and belong
	 * on the `T` record, not derived from the device list. */
	hasMidiInput: boolean;
	hasAudioInput: boolean;
	/** PR-7c pr7c-5 (2026-04-19) — "does this regular track have any
	 * clips in the arrangement view?" Read-only LOM observer on
	 * `track.arrangement_clips` drives it: (1) cold-start carries the
	 * value in the T-record (arity 9 offset 8, shipped pr7c-3); (2)
	 * subsequent add/remove listener fires arrive at
	 * `/looping/v3/track/has_arrangement_clips [trackPath, flag]` and
	 * write through `applyHasArrangementClips`. Master / `returns/*`
	 * emit literal 0 on the wire for uniform parser arity — treat those
	 * as "no arrangement concept" rather than a meaningful false.
	 * Replaces the M4L `queryTrackSummaries` / `hasArrangement` round-
	 * trip that `clipStateStore` used to own; the 9 consumer-site
	 * migration lands in pr7c-6, deletion of the legacy path in pr7c-7. */
	hasArrangementClips: boolean;
	/** PR-5d-first (2026-04-17 night) — mutable metadata attrs owned by
	 * `TrackMetadataComponent` on the Python surface. Populated by
	 * `/looping/v3/track/<attr>` listener fires into
	 * `applyTrackMetadata`; absent from the state/full T record by
	 * design (spec carries only stable-per-track fields on T). Fields
	 * are optional because the first state/full `accept` bundle lands
	 * before any listener fires, so these are undefined until the
	 * surface emits its initial listener callback. Consumers must
	 * treat undefined as "not known yet" and fall back to a UI
	 * default. */
	panning?: number;
	inputRoutingType?: string;
	inputRoutingChannel?: string;
	/** Volume scalar. ROW 6.5 (2026-04-21): now carried on the T-record
	 * (arity 10, offset 9) for cold-start + state/full bundles; listener
	 * fires on both the master wire (`/looping/v3/master/volume` →
	 * `applyMasterMetadata`) and the regular-track wire
	 * (`/looping/v3/track/volume` → `applyTrackMetadata`) keep it fresh
	 * post-mount. Both listen on `mixer_device.volume`'s DeviceParameter
	 * on the Python surface. Remains optional because `applyTrackMetadata`
	 * writes it unconditionally and some synthetic paths (tests) may
	 * bypass T-record emission; consumers should treat undefined as "not
	 * known yet" and fall back to a UI default. */
	volume?: number;
	/** ADR-410 (2026-07-27) — Group Track structure, carried on the T
	 * record (arity 13, offsets 10/11/12).
	 *
	 * `isFoldable` is Live's `Track.is_foldable`: true exactly for
	 * Group Tracks. `foldState` is `Track.fold_state` — true when the
	 * group is collapsed and Live hides its children. `groupTrackIndex`
	 * is the LOM index of the parent group, or -1 at top level.
	 *
	 * Visibility is NOT carried on the wire: a track is hidden when
	 * *any* ancestor group is folded, which nested groups make an
	 * upward walk. `$lib/utils/trackGroups` owns that math so one
	 * fold echo updates every descendant without a state/full
	 * republish. Live's LOM does expose `Track.is_visible`, but it has
	 * no listener (verified 12.4.5b8) — deriving from the tree is what
	 * makes the incremental `/looping/v3/track/fold_state` wire work.
	 *
	 * Non-optional: every T record carries them, and master / returns
	 * emit (false, false, -1). */
	isFoldable: boolean;
	foldState: boolean;
	groupTrackIndex: number;
	/** Protocol 3.7.0 — the rail this track's instrument was loaded
	 * from (`drum`, `perc`, `bass`, …), or `''` when none was ever
	 * recorded.
	 *
	 * Unlike every other T field this is not a projection of a LOM
	 * *attribute*: it is a value this app wrote into Live's per-track
	 * key-value store and is reading back. It exists because the role
	 * was otherwise re-derived every session from a 2.46 MB catalog
	 * fetch plus a three-tier guess, for a Drum Buss rail that has since
	 * gone (ADR-431). Its one reader now is the strip's device band
	 * (`useTrackDevice`), as the fallback when a track records no preset.
	 *
	 * Non-optional but frequently empty: every track made before 3.7.0,
	 * and every track made outside this app, carries `''`. */
	role: string;
	/** Protocol 3.9.0 (ADR-439) — the preset this track's instrument was
	 * last loaded from through `prepare_for_preset` (its absolute path, the
	 * catalog's `fullPath`), or `''` when none was recorded or the track's
	 * instrument is no longer the one that load left (Live's undo, a
	 * hot-swap — the surface checks the instrument's class and name). Read
	 * back from Live's per-track store (`looping.preset`); the instrument
	 * views' swap control steps from it and is disabled without one.
	 *
	 * The parser always sets it. Optional in the type only because dozens of
	 * hand-built test fixtures predate it — the same fixtures whose missing
	 * `role` is baselined in the type ratchet — so read it as
	 * `track.preset ?? ''`. */
	preset?: string;
	/** Devices on this track, keyed by devicePath. Iteration order is
	 * insertion order, which is LOM position order because state/full
	 * emits records depth-first in position order. */
	devices: Map<string, DeviceRecord>;
	/** Slots on this track, keyed by slotPath. */
	slots: Map<string, SlotRecord>;
}

export interface DeviceRecord {
	devicePath: string;
	name: string;
	className: string;
	// ROW 5 (2026-04-21, protocol 3.3.0): `legacyId?: number`
	// deleted. The M4L-served
	// `/looping/device/{select,move_appointed_*}` senders that
	// needed the 31-bit `_live_ptr` retired; the path-addressed v3
	// `/looping/v3/device/{select,move_to_*}` wires on
	// DeviceCommandsComponent use `devicePath` directly.
	/** Parameters on this device, keyed by paramPath. */
	params: Map<string, ParamRecord>;
	/** PR-3.5.7 — LiveAPI device properties (Simpler `sample.*` /
	 * `playback_mode`, Drift `voice_mode_index`), keyed by the wire
	 * propertyName. Populated by the v3Property handler in response to
	 * `/looping/v3/property/value` events; subscriptions are reference-
	 * counted by `propertySubscriptionManager`. SvelteMap so per-property
	 * `.set()` fires `$derived` consumers. Per ADR-002 properties don't
	 * advance generation; the leaf is retained across structural changes
	 * until the device record itself goes away. */
	properties: Map<string, OSCArg>;
}

export interface ParamRecord {
	paramPath: string;
	name: string;
	displayName: string;
	min: number;
	max: number;
	value: number;
	unit: string;
	/** Live's GUI-formatted value string ("440 Hz", "-12.0 dB", "1/4",
	 *  "On") delivered via `/looping/v3/param/display`. Optional —
	 *  populated only after the surface emits at least one display fire
	 *  for this path, which only happens while the path is "hot" (recent
	 *  `param/set` traffic). External changes (automation, MIDI) won't
	 *  populate it; UI consumers should fall back to formatting `value`
	 *  + `unit` when undefined. */
	displayValue?: string;
}

export type SlotState = 'empty' | 'has_clip' | 'playing' | 'recording';

export interface SlotRecord {
	slotPath: string;
	state: SlotState;
	/** At most one clip per slot (uniqueness is structural per [00]
	 * glossary). */
	clip?: ClipRecord;
}

export interface ClipRecord {
	clipPath: string;
	name: string;
	length: number;
	color: number;
	pitch: number;
	/** Free-form clip properties set by `/looping/v3/clip/property`.
	 * Typed as OSCArg because property values carry whatever OSC type
	 * Live reports (float/int/string). */
	properties: Map<string, OSCArg>;
}

// ============================================
// Module-local reactive state
// ============================================

/** Authoritative-per-surface generation the UI has seen. Starts unset;
 *  first state/full/tree or handshake/accept moves it to the
 *  surface's current value. */
let generation = $state(UNSET_GENERATION);

/** Session id minted by surface at handshake. Empty until accept. */
let sessionId = $state('');

/** Per-surface-lifetime instance id advertised by the Python surface
 *  via `/looping/v3/surface/hello` (see [04 §8.6]). Empty until the
 *  first `surface/hello` lands. Used by the surface-hello handler to
 *  detect surface restart (instanceId drift between emissions) and
 *  trigger a re-handshake. Distinct from `sessionId`, which is
 *  per-handshake — one surface instance can mint multiple sessions
 *  (e.g. across UI reconnects), but its instanceId is fixed for its
 *  lifetime. */
let surfaceInstanceId = $state('');

/** Tracks by trackPath. Insertion order = LOM position order (master
 *  first when present, then tracks/0, tracks/1, …, then returns/0,
 *  returns/1, …) — the state/full emitter guarantees this ordering.
 *
 *  ADR-002 (2026-04-16): `SvelteMap` not plain `Map`. The previous shape
 *  (`$state(new Map())`) only fired reactivity on *reassignment* of the
 *  root binding — nested mutations like `device.params.get(path).value
 *  = x` silently bypassed the reactive graph because `$state` stops
 *  proxifying at class instances (Map is a class). `SvelteMap` is
 *  explicitly reactive on `.set()`/`.delete()`/iteration, so any
 *  mutation through the tree fires `$derived` consumers. The
 *  `$state(...)` wrapper is kept so reassignments in `replaceTree` /
 *  `resetTree` / `resetForSurfaceRestart` also fire. See ADR-002 in
 *  Looping's `documentation/archive/m4l-to-python-v3/`. */
let tracks = $state<Map<string, TrackRecord>>(new SvelteMap());

/** The devices inside drum pad chains (issue #491, protocol 3.8.0), keyed
 *  by pad path (`tracks/2/devices/0/pads/38`) and then by device path
 *  (`…/pads/38/devices/1`). A SEPARATE map, never the track's `devices`:
 *  every consumer of a track's device list — the FX-grid slot matcher, the
 *  instrument finder, the views that index by chain position — takes
 *  `devicesByPath[N]` to be the device at chain index N, and a pad
 *  Reverb inserted there would be matched as the track's or would shift
 *  an index. Filled only by pad-scoped `state/full/tree` bundles
 *  (reason `pad-chain`), which a client receives only for pads it has
 *  subscribed; the whole-song tree stays exactly 3.7.0-shaped. */
let padDevices = $state<Map<string, Map<string, DeviceRecord>>>(new SvelteMap());

// ============================================
// Derived views
// ============================================

/**
 * Flat paramPath → ParamRecord view. Replaces
 * `deviceParameterStorage.paramIds` under v3.
 *
 * Rebuilt whenever the tree mutates — fine at session scale (see
 * [06 §6]: single-digit-MB store, sub-ms rebuild), and simpler than
 * maintaining a parallel index. If a future profile says otherwise,
 * the rebuild can be narrowed without changing the interface.
 */
const paramByPathView = $derived.by<Map<string, ParamRecord>>(() => {
	const out = new Map<string, ParamRecord>();
	for (const track of tracks.values()) {
		for (const device of track.devices.values()) {
			for (const param of device.params.values()) {
				out.set(param.paramPath, param);
			}
		}
	}
	for (const devices of padDevices.values()) {
		for (const device of devices.values()) {
			for (const param of device.params.values()) {
				out.set(param.paramPath, param);
			}
		}
	}
	return out;
});

/**
 * Device metadata view: devicePath → DeviceRecord. Replaces the v2
 * `allTracksDeviceCache` and the `parameterNames` / `_properties`
 * side-maps that climbed off it.
 */
const deviceByPathView = $derived.by<Map<string, DeviceRecord>>(() => {
	const out = new Map<string, DeviceRecord>();
	for (const track of tracks.values()) {
		for (const device of track.devices.values()) {
			out.set(device.devicePath, device);
		}
	}
	for (const devices of padDevices.values()) {
		for (const device of devices.values()) {
			out.set(device.devicePath, device);
		}
	}
	return out;
});

// ============================================
// Mutation primitives (called by handlers, not by components)
// ============================================

/**
 * Replace the whole tree. Called by v3StateFull on a completed bundle.
 *
 * `iterTracks` must be iterable in LOM position order; we preserve
 * insertion order into the store's tracks Map so `$derived` views
 * that iterate inherit that order.
 *
 * ADR-003 (2026-04-16): this is now a **reconciling** replace, not a
 * blow-everything-away reassignment. The previous implementation built
 * a fresh `SvelteMap` and replaced every `TrackRecord` / `DeviceRecord`
 * / `ParamRecord` by identity on every state/full. That churn orphaned
 * optimistic `applyParamValue` writes whenever a VST preset load
 * fired 2–3 state/fulls in quick succession mid-drag — `DeviceXY`'s
 * `$effect(() => { if (!isDragging) localX = xValue; })` then snapped
 * back to the fallback `?? 0.5` because its `$derived` was reading
 * from a detached (old-identity) `ParamRecord` while the store now
 * held a different one with the wire-shipped (stale) value.
 *
 * The reconciler compares incoming-vs-existing at every level and
 * mutates the existing Maps/records in place:
 *
 * - **Surface wins on value compare** (Option A semantics). If the
 *   incoming `ParamRecord.value` differs from the existing one, we
 *   overwrite. During real drag the XY widget reads its local `localX`
 *   (not the store), so a brief mid-drag tree bounce is invisible; on
 *   release, if state/fulls have settled, the last optimistic write is
 *   already the existing value and no overwrite fires.
 * - **Identity preserved when fields are unchanged.** Unchanged records
 *   are left alone entirely — no `.set()`, no reassignment, no reactive
 *   signal. This is what keeps `$derived.by` consumers that closed over
 *   a specific `ParamRecord` identity stable across state/fulls.
 * - **Adds and deletes are precise.** Only the paths that appear (or
 *   disappear) fire `.set()`/`.delete()`; everything else stays.
 */
export function replaceTree(
	newGeneration: number,
	iterTracks: Iterable<TrackRecord>
): void {
	generation = newGeneration;
	reconcileTracks(tracks, iterTracks);
	prunePadMapsWithoutRack();
}

/**
 * Drop every pad map under `prefix` — a track (`tracks/2/`) or a rack
 * (`tracks/2/devices/0/pads/`) that is gone (issue #491, from the code
 * review): a different rack landing at the old path would otherwise
 * answer with the previous rack's records until its own bundle arrived,
 * and their params would stay in `paramByPath` for the session. Returns
 * the count of records removed, for the invalidate log line.
 */
function dropPadMapsUnder(prefix: string): number {
	let count = 0;
	for (const [padPath, devices] of [...padDevices.entries()]) {
		if (!padPath.startsWith(prefix)) continue;
		for (const d of devices.values()) count += 1 + d.params.size;
		padDevices.delete(padPath);
	}
	return count;
}

/**
 * After a tree replace, drop every pad map whose rack path no longer
 * holds a Drum Rack — a track deleted above the kit, or a device inserted
 * before it, moves the rack and leaves its old path to something else.
 */
function prunePadMapsWithoutRack(): void {
	for (const padPath of [...padDevices.keys()]) {
		const pad = parsePadPath(padPath);
		const rack = pad ? tracks.get(splitTrackPath(pad.rackPath).trackPath ?? '')?.devices.get(pad.rackPath) : undefined;
		if (rack?.className !== 'DrumGroupDevice') padDevices.delete(padPath);
	}
}

/**
 * Phase 12 pr12-3 — scoped merge for `reason="selection-change"` bundles.
 *
 * Unlike {@link replaceTree}, this does NOT delete sibling tracks. The
 * Python surface emits a state/full carrying only the selected track's
 * subtree (one T-record plus its D/P/V/S/C records); applying that
 * through the full-tree reconciler would wipe every other track in the
 * store. This function instead upserts the one scoped track via the
 * existing {@link reconcileDevices} / {@link reconcileSlots} helpers,
 * preserving ADR-003 identity on persisting devices/params/slots.
 *
 * Generation is still advanced — scoped bundles carry the authoritative
 * generation just like every other state/full, and outbound
 * `/looping/v3/param/set` needs the latest number.
 *
 * If `scopedTrack` is `null` (Python resolved an empty/unknown scope and
 * suppressed payload) this is a pure generation bump — matches the
 * emitter's "no tracks shipped" case.
 *
 * @see Looping's documentation/archive/m4l-to-python-v3/04-wire-protocol.md §3.2
 */
export function mergeSubtreeAtPath(
	newGeneration: number,
	scope: string,
	scopedTrack: TrackRecord | null
): void {
	generation = newGeneration;
	if (scopedTrack === null) return;
	if (scopedTrack.trackPath !== scope) {
		// Python guarantees payload.trackPath === scope; a mismatch means
		// a parser bug or truncated buffer. Drop the apply rather than
		// corrupt the store.
		logger.warn('v3 state/full scoped: scope/payload mismatch', {
			scope,
			payloadPath: scopedTrack.trackPath
		});
		return;
	}
	const prev = tracks.get(scope);
	if (!prev) {
		tracks.set(scope, scopedTrack);
		prunePadMapsWithoutRack();
		return;
	}
	// Recurse into the nested Maps on `prev` so ADR-003 identity survives.
	reconcileDevices(prev.devices, scopedTrack.devices);
	reconcileSlots(prev.slots, scopedTrack.slots);
	prunePadMapsWithoutRack();
	const scalarsEqual =
		prev.name === scopedTrack.name &&
		prev.color === scopedTrack.color &&
		prev.mute === scopedTrack.mute &&
		prev.solo === scopedTrack.solo &&
		prev.arm === scopedTrack.arm &&
		prev.hasMidiInput === scopedTrack.hasMidiInput &&
		prev.hasAudioInput === scopedTrack.hasAudioInput &&
		prev.hasArrangementClips === scopedTrack.hasArrangementClips &&
		prev.volume === scopedTrack.volume &&
		prev.isFoldable === scopedTrack.isFoldable &&
		prev.foldState === scopedTrack.foldState &&
		prev.groupTrackIndex === scopedTrack.groupTrackIndex &&
		prev.role === scopedTrack.role &&
		prev.preset === scopedTrack.preset;
	if (!scalarsEqual) {
		tracks.set(scope, {
			...scopedTrack,
			panning: prev.panning,
			inputRoutingType: prev.inputRoutingType,
			inputRoutingChannel: prev.inputRoutingChannel,
			devices: prev.devices,
			slots: prev.slots
		});
	}
}

/**
 * Apply a pad-scoped bundle (issue #491, reason `pad-chain`): the effects
 * on one drum pad's chain, reconciled into that pad's own map with the
 * same identity rules the track's devices get (`reconcileDevices` — so a
 * pad Reverb's `ParamRecord`s keep their identity across re-emits, and
 * the new-device hook drains a pad-scoped slot's pending values into a
 * device the moment it lands). An empty bundle is a real answer — every
 * effect gone — and empties the pad. Generation is advanced like every
 * other bundle.
 */
export function mergePadChain(newGeneration: number, padPath: string, devices: Map<string, DeviceRecord>): void {
	generation = newGeneration;
	let existing = padDevices.get(padPath);
	if (!existing) {
		existing = new SvelteMap<string, DeviceRecord>();
		padDevices.set(padPath, existing);
	}
	reconcileDevices(existing, devices);
}

/** The devices inside one pad's chain, in chain order; `[]` before a bundle lands. */
export function padDevicesAt(padPath: string): DeviceRecord[] {
	const devices = padDevices.get(padPath);
	return devices ? Array.from(devices.values()) : [];
}

// ============================================
// Reconciliation helpers (ADR-003)
// ============================================

/**
 * Merge `incoming` tracks into `existing` in place, preserving
 * **nested Map identity** (the `.devices` / `.slots` `SvelteMap`s) for
 * any trackPath that persists across the state/full. Inserts new
 * tracks, deletes absent ones, and recurses into `devices` / `slots`
 * via the sibling helpers.
 *
 * ADR-003 identity invariant: for any `trackPath` present in both
 * `existing` (before) and `incoming`, the `.devices` / `.slots`
 * SvelteMap references on the stored `TrackRecord` are preserved
 * across the call. This is what keeps `$derived` consumers that
 * iterate `track.devices` stable across state/fulls. Scalar field
 * changes (name/mute/solo/arm/…) are signalled by re-inserting the
 * record via `existing.set(trackPath, merged)` — required because
 * `TrackRecord` is a plain POJO inside a `SvelteMap`, and only `.set()`
 * fires SvelteMap reactivity (matches `applyParamValue`'s pattern).
 */
function reconcileTracks(
	existing: Map<string, TrackRecord>,
	incoming: Iterable<TrackRecord>
): void {
	const seen = new Set<string>();
	for (const inc of incoming) {
		seen.add(inc.trackPath);
		const prev = existing.get(inc.trackPath);
		if (!prev) {
			existing.set(inc.trackPath, inc);
			continue;
		}
		// Always recurse into the nested Maps — their reactive `.set()`
		// signals fire from inside the helpers. Critically, we pass
		// `prev`'s nested Maps so their identity survives the call.
		reconcileDevices(prev.devices, inc.devices);
		reconcileSlots(prev.slots, inc.slots);
		// Scalar fields: re-insert only if something changed, so
		// track-level `$derived` consumers see the signal. Reuses prev's
		// `.devices` / `.slots` references to preserve their identity.
		// PR-5d-first: `panning` / `inputRoutingType` / `inputRoutingChannel`
		// are NOT part of the state/full T record (they arrive only via
		// per-attr listener fires). Preserve any `prev` value when
		// re-inserting so a state/full between two listener fires doesn't
		// wipe an already-populated field.
		const scalarsEqual =
			prev.name === inc.name &&
			prev.color === inc.color &&
			prev.mute === inc.mute &&
			prev.solo === inc.solo &&
			prev.arm === inc.arm &&
			prev.hasMidiInput === inc.hasMidiInput &&
			prev.hasAudioInput === inc.hasAudioInput &&
			prev.hasArrangementClips === inc.hasArrangementClips &&
			prev.volume === inc.volume &&
			prev.isFoldable === inc.isFoldable &&
			prev.foldState === inc.foldState &&
			prev.groupTrackIndex === inc.groupTrackIndex &&
			prev.role === inc.role &&
			prev.preset === inc.preset;
		if (!scalarsEqual) {
			existing.set(inc.trackPath, {
				...inc,
				panning: prev.panning,
				inputRoutingType: prev.inputRoutingType,
				inputRoutingChannel: prev.inputRoutingChannel,
				devices: prev.devices,
				slots: prev.slots
			});
		}
	}
	for (const trackPath of existing.keys()) {
		if (!seen.has(trackPath)) existing.delete(trackPath);
	}
}

/**
 * Hook fired on new-device insertion (state/full or scoped merge).
 * The FX-grid layer registers this in `fxGridStore` to drain speculative
 * pre-load gesture values into the just-inserted ParamRecords *before*
 * the SvelteMap insert fires reactivity. Without this, components
 * reading params on `device`-arrival see Live's just-loaded defaults
 * for one tick before the speculative-drain runs, which produces a
 * visible snap-back. The hook closes that race.
 *
 * Returns a `Map<paramIndex, value>` of overrides to splice into the
 * device's params before insertion, or `undefined` to leave them as-is.
 * Returning a value also implies the caller has armed the path and
 * scheduled the OSC `param/set` send so Live reflects the user's intent.
 */
type NewDeviceHook = (device: DeviceRecord) => Map<number, number> | undefined;

let newDeviceHook: NewDeviceHook | null = null;

/**
 * Register the new-device hook. Idempotent: a second registration
 * replaces the prior hook. Pass `null` to clear (test teardown).
 */
export function setNewDeviceHook(hook: NewDeviceHook | null): void {
	newDeviceHook = hook;
}

/**
 * Apply speculative-value overrides to a freshly-arrived device's
 * params Map, in place, before it's exposed to the reactive graph.
 * The override map is keyed by `paramIndex`; the function resolves
 * each to a paramPath using the device's existing params, finds the
 * matching ParamRecord, and replaces it with the override value.
 *
 * No-op for entries whose paramIndex doesn't resolve to a ParamRecord
 * — matches the rest of this store's drop-on-missing posture.
 */
function applyOverridesToNewDevice(
	device: DeviceRecord,
	overrides: Map<number, number>
): void {
	for (const [paramIndex, value] of overrides) {
		const paramPath = `${device.devicePath}/params/${paramIndex}`;
		const param = device.params.get(paramPath);
		if (!param) continue;
		device.params.set(paramPath, { ...param, value });
	}
}

/**
 * Merge `incoming` devices into `existing` in place. Identity
 * invariant: `DeviceRecord` persists across the call for any
 * `devicePath` present on both sides; its `.params` SvelteMap is the
 * same reference before and after. See ADR-003.
 *
 * A devicePath collision with a *different* className is treated as a
 * replacement — the LOM hot-swapped a device in this slot. In that
 * case we do replace identity, because the old params are stale by
 * definition.
 *
 * New-device path runs the {@link newDeviceHook} (if registered) so
 * pre-load speculative values land on the new ParamRecords before any
 * reactive consumer observes them.
 */
function reconcileDevices(
	existing: Map<string, DeviceRecord>,
	incoming: Map<string, DeviceRecord>
): void {
	const seen = new Set<string>();
	for (const [devicePath, inc] of incoming) {
		seen.add(devicePath);
		const prev = existing.get(devicePath);
		if (!prev || prev.className !== inc.className) {
			// New device or hot-swap — identity must change because the
			// old params are stale by definition. Run the new-device hook
			// to drain pre-load speculative values into the params Map
			// before exposing the record to consumers.
			if (newDeviceHook) {
				const overrides = newDeviceHook(inc);
				if (overrides && overrides.size > 0) {
					applyOverridesToNewDevice(inc, overrides);
				}
			}
			existing.set(devicePath, inc);
			continue;
		}
		// Params are the whole point of ADR-003: recurse into the
		// *existing* params SvelteMap so its identity — and every
		// unchanged ParamRecord's identity — survives the call.
		// PR-3.5.7: `properties` follows the same identity rule — the
		// state/full incoming record always carries an empty SvelteMap
		// (properties don't ride the structural record per ADR-002), so
		// we keep the existing one to preserve any in-flight subscription
		// values. The property subscription manager tears down dead-path
		// subs separately on state/invalidate.
		reconcileParams(prev.params, inc.params);
		if (prev.name !== inc.name) {
			existing.set(devicePath, {
				...inc,
				params: prev.params,
				properties: prev.properties
			});
		}
	}
	for (const devicePath of existing.keys()) {
		if (!seen.has(devicePath)) existing.delete(devicePath);
	}
}

/**
 * Merge `incoming` params into `existing` in place. ADR-003 Option A
 * semantics: if any of `name`/`displayName`/`min`/`max`/`unit` changed,
 * or `value` differs from the existing value, we **overwrite by `.set()`
 * of a new record**. If *nothing* differs we leave the existing record
 * untouched — no reactive signal fires.
 *
 * Rationale for "value differs → overwrite" (surface wins): during
 * real drag the XY widget reads its own `localX` / `localY` local
 * state, not the store, so a mid-drag tree bounce is invisible. On
 * release, the optimistic write is already in `existing` (ADR-001),
 * so as long as state/fulls arrive *before* the user's release-frame
 * (which they do — state/full is network-bound, release is input-
 * bound and fires after), `inc.value === prev.value` and no overwrite
 * fires. See ADR-003 for full argument.
 */
function reconcileParams(
	existing: Map<string, ParamRecord>,
	incoming: Map<string, ParamRecord>
): void {
	const seen = new Set<string>();
	for (const [paramPath, inc] of incoming) {
		seen.add(paramPath);
		const prev = existing.get(paramPath);
		if (!prev) {
			existing.set(paramPath, inc);
			continue;
		}
		const metaEqual =
			prev.name === inc.name &&
			prev.displayName === inc.displayName &&
			prev.min === inc.min &&
			prev.max === inc.max &&
			prev.unit === inc.unit;
		const valueEqual = prev.value === inc.value;
		if (metaEqual && valueEqual) {
			// Fully unchanged — keep existing identity, no .set() fires.
			continue;
		}
		// State/full carries Live's authoritative value, but if the UI
		// is mid-drag on this path we hold the existing (UI-armed) value
		// until the round-trip closes. Without this, a state/full landing
		// during drag would snap the visual to the surface's pre-write
		// value. Meta updates still flow through (they ride a separate
		// branch below).
		const echoDecision = valueEqual ? 'apply' : reconcileEcho(paramPath, inc.value);
		const effectiveValue = echoDecision === 'suppress' ? prev.value : inc.value;
		if (metaEqual && effectiveValue === prev.value) {
			// Arm suppressed the only delta — leave existing record alone.
			continue;
		}
		// State/full bundles never carry `displayValue` (it's a
		// hot-path companion fired separately via `param/display` per
		// ADR-352). Without explicit preservation, a structural
		// state/full mid-drag would wipe any in-flight display string;
		// the next `param/set` would refresh it within one TTL window
		// (~750ms) but the readout would briefly go dark.
		// `inc.displayValue` is always undefined here so this can't
		// surface stale wire data — it only carries forward a hint that
		// was valid moments ago.
		existing.set(paramPath, {
			...inc,
			value: effectiveValue,
			displayValue: prev.displayValue
		});
	}
	for (const paramPath of existing.keys()) {
		if (!seen.has(paramPath)) {
			existing.delete(paramPath);
		}
	}
}

/**
 * Merge `incoming` slots into `existing` in place. Clip identity is
 * preserved when `clipPath` matches; clip properties Map is reconciled
 * structurally. See ADR-003.
 */
function reconcileSlots(
	existing: Map<string, SlotRecord>,
	incoming: Map<string, SlotRecord>
): void {
	const seen = new Set<string>();
	for (const [slotPath, inc] of incoming) {
		seen.add(slotPath);
		const prev = existing.get(slotPath);
		if (!prev) {
			existing.set(slotPath, inc);
			continue;
		}
		// Reconcile clip first so we can build the merged record in one
		// re-insert if anything changed.
		let mergedClip: ClipRecord | undefined = prev.clip;
		if (!inc.clip) {
			mergedClip = undefined;
		} else if (!prev.clip || prev.clip.clipPath !== inc.clip.clipPath) {
			mergedClip = inc.clip;
		} else {
			const pc = prev.clip;
			const ic = inc.clip;
			// Reconcile properties map in place — SvelteMap .set()/.delete()
			// fire reactivity, so this is safe.
			for (const [k, v] of ic.properties) {
				if (pc.properties.get(k) !== v) pc.properties.set(k, v);
			}
			for (const k of pc.properties.keys()) {
				if (!ic.properties.has(k)) pc.properties.delete(k);
			}
			const clipScalarsEqual =
				pc.name === ic.name &&
				pc.length === ic.length &&
				pc.color === ic.color &&
				pc.pitch === ic.pitch;
			mergedClip = clipScalarsEqual
				? pc
				: { ...ic, properties: pc.properties };
		}
		const stateEqual = prev.state === inc.state;
		const clipIdentityEqual = mergedClip === prev.clip;
		if (!stateEqual || !clipIdentityEqual) {
			existing.set(slotPath, {
				slotPath: prev.slotPath,
				state: inc.state,
				clip: mergedClip
			});
		}
	}
	for (const slotPath of existing.keys()) {
		if (!seen.has(slotPath)) existing.delete(slotPath);
	}
}

/**
 * Apply a single v3 param/value echo or query-reply. O(1): path →
 * trackPath → devicePath → paramPath, each a Map lookup. If any
 * segment is missing, silently no-op — it means the path was
 * invalidated before the echo reached us. The UI will re-bind on the
 * next generation event; dropping the echo is safer than creating a
 * ghost parameter with no surrounding metadata.
 *
 * ADR-002 (2026-04-16): re-inserts a fresh record via `params.set()`
 * rather than mutating `param.value` in place. The container is a
 * `SvelteMap` (ADR-002); `.set()` is the reactive signal that fires
 * `$derived` consumers downstream. The previous in-place mutation
 * (`param.value = value`) landed the new number on a non-reactive
 * POJO inside a non-reactive `Map`, so nothing downstream re-ran —
 * the root cause of the XY snap-back ADR-001 misdiagnosed.
 */
export function applyParamValue(paramPath: string, value: number): boolean {
	const { trackPath, devicePath } = splitParamPath(paramPath);
	if (!trackPath || !devicePath) {
		logger.debug('applyParamValue: malformed path', { paramPath, value });
		return false;
	}
	// The track's device, or a pad chain's (issue #491): one lookup.
	const device = findDevice(devicePath);
	if (!device) {
		logger.debug('applyParamValue: unknown device', { paramPath, value });
		return false;
	}
	const param = device.params.get(paramPath);
	if (!param) {
		logger.debug('applyParamValue: unknown param', { paramPath, value });
		return false;
	}
	// Suppress echoes that disagree with what the UI just wrote — closes
	// the round-trip jump (ADR-140 was avoiding) without component-local
	// state shadows. A matching echo clears the arm and flows through.
	if (reconcileEcho(paramPath, value) === 'suppress') {
		return false;
	}
	device.params.set(paramPath, { ...param, value });
	return true;
}

/**
 * Apply a `/looping/v3/param/display` echo. Same drop-on-missing
 * discipline as `applyParamValue`: a path that doesn't resolve gets
 * silently dropped (the display fire arrived during the
 * invalidate→rebuild race, or before the first state/full landed).
 *
 * Re-inserts a fresh record via `params.set()` to fire `SvelteMap`
 * reactivity downstream (same pattern as `applyParamValue` — in-place
 * mutation on a non-reactive POJO would not trigger `$derived`
 * consumers).
 */
export function applyParamDisplay(paramPath: string, displayValue: string): boolean {
	const { trackPath, devicePath } = splitParamPath(paramPath);
	if (!trackPath || !devicePath) {
		logger.debug('applyParamDisplay: malformed path', { paramPath, displayValue });
		return false;
	}
	// The track's device, or a pad chain's (issue #491): one lookup.
	const device = findDevice(devicePath);
	if (!device) {
		logger.debug('applyParamDisplay: unknown device', { paramPath, displayValue });
		return false;
	}
	const param = device.params.get(paramPath);
	if (!param) {
		logger.debug('applyParamDisplay: unknown param', { paramPath, displayValue });
		return false;
	}
	device.params.set(paramPath, { ...param, displayValue });
	return true;
}

/**
 * PR-5d-first (2026-04-17 night) — apply a single
 * `/looping/v3/track/<attr>` listener fire to the stored `TrackRecord`.
 *
 * Attr set matches `TrackMetadataComponent`'s 8 addresses, narrowed on
 * the UI side to the 5 scalar fields already on `T` plus the 3
 * optional fields we reserved above. On write we re-insert the record
 * via `tracks.set(trackPath, { ...prev, [attr]: value })` to fire
 * `SvelteMap` reactivity — matches `applyParamValue`'s pattern.
 *
 * Per ADR-003 identity invariant, the record's nested `devices` /
 * `slots` SvelteMaps survive unchanged (we spread `prev` before
 * overriding the one scalar attr), so `$derived` consumers that
 * iterate the nested maps don't re-run because a track was renamed.
 *
 * Silently no-ops if the trackPath isn't in the tree — matches the
 * drop-on-missing discipline of `applyParamValue` and handles the
 * benign race where a listener fires for a track that's already been
 * removed by `invalidatePaths`. Also silently ignores `master` /
 * `returns/<N>` paths; PR-5b/5e own those. Returns `true` on applied,
 * `false` on any drop for test observability.
 */
export type TrackMetadataAttr =
	| 'name'
	| 'color'
	| 'mute'
	| 'solo'
	| 'arm'
	| 'panning'
	| 'volume'
	| 'inputRoutingType'
	| 'inputRoutingChannel'
	// Protocol 3.7.0. Rides this primitive rather than getting its own
	// because it behaves exactly like `color`: a UI-initiated write with
	// a surface echo, applied optimistically so the rail appears on the
	// same frame as the preset that caused it.
	| 'role'
	// Protocol 3.9.0 (ADR-439): the surface's echo after a prepare load
	// records `looping.preset`. No UI write — the load is the authority.
	| 'preset';

export function applyTrackMetadata(
	trackPath: string,
	attr: TrackMetadataAttr,
	value: unknown
): boolean {
	if (!trackPath.startsWith('tracks/')) return false;
	const prev = tracks.get(trackPath);
	if (!prev) {
		logger.debug('applyTrackMetadata: unknown trackPath', {
			trackPath,
			attr
		});
		return false;
	}
	tracks.set(trackPath, { ...prev, [attr]: value });
	return true;
}

/**
 * PR-7c pr7c-5 (2026-04-19) — apply a
 * `/looping/v3/track/has_arrangement_clips` fire from
 * `TrackMetadataComponent.arrangement_clips` listener on the Python
 * surface. Lives in its own primitive (rather than folding into
 * `applyTrackMetadata`) because: (a) it's read-only — no UI write
 * counterpart, (b) it maps to a distinct address family, (c) the
 * type coercion is always int→bool from a 0/1 wire value, so the
 * `value: unknown` escape hatch on `applyTrackMetadata` would be a
 * lie. Per rule #3 (trust the echo): does NOT advance a UI-side
 * generation; the surface already advances on its side and will
 * re-emit the state/full with the updated T-record, which the
 * reconcile path then absorbs without disturbing nested Map identity.
 *
 * Silently no-ops for master / returns / unknown paths — same
 * drop-on-missing discipline as the other apply-* primitives. Returns
 * `true` on applied, `false` on drop.
 */
export function applyHasArrangementClips(
	trackPath: string,
	flag: boolean
): boolean {
	if (!trackPath.startsWith('tracks/')) return false;
	const prev = tracks.get(trackPath);
	if (!prev) {
		logger.debug('applyHasArrangementClips: unknown trackPath', {
			trackPath
		});
		return false;
	}
	if (prev.hasArrangementClips === flag) return true;
	tracks.set(trackPath, { ...prev, hasArrangementClips: flag });
	return true;
}

/**
 * ADR-410 — apply a `/looping/v3/track/fold_state [trackPath, flag]`
 * arrival (a Group Track was folded or unfolded).
 *
 * Deliberately does NOT ride a state/full republish. A fold changes no
 * LOM structure — no track is added, removed, or reordered — only which
 * rows Live draws. Republishing the tree to hide six strips would ship
 * thousands of args for one bit, so the surface emits this focused echo
 * and the UI recomputes visibility from the group tree it already holds
 * (`$lib/utils/trackGroups`). One flag flip therefore updates every
 * descendant, at any nesting depth, with no round-trip.
 *
 * Fires both from Live-side folds (the surface's song-scoped
 * `visible_tracks` listener) and as the write-path echo of our own
 * `/looping/v3/track/set/fold_state` — Live exposes no per-track
 * fold listener to produce one.
 *
 * Silently no-ops for master / returns / unknown paths. Returns `true`
 * on applied, `false` on drop.
 */
export function applyTrackFoldState(trackPath: string, flag: boolean): boolean {
	if (!trackPath.startsWith('tracks/')) return false;
	const prev = tracks.get(trackPath);
	if (!prev) {
		logger.debug('applyTrackFoldState: unknown trackPath', { trackPath });
		return false;
	}
	if (prev.foldState === flag) return true;
	tracks.set(trackPath, { ...prev, foldState: flag });
	return true;
}

/**
 * PR-5b — apply a `/looping/v3/master/<attr>` arrival.
 *
 * Master lives in the same `tracks` SvelteMap as regular tracks
 * (state/full populates it under the literal key `'master'`), but the
 * wire shape is intentionally different: master addresses omit the
 * trackPath arg and the attr set is a strict subset
 * (volume/name/color/pan/mute — no arm/solo/inputRouting). Keeping a
 * separate primitive makes the master/track/return seam explicit at
 * every layer (wire → handler → store → UI) per the PR-5b design
 * record §2.1.
 *
 * Master volume rides the master address family
 * (`/looping/v3/master/volume`) — separate from the regular-track
 * `/looping/v3/track/volume` wire because the master mixer's param
 * lookup and path shape differ (no trackPath arg).
 *
 * Silently no-ops if the master record isn't in the tree yet — same
 * drop-on-missing discipline as `applyTrackMetadata`. Returns `true`
 * on applied, `false` on drop.
 */
export type MasterMetadataAttr =
	| 'name'
	| 'color'
	| 'mute'
	| 'panning'
	| 'volume';

export function applyMasterMetadata(
	attr: MasterMetadataAttr,
	value: unknown
): boolean {
	const prev = tracks.get('master');
	if (!prev) {
		logger.debug('applyMasterMetadata: master record not in tree', {
			attr
		});
		return false;
	}
	tracks.set('master', { ...prev, [attr]: value });
	return true;
}

/**
 * PR-3.5.7 — apply a single `/looping/v3/property/value` arrival.
 *
 * Per ADR-002: properties live on `Device.properties: SvelteMap`,
 * keyed by the wire `propertyName` string (which can be dotted, e.g.
 * `sample.warp_mode`). The wire treats the dotted name as opaque; we
 * store it that way too so reads and writes line up by exact key.
 *
 * Returns `true` on success, `false` if the device went away before
 * the echo reached us — caller logs at debug only (a property/value
 * for an invalidated device is a benign race, same shape as
 * `applyParamValue`'s drop-on-missing policy).
 *
 * `value` is `OSCArg` because Live properties carry whatever type the
 * LOM exposes (int for `playback_mode`, float for `sample.gain`,
 * int-coerced bool for `sample.warping`). The component-side reader
 * is responsible for the type cast.
 */
export function applyPropertyValue(
	devicePath: string,
	propertyName: string,
	value: OSCArg
): boolean {
	const { trackPath } = splitTrackPath(devicePath);
	if (!trackPath) {
		logger.debug('applyPropertyValue: malformed devicePath', {
			devicePath,
			propertyName
		});
		return false;
	}
	const device = findDevice(devicePath);
	if (!device) return false;
	device.properties.set(propertyName, value);
	return true;
}

/** A device record by path — the track's, or a pad chain's (issue #491). */
function findDevice(devicePath: string): DeviceRecord | undefined {
	const pad = parsePadPath(devicePath);
	if (pad) return padDevices.get(pad.padPath)?.get(devicePath);
	const { trackPath } = splitTrackPath(devicePath);
	if (!trackPath) return undefined;
	return tracks.get(trackPath)?.devices.get(devicePath);
}

/**
 * Drop everything rooted at any of `paths` and advance the stored
 * generation. Called by the state/invalidate handler.
 *
 * Invalidation semantics per [04 §3.3]: the surface lists paths that
 * are *dead*. A path can name any level (track, device, param, slot,
 * clip). We delete the exact entry for a match — the surface is
 * expected to list roots of subtrees, not every descendant.
 *
 * Returns the number of tree entries removed, for test assertions and
 * log observability.
 */
/**
 * Apply a `/looping/v3/clip/created` or `/clip/removed` fire — the
 * per-slot `has_clip` listener on the surface (`ClipsComponent`).
 *
 * Until this existed the two addresses had no UI handler at all: a clip
 * added or deleted in Live advanced the generation and emitted a
 * path-less `state/invalidate`, which drops nothing, so the session
 * grid kept painting the slot the way the last `state/full` left it —
 * a deleted clip stayed on screen and a new one never appeared.
 *
 * The created case writes a PLACEHOLDER clip record: the wire carries
 * a slotPath and nothing else, and name/length/color live in the C
 * record, which only a `state/full` carries. That is what the caller's
 * debounced resync is for — this makes the cell correct about whether
 * a clip is there (which is what a performer reads at a glance) and
 * the resync fills in what it is called.
 *
 * Silently no-ops for an unknown track or a malformed path — same
 * drop-on-missing discipline as the other apply-* primitives.
 *
 * @returns `true` when a slot was updated.
 */
export function applyClipLifecycle(slotPath: string, created: boolean): boolean {
	const match = /^(tracks\/\d+)\/slots\/(\d+)$/.exec(slotPath);
	if (!match) {
		logger.debug('applyClipLifecycle: malformed slotPath', { slotPath });
		return false;
	}
	const trackPath = match[1];
	const track = tracks.get(trackPath);
	if (!track) {
		logger.debug('applyClipLifecycle: unknown trackPath', { slotPath });
		return false;
	}

	const prev = track.slots.get(slotPath);
	if (!created) {
		// Nothing to forget is not a failure: the snapshot may already
		// have had the slot empty (a delete of a clip we never saw).
		if (!prev || (prev.state === 'empty' && !prev.clip)) return false;
		track.slots.set(slotPath, { slotPath, state: 'empty' });
		return true;
	}

	// A slot that already holds a clip record keeps it — a `created`
	// for a slot we already know about (a replace, or a resync that
	// beat the listener) must not blank the name we already have.
	if (prev?.clip) {
		if (prev.state === 'empty') {
			track.slots.set(slotPath, { ...prev, state: 'has_clip' });
			return true;
		}
		return false;
	}

	track.slots.set(slotPath, {
		slotPath,
		state: 'has_clip',
		clip: {
			clipPath: `${slotPath}/clip`,
			name: '',
			length: 0,
			color: 0,
			pitch: 0,
			properties: new SvelteMap<string, OSCArg>()
		}
	});
	return true;
}

export function invalidatePaths(
	newGeneration: number,
	paths: readonly string[]
): number {
	generation = newGeneration;
	let removed = 0;
	for (const path of paths) {
		removed += dropSubtree(path);
	}
	return removed;
}

/**
 * Reset to empty. Used by handshake disconnect and by tests. Does not
 * reset `generation` — on reconnect the new handshake/state-full will
 * set it.
 */
export function resetTree(): void {
	tracks = new SvelteMap();
	padDevices = new SvelteMap();
	resetParamArming();
	clearHeldEtags();
}

/**
 * Advance the generation without touching the tree.
 *
 * Protocol 3.5.0 `state/full/unchanged`: the surface confirmed the
 * tree we hold is current, so there is nothing to reconcile — but
 * outbound `/looping/v3/param/set` still needs the latest generation
 * or the surface will reject writes as stale.
 *
 * Deliberately narrow. Every other path that moves `generation` also
 * installs a payload; this is the only one that legitimately moves it
 * alone, and it is only correct because the caller has verified the
 * marker was minted for *this* session.
 */
export function stampGeneration(newGeneration: number): void {
	generation = newGeneration;
}

/** Handshake landing point (PR-2c will drive this). Test-only helpers
 *  use the same entry points. */
export function setHandshake(newSessionId: string, newGeneration: number): void {
	sessionId = newSessionId;
	generation = newGeneration;
}

/** Record the advertised `surface/hello` instanceId. Called by the
 *  v3SurfaceHello handler — first emission records the baseline; a
 *  later emission with a *different* value is the drift signal that
 *  triggers `resetForSurfaceRestart` + re-handshake in the handler.
 *  The store itself doesn't branch on drift; that's handler policy. */
export function setSurfaceInstanceId(newInstanceId: string): void {
	surfaceInstanceId = newInstanceId;
}

/** Reset all per-surface state on detected surface restart per
 *  [04 §8.6]. Clears the tree, zeroes generation, drops sessionId —
 *  the subsequent `/handshake/hello` → `accept` → `state/full
 *  reason="accept"` bundle repopulates everything against the fresh
 *  surface instance. Does *not* touch `surfaceInstanceId`; the
 *  handler is responsible for updating that to the new value before
 *  calling here (so the next same-instanceId emission remains a
 *  no-op instead of bouncing through restart again). */
export function resetForSurfaceRestart(): void {
	generation = UNSET_GENERATION;
	sessionId = '';
	tracks = new SvelteMap();
	padDevices = new SvelteMap();
	resetParamArming();
	// Load-bearing, not tidiness. The caller re-hellos immediately
	// after this, and a hello that still declares an ETag for the tree
	// we just deleted would be answered `state/full/unchanged` — the
	// surface confirming a tree we no longer have. The UI would sit
	// empty with no error and no retry. Dropping the tree must drop
	// the claim, so the two happen in one place rather than at every
	// call site.
	clearHeldEtags();
}

/** Test-only: full reset (tree + generation + session + instanceId). */
export function _resetForTests(): void {
	generation = UNSET_GENERATION;
	sessionId = '';
	surfaceInstanceId = '';
	tracks = new SvelteMap();
	padDevices = new SvelteMap();
	resetParamArming();
	clearHeldEtags();
}

// ============================================
// Path helpers — exported for reuse by handlers + tests
// ============================================

/**
 * Split a paramPath into its ancestor paths. Returns null components
 * for malformed input — callers must treat any null as "skip this
 * write," matching the drop-on-missing policy above.
 *
 * Supports the three day-one trackRef shapes per [04 §2.1]:
 * `tracks/<N>/...`, `master/...`, `returns/<N>/...`. Rack chains
 * (`.../chains/<N>/devices/<N>/params/<N>`) are grammar-valid but
 * Phase 1–3 implementations reject with `path-not-supported` on the
 * surface side; chain-suffixed paths that somehow reach us here fall
 * out via a mismatching segment check below (they won't match
 * `devices/<N>/params/<N>` in positions 0–2).
 */
export function splitParamPath(paramPath: string): {
	trackPath: string | null;
	devicePath: string | null;
} {
	const { trackPath, rest } = splitTrackPath(paramPath);
	if (!trackPath) return { trackPath: null, devicePath: null };
	const parts = rest.split('/');
	// `params/<K>` is always the tail; what precedes it is the device path,
	// which since 3.8.0 may run through any number of `pads/<note>/devices/<i>`
	// pairs (issue #491). Every index must be a plain decimal.
	if (parts.length < 4 || parts[0] !== 'devices' || parts[parts.length - 2] !== 'params') {
		return { trackPath, devicePath: null };
	}
	const head = parts.slice(0, -2);
	for (let i = 0; i < head.length; i += 2) {
		const seg = head[i];
		const idx = head[i + 1];
		if (idx === undefined || !/^\d+$/.test(idx)) return { trackPath, devicePath: null };
		if (i === 0 ? seg !== 'devices' : seg !== 'pads' && seg !== 'devices') {
			return { trackPath, devicePath: null };
		}
		if (seg === 'pads' && (head[i + 2] !== 'devices' || Number(idx) > 127)) {
			return { trackPath, devicePath: null };
		}
	}
	if (!/^\d+$/.test(parts[parts.length - 1])) return { trackPath, devicePath: null };
	const devicePath = `${trackPath}/${head.join('/')}`;
	return { trackPath, devicePath };
}

/**
 * Peel off the track prefix from any path. Handles `tracks/<N>`,
 * `master`, `returns/<N>`. Returns the trackPath (e.g. `tracks/0`)
 * and the remaining suffix (no leading slash).
 *
 * Null trackPath means malformed input; callers should drop.
 */
export function splitTrackPath(path: string): {
	trackPath: string | null;
	rest: string;
} {
	if (path === 'master') return { trackPath: 'master', rest: '' };
	if (path.startsWith('master/')) {
		return { trackPath: 'master', rest: path.slice('master/'.length) };
	}
	if (path.startsWith('tracks/')) {
		const after = path.slice('tracks/'.length);
		const slash = after.indexOf('/');
		if (slash === -1) {
			if (!/^\d+$/.test(after)) return { trackPath: null, rest: '' };
			return { trackPath: path, rest: '' };
		}
		const idx = after.slice(0, slash);
		if (!/^\d+$/.test(idx)) return { trackPath: null, rest: '' };
		return { trackPath: `tracks/${idx}`, rest: after.slice(slash + 1) };
	}
	if (path.startsWith('returns/')) {
		const after = path.slice('returns/'.length);
		const slash = after.indexOf('/');
		if (slash === -1) {
			if (!/^\d+$/.test(after)) return { trackPath: null, rest: '' };
			return { trackPath: path, rest: '' };
		}
		const idx = after.slice(0, slash);
		if (!/^\d+$/.test(idx)) return { trackPath: null, rest: '' };
		return { trackPath: `returns/${idx}`, rest: after.slice(slash + 1) };
	}
	return { trackPath: null, rest: '' };
}

/**
 * Delete the subtree rooted at `path`. Returns the count of tree
 * entries (tracks + devices + params + slots + clips) removed, for
 * observability.
 */
function dropSubtree(path: string): number {
	const { trackPath, rest } = splitTrackPath(path);
	if (!trackPath) return 0;
	const track = tracks.get(trackPath);
	if (!track) return 0;

	if (rest === '') {
		// Whole track — and every pad map under it.
		const count = countTrack(track) + dropPadMapsUnder(`${trackPath}/`);
		tracks.delete(trackPath);
		return count;
	}

	const parts = rest.split('/');

	// A pad path, a device inside a pad chain, or one of its params
	// (issue #491): drop from the pad map, never from the track's devices.
	const pad = parsePadPath(path);
	if (pad) {
		const devices = padDevices.get(pad.padPath);
		if (!devices) return 0;
		if (path === pad.padPath) {
			let count = 0;
			for (const d of devices.values()) count += 1 + d.params.size;
			padDevices.delete(pad.padPath);
			return count;
		}
		// A param path names its device through `splitParamPath`; a device
		// path IS the device.
		const targetDevice = path.includes('/params/') ? splitParamPath(path).devicePath : path;
		if (!targetDevice) return 0;
		const device = devices.get(targetDevice);
		if (!device) return 0;
		if (path === targetDevice) {
			const count = 1 + device.params.size;
			devices.delete(targetDevice);
			return count;
		}
		return device.params.delete(path) ? 1 : 0;
	}

	// devices/<N>[/params/<N>]
	if (parts[0] === 'devices' && parts.length >= 2) {
		const deviceIdx = parts[1];
		if (!/^\d+$/.test(deviceIdx)) return 0;
		const devicePath = `${trackPath}/devices/${deviceIdx}`;
		const device = track.devices.get(devicePath);
		if (!device) return 0;

		if (parts.length === 2) {
			// The device — and, for a rack, every pad map under it.
			const count = 1 + device.params.size + dropPadMapsUnder(`${devicePath}/pads/`);
			track.devices.delete(devicePath);
			return count;
		}
		if (parts[2] === 'params' && parts.length === 4) {
			const paramIdx = parts[3];
			if (!/^\d+$/.test(paramIdx)) return 0;
			const paramPath = `${devicePath}/params/${paramIdx}`;
			if (device.params.delete(paramPath)) return 1;
			return 0;
		}
		return 0;
	}

	// slots/<N>[/clip]
	if (parts[0] === 'slots' && parts.length >= 2) {
		const slotIdx = parts[1];
		if (!/^\d+$/.test(slotIdx)) return 0;
		const slotPath = `${trackPath}/slots/${slotIdx}`;
		const slot = track.slots.get(slotPath);
		if (!slot) return 0;

		if (parts.length === 2) {
			const count = 1 + (slot.clip ? 1 : 0);
			track.slots.delete(slotPath);
			return count;
		}
		if (parts[2] === 'clip' && parts.length === 3) {
			if (slot.clip) {
				slot.clip = undefined;
				slot.state = 'empty';
				return 1;
			}
			return 0;
		}
		return 0;
	}

	return 0;
}

function countTrack(track: TrackRecord): number {
	let n = 1;
	for (const device of track.devices.values()) {
		n += 1 + device.params.size;
	}
	for (const slot of track.slots.values()) {
		n += 1 + (slot.clip ? 1 : 0);
	}
	return n;
}

// ============================================
// Exported store facade
// ============================================

/**
 * Reactive store surface. Getters rather than bare references so
 * consumers in components track reactivity correctly.
 */
export const v3Store = {
	get generation() {
		return generation;
	},
	get sessionId() {
		return sessionId;
	},
	get surfaceInstanceId() {
		return surfaceInstanceId;
	},
	get tracks() {
		return tracks;
	},
	get paramByPath() {
		return paramByPathView;
	},
	get deviceByPath() {
		return deviceByPathView;
	},
	/** Pad path → the devices inside that pad's chain (issue #491). */
	get padDevices() {
		return padDevices;
	}
};

// Dev-only window exposure so Playwright / DevTools can inspect the real
// store singleton. Dynamic import() via Vite picks up a separately-
// fingerprinted module instance (empty tree), which defeats the point —
// this ensures we're looking at the same `v3Store` the rest of the app
// consumes. Gated on `import.meta.env.DEV` so it no-ops in production.
if (typeof window !== 'undefined' && import.meta.env.DEV) {
	(window as unknown as { v3Store: typeof v3Store }).v3Store = v3Store;
}
