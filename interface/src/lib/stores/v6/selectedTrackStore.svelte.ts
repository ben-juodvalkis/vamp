/**
 * Selected Track Store
 * Unified store for all devices and parameters on the selected track
 *
 * Layers:
 * 1. Core Data - Device chain (trackIndex + devices[])
 * 2. Parameters - Device-aware cache with ID→index mapping
 * 3. UI State - FX Grid state + instrument detection
 * 4. Public API - Component interface
 */

import { send } from '$lib/api/simpleClient';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';
import type { InstrumentType } from '$lib/services/instrumentService';
import { VM_PAD_FX, padDeviceStubs, parseVmPadFx, vmPadChainProperty } from '$lib/services/drumVirtualMacros';
import { parsePadPath } from '$lib/utils/padPaths';
import { logger } from '$lib/utils/logger';
// FXGridState lives as a sibling singleton (`fxGrid`, declared at the
// bottom of this file) instead of a `private` field on SelectedTrackStore
// — audit hotspot #9 decoupling. fxGridStore.svelte.ts re-exports it.
import { FXGridState } from './fxGridStore.svelte';
import { slotRegistry } from './slotRegistry.svelte';
import {
	v3Store,
	UNSET_GENERATION,
	applyParamValue,
	applyPropertyValue,
	padDevicesAt
} from '$lib/stores/v3/normalized.svelte';
import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';
import {
	armParam,
	disarmParam,
	getArmedValue,
	resetParamArming
} from '$lib/stores/v3/paramArming.svelte';
import {
	acquire as acquirePropertySubscription,
	release as releasePropertySubscription
} from '$lib/stores/v3/propertySubscriptions.svelte';
import type { OSCArg } from '$lib/types/osc';
import type { PositionKey, DeviceTypeKey } from '$lib/config/fxGridLayout';
import type { FXGridSlot } from './fxGridStore.svelte';
import type { Device } from '$lib/types/device';

// Re-export for consumers that import from this module
export type { Device } from '$lib/types/device';
// PR-3.5.2: re-export v3 record types so migrated consumers don't have
// to reach across into $lib/stores/v3 directly.
export type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';

export interface ClassifiedDevice extends Device {
	type: DeviceType;
}

export type DeviceType =
	| { kind: 'fx-grid'; position: PositionKey; deviceType: DeviceTypeKey }
	| { kind: 'instrument'; instrumentType: InstrumentType }
	| { kind: 'audio-effect-rack' }
	| { kind: 'sequencer' }
	| { kind: 'unknown' };

// Legacy type alias for backward compatibility during migration
export type SlotKey = PositionKey | DeviceTypeKey;

export type { InstrumentType };

// ===== SELECTED TRACK STORE (Main Class) =====

/**
 * `parseVmPadFx` over the raw row, once per distinct string. `padDevices`
 * runs per tile per read — twelve tiles, every census change — and the
 * row is one JSON string for the whole rack, so re-parsing it in each
 * call was the FX grid's hottest allocation under a held pad (code
 * review, 2026-09-12). A one-entry memo keyed on the string is exact:
 * the parse is a pure function of it.
 */
let padFxMemoRaw: unknown = undefined;
let padFxMemoParsed: ReturnType<typeof parseVmPadFx> = null;
function padFxParsed(raw: unknown): ReturnType<typeof parseVmPadFx> {
	if (raw !== padFxMemoRaw) {
		padFxMemoRaw = raw;
		padFxMemoParsed = parseVmPadFx(raw);
	}
	return padFxMemoParsed;
}

class SelectedTrackStore {
	// Layer 1: Core Data
	private _trackIndex = $state(0);

	// Layer 2: Parameters — DeviceParameterStorage was once a per-store
	// instance; the v3 path-keyed migration (closeout-6) made it
	// dispensable. paramValue / paramValueArmed now read directly off
	// v3Store + paramArming, and the standalone DeviceParameterStorage
	// class (kept for its dedicated tests) is no longer instantiated
	// here.
	//
	// Layer 3: FX Grid state lives as a module-level singleton in
	// fxGridStore.svelte.ts (audit hotspot #9). The facade methods below
	// delegate; this store no longer owns FX-grid state.

	// ===== PUBLIC ACCESSORS =====

	get trackIndex() {
		return this._trackIndex;
	}

	/**
	 * PR-3.5.2 (2026-04-15) — canonical trackPath for the currently
	 * selected track, matching the v3 wire grammar in [04 §2.1](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#2-path-grammar):
	 *
	 * - `_trackIndex >= 0`  → `tracks/<N>`
	 * - `_trackIndex === -1` → `master`
	 *
	 * Returns tracks are not reachable via the current v2 selection
	 * pipeline; when Phase 3.5 grows a dedicated track-select wire
	 * handler this getter gains the `returns/<N>` branch.
	 *
	 * Selection itself is still sourced from the v2 / Max4Live
	 * pipeline (`handleDeviceList`, `handleCompleteDeviceState`) —
	 * v3 doesn't carry a "selected track" concept. Per the PR-3.5.0
	 * gap-table row 4 decision: `selectedTrackPath` is owned by the
	 * UI, not `v3Store`. This getter is the path-keyed façade the
	 * downstream `$derived` views (starting with `devicesByPath`)
	 * compose against, so migrated consumers stop reading
	 * `_trackIndex` through v2-cached state.
	 */
	get selectedTrackPath(): string {
		return this._trackIndex === -1 ? 'master' : `tracks/${this._trackIndex}`;
	}

	/**
	 * PR-3.5.3 (2026-04-16) — derived track type for view switching
	 * decisions. Reads `hasMidiInput` / `hasAudioInput` directly off the
	 * v3 `TrackRecord` for the currently-selected `selectedTrackPath`.
	 * No v2 fallback.
	 *
	 * Returns `null` when the v3 tree hasn't populated this track yet
	 * (cold-start before state/full lands, or an invalidated subtree
	 * with a fresh fetch pending). Same posture as `paramValue` /
	 * `devicesByPath` on miss.
	 *
	 * Note: Tracks with both MIDI and audio inputs (e.g., External
	 * Instrument) are treated as MIDI since they can host instruments
	 * — matches v2 semantics. Master has neither flag and resolves to
	 * `null`. **Group Tracks do NOT** — a group reports
	 * `hasAudioInput === true` (verified against Live 12.4.5b8), so
	 * without the explicit `isFoldable` gate below a selected group
	 * would classify as an audio track and open an audio-track view
	 * over a track that can hold neither instrument nor clip (ADR-410).
	 * The doctrine in
	 * [04 §5.1](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#51-what-goes-on-which-record)
	 * is that the wire carries the raw LOM bits; classification is the
	 * UI's job.
	 *
	 * Reactive dependencies: `v3Store.tracks` (rebuilt on every
	 * state/full) and `_trackIndex` (mutated by selection handlers).
	 */
	get trackType(): 'midi' | 'audio' | null {
		const track = v3Store.tracks.get(this.selectedTrackPath);
		if (!track) return null;
		if (track.isFoldable) return null;
		if (track.hasMidiInput) return 'midi';
		if (track.hasAudioInput) return 'audio';
		return null;
	}

	/** ADR-410 — true when the selected track is a Live Group Track. */
	get isGroupTrack(): boolean {
		return v3Store.tracks.get(this.selectedTrackPath)?.isFoldable ?? false;
	}

	/**
	 * PR-3.5.2 (2026-04-15) — path-keyed device list for the currently
	 * selected track. `$derived` over
	 * `v3Store.tracks.get(selectedTrackPath).devices`; no v2 fallback.
	 *
	 * Returns `[]` when the v3 tree hasn't populated this track yet
	 * (cold-start before state/full, or the path was invalidated and a
	 * new state/full is pending). Consumers that need "has devices"
	 * should check `.length > 0`; ones that need a specific chain
	 * position should index directly (`devicesByPath[N]`) — the Map's
	 * insertion order mirrors LOM chain order per
	 * [normalized.svelte.ts:72-74](../v3/normalized.svelte.ts#L72-L74),
	 * so `devicesByPath[N]` is the device at chain index N.
	 *
	 * Each entry is a `DeviceRecord` (not the v2 `Device` shape):
	 * `{ devicePath, name, className, params }`. There is no `.id` /
	 * `.index` / `.legacyId` on a `DeviceRecord` — those are v2 fields
	 * that `devicePath` supersedes. Callers that need chain position
	 * can derive it from `devicePath` (the trailing segment) or use
	 * the array index they're already iterating over. Callers that
	 * need the Python-space `.id` for a deprecated v2 wire address
	 * should stay on {@link devices} until their callsite migrates.
	 *
	 * Reactive dependencies: `v3Store.tracks` (rebuilt on every
	 * state/full) and `_trackIndex` (mutated by selection handlers).
	 *
	 * @see selectedTrackPath for the track address this composes against.
	 */
	get devicesByPath(): DeviceRecord[] {
		const track = v3Store.tracks.get(this.selectedTrackPath);
		if (!track) return [];
		return Array.from(track.devices.values());
	}

	/**
	 * PR-3.5.5 (2026-04-16) — path-keyed Audio Effect Rack lookup for the
	 * currently selected track. Scans `v3Store.tracks.get(selectedTrackPath)
	 * ?.devices` for the first `DeviceRecord` with
	 * `className === 'AudioEffectGroupDevice'`. Returns `undefined` when
	 * no such device is present (the common case on non-master tracks)
	 * or when the v3 tree hasn't populated this track yet (cold start).
	 *
	 * At most one Audio Effect Rack per track by the project's
	 * convention — there's no `[0]` vs `[1]` ambiguity to resolve here.
	 *
	 * The returned record is a `DeviceRecord` (`devicePath` / `name` /
	 * `className` / `params`), not a v2 `ClassifiedDevice`: callers that
	 * previously read `.id` / `.index` off {@link audioEffectRack} must
	 * either stay on the deprecated getter or thread the `DeviceRecord`
	 * into {@link paramPath} / {@link paramNamesForDevice} / {@link paramValue}
	 * (all of which accept the `DeviceRecord` overload as of
	 * PR-3.5.2a / PR-3.5.4). That's the intended migration shape — the
	 * v2 identity fields vanish with v2 in Phase 4 PR-4a.
	 *
	 * Reactive dependencies: `v3Store.tracks` (rebuilt on every
	 * state/full) and `_trackIndex` (mutated by selection handlers) —
	 * same shape as {@link devicesByPath}, so preset swaps / device
	 * reorder / track switches all re-derive cleanly.
	 *
	 * @see devicesByPath for the full device list on the selected track.
	 * @see audioEffectRack for the deprecated v2-shape getter.
	 */
	get audioEffectRackByPath(): DeviceRecord | undefined {
		const track = v3Store.tracks.get(this.selectedTrackPath);
		if (!track) return undefined;
		for (const device of track.devices.values()) {
			if (device.className === 'AudioEffectGroupDevice') return device;
		}
		return undefined;
	}

	/**
	 * PR-3.5.5 (2026-04-16) — path-keyed sequencer (Permute) lookup for
	 * the currently selected track. Matches the same
	 * `className === 'MxDeviceAudioEffect' && name === DEVICE_PRESETS.sequencer.defaultName`
	 * predicate that {@link classifyDevice} uses, so the two getters
	 * agree about "which device is the sequencer" during the migration
	 * window. Returns `undefined` when no sequencer is loaded on the
	 * selected track or when the v3 tree is cold-start.
	 *
	 * Same DeviceRecord-vs-v2-Device posture as {@link audioEffectRackByPath}.
	 * Note that the sole current reader of this capability is
	 * [sequencerStore](./sequencerStore.svelte.ts), which threads
	 * `device.id` into nine `/looping/sequencer/*` M4L-space OSC senders
	 * — that file remains on the deprecated {@link sequencer} getter
	 * until PR-3.5.7-spec+impl migrates the sequencer wire to
	 * path-keyed addresses. This new getter is added now for
	 * call-site symmetry with {@link audioEffectRackByPath} and so
	 * future readers land on the v3-shape API.
	 *
	 * @see audioEffectRackByPath
	 * @see sequencer for the deprecated v2-shape getter.
	 */
	get sequencerByPath(): DeviceRecord | undefined {
		const track = v3Store.tracks.get(this.selectedTrackPath);
		if (!track) return undefined;
		const sequencerName = DEVICE_PRESETS.sequencer.defaultName;
		for (const device of track.devices.values()) {
			if (device.className === 'MxDeviceAudioEffect' && device.name === sequencerName) {
				return device;
			}
		}
		return undefined;
	}

	// ROW 5 (2026-04-21): deleted the deprecated `sequencer` getter
	// (v2-shape ClassifiedDevice) + `_idToLegacyId` side-table +
	// `ingestLegacyIds` + `idToLegacyId` getter. The M4L-served
	// `/looping/device/{select,move_appointed_*}` handlers that fed
	// on legacyId retired alongside the D-record field; the
	// path-keyed `sequencerByPath` getter is the sole remaining
	// sequencer accessor (sequencerStore reads it as `DeviceRecord`).

	// ===== EVENT HANDLERS (from Max4Live) =====

	/**
	 * Narrow writer for `_trackIndex`, decoupled from the device-list
	 * update path. Called by the v3 selected-track handler
	 * (`/looping/v3/selected_track`). Does NOT reset FX grid, slot
	 * registry, or parameter cache — track-switch side effects ride on
	 * the v3 state/full structural republish, which arrives after
	 * selection anyway.
	 */
	handleTrackSelected(trackIndex: number): void {
		if (trackIndex === this._trackIndex) return;
		logger.debug('Track selection via /looping/v3/selected_track', {
			from: this._trackIndex,
			to: trackIndex
		});
		this._trackIndex = trackIndex;
		fxGrid.resetForTrackChange();
		slotRegistry.resetForTrackChange();
		// Symmetry with fxGrid.resetForTrackChange: speculative entries
		// are cleared per-slot above, but armed entries (keyed by full
		// paramPath) belong to a different track and would otherwise
		// linger for ARM_TTL_MS. Clearing here removes the asymmetry —
		// see PR #401 review.
		resetParamArming();
		if (typeof window !== 'undefined') {
			window.dispatchEvent(
				new CustomEvent('track-changed', { detail: { trackIndex } })
			);
		}
	}

	/**
	 * The devices inside one drum pad's chain (issue #491, 3.8.0), in chain
	 * order. Read from the v3 store's separate pad map, never from the
	 * track's device list, so {@link devicesByPath}'s chain-index invariant
	 * holds.
	 *
	 * Two sources, each answering what it is good for. The presence row
	 * (`vm.padFx`, subscribed for as long as a Drum Rack is the selected
	 * instrument) says WHICH effects sit on the chain right now; the pad's
	 * map (its `pad-chain` bundle, refreshed only while `vm.padChain.<note>`
	 * is held) carries their records and values. Presence decides the list,
	 * and each entry is the map's record when the map has that device at
	 * that index, else a stand-in built from presence — a devicePath, a
	 * class and a name, with an empty params map, enough for a tile to read
	 * active and for a drag to compose a write. Before presence has been
	 * told, the map is all there is; before either, `[]`.
	 *
	 * The first cut let an existing map win outright, and a map is only
	 * fresh while its pad is subscribed: hold a pad once, lift, add a Reverb
	 * to it in Live, hold again — the tile read ghost until the cold read
	 * landed, the very window presence exists to cover (ADR-430), and a
	 * drag in that window loaded a second Reverb (code review, 2026-09-12).
	 */
	padDevices(padPath: string): DeviceRecord[] {
		const pad = parsePadPath(padPath);
		if (!pad) return [];
		const records = v3Store.padDevices.has(padPath) ? padDevicesAt(padPath) : null;
		const padFx = padFxParsed(this.propertyValue(pad.rackPath, VM_PAD_FX));
		if (padFx === null) return records ?? [];
		const stubs = padDeviceStubs(padFx, padPath, pad.note) as DeviceRecord[];
		if (!records) return stubs;
		const byPath = new Map(records.map((r) => [r.devicePath, r]));
		return stubs.map((stub) => {
			const record = byPath.get(stub.devicePath);
			// The map's record, unless a different class now sits at that
			// index (a hot-swap presence has seen and the map has not). A
			// presence row past its size cap drops names, so only the class
			// is compared.
			return record && record.className === stub.className ? record : stub;
		});
	}

	// ===== FX GRID API =====
	//
	// `scope` (issue #491) is a pad path while a tile or a view is scoped to
	// a held pad: the slot then matches against the pad's chain, a load
	// lands in it, and pending values drain into the device that arrives
	// there. Empty (the default) is the track, exactly as before.

	getFxGridSlot(slotKey: SlotKey, scope = ''): FXGridSlot {
		return fxGrid.getSlot(slotKey, scope);
	}

	loadFxGridDevice(slotKey: SlotKey, scope = ''): Promise<void> {
		return fxGrid.loadDevice(slotKey, scope);
	}

	storePendingParam(slotKey: SlotKey, paramIndex: number, value: number, scope = '') {
		fxGrid.storePendingParam(slotKey, paramIndex, value, scope);
	}

	// ===== PARAMETER API =====

	/**
	 * PR-3.5.1 (2026-04-15) — path-keyed parameter read.
	 *
	 * Reads directly from `v3Store.paramByPath`; no `deviceId`
	 * resolver, no v2 fallback. Returns `undefined` when the path
	 * isn't in the v3 tree yet (cold-start race before state/full
	 * lands, or an invalidated subtree). Callers that render sliders
	 * should treat `undefined` as "show ghost / loading" — same
	 * posture as the deprecated `getParameterValue` on miss, but
	 * without the silent fall-through to v2-populated state.
	 *
	 * Reactive dependency: `v3Store.paramByPath` is a `$derived.by`
	 * rebuilt on every tree mutation, so accessing it here is what
	 * ties this method into Svelte's reactivity graph.
	 *
	 * @see setParamValue for the companion write path.
	 * @see paramPath for the `(Device, paramIndex)` composer.
	 */
	paramValue(paramPath: string): number | undefined {
		return v3Store.paramByPath.get(paramPath)?.value;
	}

	/**
	 * Read Live's GUI-formatted value string for a param ("440 Hz",
	 * "-12.0 dB", "1/4", "On"). Populated by `/looping/v3/param/display`
	 * fires, which the surface emits only while a path is "hot" (recent
	 * UI-driven `param/set` traffic). Returns `undefined` when no display
	 * fire has landed for this path yet — UI consumers should fall back
	 * to a local format of `value` + `unit`. Companion to {@link paramValue}.
	 */
	paramDisplay(paramPath: string): string | undefined {
		return v3Store.paramByPath.get(paramPath)?.displayValue;
	}

	/**
	 * PR-3.5.1 (2026-04-15) — path-keyed parameter write.
	 *
	 * Sends `/looping/v3/param/set [paramPath, value, generation]`
	 * directly. Drops silently (no wire emission) when the v3 store
	 * has no accepted generation yet — writes before state/full
	 * would hit an unknown path on the surface anyway. The v3 tree
	 * will reconcile via echo-after-accept once the next state/full
	 * lands.
	 *
	 * Optimistically writes the value into `v3Store.paramByPath`
	 * before sending — `MutationComponent.on_param_value_changed`
	 * suppresses echoes for UI-armed pids to prevent jitter loops, so
	 * without the local write the store would stay stuck at the
	 * pre-write value for the duration of a drag. Mirrors the v2
	 * `deviceParameterStorage.sendParameter` pattern.
	 *
	 * ADR-001 vs ADR-002 (2026-04-16). ADR-001 first landed this
	 * optimistic write as the XY-snap-back fix; it was necessary but
	 * not sufficient. The optimistic `applyParamValue` put the new
	 * value into the store, but under the pre-ADR-002 tree the POJO
	 * mutation fired no reactive signal — `$derived timeXValue` did
	 * not re-evaluate, the XY prop stayed stale, and `DeviceXY`'s
	 * pointerup `$effect` reassigned `localX = xValue` to the
	 * pre-drag value. ADR-002 converts the tree Maps to `SvelteMap`
	 * and reworks `applyParamValue` to re-insert via `.set()`, which
	 * is the actual reactivity source that makes the snap-back
	 * disappear. Both changes are load-bearing: ADR-002 makes the
	 * notification fire, ADR-001 is what gives it something to fire
	 * about during a surface-suppressed drag.
	 *
	 * @see paramValue for the companion read path.
	 */
	setParamValue(paramPath: string, value: number): Promise<void> {
		if (v3Store.generation === UNSET_GENERATION) {
			logger.debug('setParamValue dropped — v3 generation still UNSET', {
				paramPath
			});
			return Promise.resolve();
		}
		// Arm before optimistic apply: incoming echoes/state-fulls during
		// the round-trip won't overwrite our value until the surface's
		// confirmation echo matches (or the arm ages out). This is what
		// makes lossy-quantization controls (Echo, AutoPan) stay where
		// the finger left them — see paramArming.svelte for details.
		armParam(paramPath, value);
		applyParamValue(paramPath, value);
		send('/looping/v3/param/set', [paramPath, value, v3Store.generation]);
		return Promise.resolve();
	}

	/**
	 * Read the param value the UI should display: armed (in-flight UI
	 * write) wins over store, store wins over undefined. Used by FX
	 * components instead of `paramValue()` directly so the brief window
	 * between optimistic apply and the surface's confirmation echo
	 * stays consistent with what the user just gestured.
	 *
	 * Equivalent to `paramValue()` for paths the UI hasn't recently
	 * written — the armed entry is empty and the store wins. The cost
	 * is one Map lookup per read against `armed`.
	 */
	paramValueArmed(paramPath: string): number | undefined {
		const armed = getArmedValue(paramPath);
		if (armed !== undefined) return armed;
		return v3Store.paramByPath.get(paramPath)?.value;
	}

	/**
	 * Drop the arm for a path. Components call this on pointerup so the
	 * surface's authoritative value can flow back in. Without this the
	 * arm holds for `ARM_TTL_MS` (1500ms) — fine as a safety net but
	 * unnecessarily long for a finished gesture.
	 */
	disarmParamPath(paramPath: string): void {
		disarmParam(paramPath);
	}

	/**
	 * PR-3.5.7-impl (2026-04-16) — path-keyed device-property read.
	 *
	 * Returns the cached value for `(devicePath, propertyName)` from the
	 * v3 normalized store. `undefined` means "no value yet" — either the
	 * subscribe hasn't completed its cold-read echo, or the device path
	 * isn't in the store. Same shape as {@link paramValue}.
	 *
	 * **Subscription side-effect**: callers must mount
	 * {@link subscribeProperty} in an `$effect` so the manager refcounts
	 * correctly. Reading without subscribing returns whatever stale leaf
	 * happens to be in the store and never receives updates.
	 *
	 * Allowlisted properties only — see [PropertyComponent.ALLOWLIST].
	 * Reads of non-allowlisted names will perpetually return `undefined`
	 * because the surface refuses the subscribe.
	 *
	 * @see setPropertyValue write companion
	 * @see subscribeProperty `$effect`-cleanup helper
	 */
	propertyValue(devicePath: string, propertyName: string): OSCArg | undefined {
		return v3Store.deviceByPath.get(devicePath)?.properties.get(propertyName);
	}

	/**
	 * PR-3.5.7-impl (2026-04-16) — path-keyed device-property write.
	 *
	 * Sends `/looping/v3/property/set [devicePath, propertyName, value,
	 * generation]`. Drops silently when the v3 store has no accepted
	 * generation yet — same posture as {@link setParamValue}.
	 *
	 * Optimistically writes the value into the store before sending, so
	 * `$derived` consumers see the new value immediately. The surface's
	 * listener echo will reconcile (no-op if value matches; corrective
	 * `property/value` if rejected by `setattr` / out-of-range).
	 *
	 * @see propertyValue read companion
	 */
	setPropertyValue(
		devicePath: string,
		propertyName: string,
		value: OSCArg
	): Promise<void> {
		if (v3Store.generation === UNSET_GENERATION) {
			logger.debug('setPropertyValue dropped — v3 generation still UNSET', {
				devicePath,
				propertyName
			});
			return Promise.resolve();
		}
		applyPropertyValue(devicePath, propertyName, value);
		logger.debug('property/set TX', {
			devicePath,
			propertyName,
			value,
			generation: v3Store.generation
		});
		send('/looping/v3/property/set', [
			devicePath,
			propertyName,
			value,
			v3Store.generation
		]);
		return Promise.resolve();
	}

	/**
	 * PR-3.5.7-impl (2026-04-16) — `$effect`-cleanup helper for property
	 * subscription refcounting.
	 *
	 * Mount inside an `$effect` block alongside the `propertyValue` read:
	 *
	 * ```ts
	 * const value = $derived(selectedTrackStore.propertyValue(devicePath, 'sample.gain'));
	 * $effect(() => selectedTrackStore.subscribeProperty(devicePath, 'sample.gain'));
	 * ```
	 *
	 * The returned function is what Svelte 5's `$effect` invokes on
	 * teardown. The manager refcounts; first acquire fires
	 * `/looping/v3/property/subscribe`, last release fires
	 * `/looping/v3/property/unsubscribe`. State/invalidate cleans up
	 * dropped device paths separately — see
	 * [propertySubscriptions.releaseUnderPath].
	 */
	subscribeProperty(devicePath: string, propertyName: string): () => void {
		acquirePropertySubscription(devicePath, propertyName);
		return () => releasePropertySubscription(devicePath, propertyName);
	}

	/**
	 * PR-3.5.1 (2026-04-15) — compose a canonical paramPath from a
	 * Device record + paramIndex, or from an already-composed
	 * devicePath string.
	 *
	 * PR-3.5.2a (2026-04-15) — extended to accept a `DeviceRecord`
	 * (the v3 shape returned by {@link devicesByPath}), composing
	 * against the record's own `devicePath` — so consumers can thread
	 * the DeviceRecord they already have into `paramPath()` without
	 * reopening the Device lookup or crossing back through v2 state.
	 *
	 * Call sites differ in what they have in scope: UI components
	 * typically hold a `Device` object (and know the current track
	 * index via `selectedTrackStore.trackIndex`), while lower-level
	 * helpers that already carry a `devicePath` string can pass it
	 * through without reopening the Device lookup. Migrated consumers
	 * (PR-3.5.2a..n drain) hold a `DeviceRecord` from `devicesByPath`
	 * and pass it directly — the record's `devicePath` is the
	 * canonical trackRef, so the composer ignores `_trackIndex`
	 * entirely on that path. All three entry points converge on the
	 * `<trackPath>/devices/<N>/params/<N>` shape defined by
	 * [04 §2](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#2-path-grammar).
	 *
	 * The v2 `Device` overload composes against the currently
	 * selected track — that's load-bearing for Phase 3.5: v2 device
	 * identity doesn't carry a track address, so we rely on the
	 * selected-track composite for the trackRef. Master/return
	 * tracks are handled by trackType checks downstream as those
	 * capabilities migrate. The `DeviceRecord` overload has no such
	 * limitation: `devicePath` already encodes master/returns.
	 */
	paramPath(device: Device, paramIndex: number): string;
	paramPath(device: DeviceRecord, paramIndex: number): string;
	paramPath(device: Device | DeviceRecord, paramIndex: number): string;
	paramPath(devicePath: string, paramIndex: number): string;
	paramPath(
		deviceOrPath: Device | DeviceRecord | string,
		paramIndex: number
	): string {
		if (typeof deviceOrPath === 'string') {
			return `${deviceOrPath}/params/${paramIndex}`;
		}
		// DeviceRecord carries its own canonical devicePath; v2 Device
		// only carries a chain index, so it needs the selected trackPath.
		if ('devicePath' in deviceOrPath) {
			return `${deviceOrPath.devicePath}/params/${paramIndex}`;
		}
		const trackPath = `tracks/${this._trackIndex}`;
		return `${trackPath}/devices/${deviceOrPath.index}/params/${paramIndex}`;
	}

	/**
	 * PR-3.5.4 (2026-04-16) — path-keyed parameter-name read.
	 *
	 * Returns the display name for a single parameter at `paramPath`,
	 * or `undefined` when the path isn't in the v3 tree yet (cold-start
	 * race before state/full lands, invalidated subtree). Reads
	 * directly off `v3Store.paramByPath`; no `deviceId` resolver, no v2
	 * fallback, no Promise (the v2 method's `Promise<string[]>` was a
	 * bridge round-trip artifact that no longer exists — names ride
	 * every state/full chunk on the P record per
	 * [04 §5](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#5-state-full-tree-args-layout)).
	 *
	 * Reactive dependency: `v3Store.paramByPath` is a `$derived.by`
	 * rebuilt on every tree mutation, so accessing it here ties this
	 * method into Svelte's reactivity graph — a preset swap that bumps
	 * generation re-derives paramByPath, and consumers re-read the
	 * fresh names without a stale flash.
	 *
	 * @see paramNamesForDevice for the whole-device variant.
	 * @see paramValue for the value sibling.
	 */
	paramName(paramPath: string): string | undefined {
		return v3Store.paramByPath.get(paramPath)?.name;
	}

	/**
	 * The parameter's LOM range off the same P record, or `undefined`
	 * before the tree lands. A view that drives a raw-unit parameter
	 * from a 0..1 control (the Sampler row) maps through this rather
	 * than a hard-coded range.
	 */
	paramRange(paramPath: string): { min: number; max: number } | undefined {
		const rec = v3Store.paramByPath.get(paramPath);
		return rec ? { min: rec.min, max: rec.max } : undefined;
	}

	/**
	 * PR-3.5.4 (2026-04-16) — all parameter names for a device, indexed
	 * by paramIndex (the array position matches the LOM chain index).
	 *
	 * Returns `[]` when the requested device isn't in the v3 tree yet —
	 * same cold-start posture as {@link devicesByPath}. The order is
	 * the `DeviceRecord.params` Map's insertion order, which is the
	 * wire's record-emission order, which is paramIndex order
	 * (state/full emits `P` records depth-first in chain order — see
	 * [v3StateFull.ts](../api/handlers/v3StateFull.ts) parser, and
	 * [04 §5](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#5-state-full-tree-args-layout)
	 * wire spec). Synchronous because the data is in-store; the v2
	 * `getParameterNames(deviceId): Promise<string[]>` shape was a
	 * bridge-round-trip artifact and is replaced wholesale here.
	 *
	 * Overloads mirror {@link paramPath}: a `DeviceRecord` is the
	 * canonical v3 input (its `devicePath` IS the lookup key); a v2
	 * `Device` composes against the selected `_trackIndex` (load-
	 * bearing for Phase 3.5 mixed call sites — same trade-off
	 * documented on `paramPath(Device, …)`); a raw devicePath string
	 * lets lower-level helpers pass through without reopening the
	 * Device lookup. All three converge on `v3Store.deviceByPath`.
	 *
	 * @see paramName for the single-paramPath variant.
	 */
	paramNamesForDevice(device: Device): string[];
	paramNamesForDevice(device: DeviceRecord): string[];
	paramNamesForDevice(devicePath: string): string[];
	paramNamesForDevice(deviceOrPath: Device | DeviceRecord | string): string[];
	paramNamesForDevice(deviceOrPath: Device | DeviceRecord | string): string[] {
		let devicePath: string;
		if (typeof deviceOrPath === 'string') {
			devicePath = deviceOrPath;
		} else if ('devicePath' in deviceOrPath) {
			devicePath = deviceOrPath.devicePath;
		} else {
			// v2 Device: compose against `selectedTrackPath` (handles
			// `master` correctly for `_trackIndex === -1`), matching the
			// composition rule on `paramPath(Device, N)` modulo the
			// master fix. Same load-bearing trade-off documented there:
			// v2 device identity carries no track address, so the
			// selection composite supplies the trackRef.
			devicePath = `${this.selectedTrackPath}/devices/${deviceOrPath.index}`;
		}
		const record = v3Store.deviceByPath.get(devicePath);
		if (!record) return [];
		const out: string[] = [];
		for (const param of record.params.values()) {
			out.push(param.name);
		}
		return out;
	}

}

// Export singleton
export const selectedTrackStore = new SelectedTrackStore();

// FX Grid sibling singleton (audit hotspot #9). Constructed AFTER
// selectedTrackStore so the dep callbacks resolve. Re-exported from
// fxGridStore.svelte.ts so external callers can grab it without going
// through the selection facade.
export const fxGrid = new FXGridState({
	getDevices: () => selectedTrackStore.devicesByPath,
	getPadDevices: (padPath) => selectedTrackStore.padDevices(padPath),
	paramPath: (device, paramIndex) => selectedTrackStore.paramPath(device, paramIndex),
	setParamValue: (paramPath, value) => selectedTrackStore.setParamValue(paramPath, value),
	holdPadChain: (padPath) => {
		const pad = parsePadPath(padPath);
		return pad ? selectedTrackStore.subscribeProperty(pad.rackPath, vmPadChainProperty(pad.note)) : undefined;
	}
});

if (typeof window !== 'undefined' && import.meta.env.DEV) {
	(window as unknown as { selectedTrackStore: typeof selectedTrackStore }).selectedTrackStore = selectedTrackStore;
}
