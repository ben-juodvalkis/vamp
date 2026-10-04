/**
 * FX Grid State Store
 * Manages the loading and state of FX grid devices (filters, delays, reverbs, etc.)
 *
 * Extracted from selectedTrackStore.svelte.ts for better modularity.
 * Uses dependency injection for accessing devices and setting parameters.
 */

import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';
import { DEVICE_PRESETS, deviceLoadArgs, loadKey } from '$lib/config/devicePresets';
import { slotRegistry } from './slotRegistry.svelte';
import { selectedTrackStore } from './selectedTrackStore.svelte';
import { setTrackName } from '$lib/services/trackCommands';
import type { PositionKey, DeviceTypeKey } from '$lib/config/fxGridLayout';
import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';
import { parsePadPath, scopeKeyOf } from '$lib/utils/padPaths';
import { setNewDeviceHook, v3Store } from '$lib/stores/v3/normalized.svelte';
import {
	armParam,
	armSpeculative,
	consumeSpeculative,
	clearSpeculativeForSlot
} from '$lib/stores/v3/paramArming.svelte';

// ===== TYPE DEFINITIONS =====

export type FXGridCandidateDevice = DeviceRecord;

interface FXGridSlotState {
	loadState: 'ghost' | 'loading' | 'error';
	error?: string;
	loadTimeout?: ReturnType<typeof setTimeout>;
	pendingParams?: Map<number, number>;
}

export interface FXGridSlot extends FXGridSlotState {
	device: FXGridCandidateDevice | null;
	state: 'ghost' | 'loading' | 'active' | 'error';
	config: typeof DEVICE_PRESETS[DeviceTypeKey];
}

/**
 * Dependencies required by FXGridState.
 *
 * closeout-6 (2026-04-17): migrated off v2 `Device[]` — callback now
 * returns v3 `DeviceRecord[]` (sourced from
 * `selectedTrackStore.devicesByPath`). Slot matching reads `className +
 * name`, both present on `DeviceRecord`. `paramPath` is typed against
 * the union because `handleDeviceAdded` still passes a v2 Device at
 * runtime until closeout-3 ships.
 */
export interface FXGridDependencies {
	/** Get the v3 DeviceRecord list on the currently selected track. */
	getDevices: () => DeviceRecord[];
	/** The devices inside one drum pad's chain (issue #491), by pad path. */
	getPadDevices: (padPath: string) => DeviceRecord[];
	/** Compose a canonical paramPath from a candidate device + paramIndex */
	paramPath: (device: FXGridCandidateDevice, paramIndex: number) => string;
	/** Write a parameter value by paramPath (path-keyed API, PR-3.5.1) */
	setParamValue: (paramPath: string, value: number) => Promise<void>;
	/**
	 * Hold a pad's chain row (`vm.padChain.<note>`) for as long as the
	 * returned release is not called (issue #491, from the code review):
	 * the store holds one for every pad with a load in flight, so the
	 * load can complete after the finger lifts. Optional so a bare store
	 * in a test needs no wire.
	 */
	holdPadChain?: (padPath: string) => (() => void) | undefined;
}

// ===== FX GRID STATE =====

/** Fill a slot table with every grid position and every virtual device at rest. */
function fillSlots(table: SvelteMap<PositionKey | DeviceTypeKey, FXGridSlotState>): void {
	// Grid devices, by position.
	slotRegistry.getAllSlots().forEach((_, position) => {
		table.set(position, {
			loadState: 'ghost',
			error: undefined,
			loadTimeout: undefined,
			pendingParams: undefined
		});
	});
	// Virtual devices, by device type — they have no grid position.
	Object.entries(DEVICE_PRESETS).forEach(([deviceType]) => {
		if (deviceType === 'sequencer') return; // Sequencer handled separately
		const position = slotRegistry.getPositionForDeviceType(deviceType as DeviceTypeKey);
		if (!position) {
			table.set(deviceType as DeviceTypeKey, {
				loadState: 'ghost',
				error: undefined,
				loadTimeout: undefined,
				pendingParams: undefined
			});
		}
	});
}

/** A slot nothing has touched: what every pad scope's slots read as until a load. */
const SLOT_AT_REST: Readonly<FXGridSlotState> = Object.freeze({
	loadState: 'ghost',
	error: undefined,
	loadTimeout: undefined,
	pendingParams: undefined
});

/** The speculative store's key for a slot in a scope: the slot key alone at track level. */
function speculativeKey(scope: string, slotKey: PositionKey | DeviceTypeKey): string {
	return scope ? `${scope}|${slotKey}` : slotKey;
}

export class FXGridState {
	// Map uses either position keys (fx1-fx15) OR device type keys (comb, chorus, etc.) for virtual devices
	//
	// `SvelteMap`, not `$state(new Map())`. Svelte's `proxy()` deep-proxies
	// plain objects and arrays only, so a Map inside `$state` is handed back
	// raw: reading the binding tracks it, but `.set()` and field writes on
	// the POJOs it holds emit no signal at all. Every slot transition here is
	// exactly that kind of write, so the whole ghost -> loading -> ghost
	// machine was invisible to its `$derived` consumers
	// (`useFxGridSlot.svelte.ts`, `BaseDeviceControl.svelte`). Same bug class
	// ADR-002 fixed in the v3 tree by moving to SvelteMap
	// (`normalized.svelte.ts:238-251`); it survived here.
	//
	// The corollary is that mutating a held slot object is still inert —
	// every write goes through `patchSlot`, which re-inserts.
	private slots = new SvelteMap<PositionKey | DeviceTypeKey, FXGridSlotState>();

	/**
	 * One slot table per pad scope (issue #491, 2026-09-10), keyed by pad
	 * path — the same shape as `slots`, created on first touch. A scope is
	 * where a tile's load and pending values land while a pad is held:
	 * the pad's chain, not the track. Slot state is never cleared on
	 * release — a load outlives a typical hold, so if the finger lifts
	 * before the device lands the grid is the track's again but the load
	 * still completes against the pad path and its pending values still
	 * drain. Only what the grid displays follows the finger.
	 */
	private scoped = new SvelteMap<string, SvelteMap<PositionKey | DeviceTypeKey, FXGridSlotState>>();

	private seenDevicePaths = new Set<string>();

	/** padPath → release, the chain rows held on behalf of loading pads. */
	private loadingPadHolds = new Map<string, () => void>();

	constructor(private deps: FXGridDependencies) {
		this.initializeSlots();
		this.watchDeviceArrivals();
		this.watchLoadingPads();
		this.registerNewDeviceHook();
	}

	/**
	 * Register a hook with the v3 store that runs on every new-device
	 * insertion (state/full or scoped merge). Drains pre-load speculative
	 * values for the matching slot so the just-arrived ParamRecords carry
	 * the user's intent — not Live's fresh-load defaults — by the time
	 * any reactive consumer observes them. Closes the
	 * AutoFilter-style snap-back race where the component's
	 * `$effect`-driven read fires *before* `checkLoadingCompletion`'s
	 * pending drain has applied the value.
	 *
	 * Returns the override Map for the v3 reconciler to splice into the
	 * device's params before sealing the insert. Also fires the OSC
	 * `param/set` writes here so Live converges to the user-intended
	 * values; arming inside `setParamValue` prevents the surface's
	 * subsequent echo from re-applying its pre-write value.
	 */
	private registerNewDeviceHook(): void {
		setNewDeviceHook((device) => {
			const slotKey = this.matchDeviceToSlot(device);
			if (!slotKey) return undefined;
			const speculative = consumeSpeculative(speculativeKey(scopeKeyOf(device.devicePath), slotKey));
			if (!speculative || speculative.size === 0) return undefined;
			// Send OSC writes so Live applies the user's intent. The arm
			// inside setParamValue suppresses the echo that would
			// otherwise overwrite our seeded value with Live's pre-write
			// state. We can't call `this.deps.setParamValue` here because
			// its applyParamValue would no-op (the device's params Map
			// hasn't been reactively published yet); we send the wire
			// directly and arm by hand. The seeded value the hook returns
			// covers the optimistic local read.
			for (const [paramIndex, value] of speculative) {
				const paramPath = `${device.devicePath}/params/${paramIndex}`;
				armParam(paramPath, value);
				if (v3Store.generation !== 0) {
					send('/looping/v3/param/set', [paramPath, value, v3Store.generation]);
				}
			}
			return speculative;
		});
	}

	/**
	 * Resolve a slot map key (a position like "fx1" OR a device-type key
	 * like "compressor") to its DEVICE_PRESETS config, or undefined when
	 * the key maps to no device type / has no preset config. Single source
	 * for the position-vs-device-type resolution the slot-scanning loops
	 * (`matchDeviceToSlot`, `checkLoadingCompletion`, `handleLoadFailed`)
	 * all share.
	 */
	private slotKeyConfig(
		key: PositionKey | DeviceTypeKey
	): (typeof DEVICE_PRESETS)[DeviceTypeKey] | undefined {
		const fromPosition = slotRegistry.getDeviceTypeForPosition(key as PositionKey);
		const deviceType: DeviceTypeKey | undefined = fromPosition
			? fromPosition
			: DEVICE_PRESETS[key as DeviceTypeKey]
				? (key as DeviceTypeKey)
				: undefined;
		if (!deviceType) return undefined;
		return DEVICE_PRESETS[deviceType];
	}

	/**
	 * Resolve a DeviceRecord to its FX-grid slot key, or undefined if
	 * the device isn't in the FX-grid mapping. Mirrors the matching
	 * predicate used elsewhere (`expectedClassName + defaultName`).
	 */
	private matchDeviceToSlot(device: DeviceRecord): PositionKey | DeviceTypeKey | undefined {
		for (const [slotKey] of this.slots) {
			const config = this.slotKeyConfig(slotKey);
			if (!config) continue;
			if (
				device.className === config.expectedClassName &&
				device.name === config.defaultName
			) {
				return slotKey;
			}
		}
		return undefined;
	}

	/** Resolve a PositionKey or DeviceTypeKey to the canonical slot key
	 *  and device type used for slot map lookups. Throws on unknown input. */
	private resolveSlotKey(positionOrDeviceType: PositionKey | DeviceTypeKey): {
		slotKey: PositionKey | DeviceTypeKey;
		deviceType: DeviceTypeKey;
	} {
		const slotByPosition = slotRegistry.getAllSlots().get(positionOrDeviceType as PositionKey);
		if (slotByPosition) {
			const position = positionOrDeviceType as PositionKey;
			const foundDeviceType = slotRegistry.getDeviceTypeForPosition(position);
			if (!foundDeviceType) {
				throw new Error(`[FXGridState] Position ${position} has no device type mapping`);
			}
			return { slotKey: position, deviceType: foundDeviceType };
		}
		const foundPosition = slotRegistry.getPositionForDeviceType(positionOrDeviceType as DeviceTypeKey);
		if (foundPosition) {
			return { slotKey: foundPosition, deviceType: positionOrDeviceType as DeviceTypeKey };
		}
		if (!DEVICE_PRESETS[positionOrDeviceType as DeviceTypeKey]) {
			throw new Error(`[FXGridState] Unknown device type: ${positionOrDeviceType}`);
		}
		return { slotKey: positionOrDeviceType as DeviceTypeKey, deviceType: positionOrDeviceType as DeviceTypeKey };
	}

	/**
	 * Drain pending params when a queued FX-grid device arrives.
	 *
	 * Pre-load XY/slider gestures stash values in `slot.pendingParams` via
	 * `storePendingParam()`. When the device finally appears in the v3
	 * tree, `checkLoadingCompletion()` writes those values to Live and
	 * clears the queue. Without this watcher, the queue fills but never
	 * drains and the user's pre-load gesture is silently lost.
	 *
	 * Rising-edge only: tracks `devicePath`s seen on previous ticks and
	 * fires `checkLoadingCompletion` per newly-appeared device. v3's
	 * generation guard handles the race where init-rules and our pending
	 * write contend for the same param — init-rules apply first (Python
	 * surface defers them to next tick before scope-emitting state/full),
	 * so our pending write correctly overrides preset defaults.
	 */
	/**
	 * Hold a chain row for every pad with a load in flight (issue #491,
	 * from the code review). A pad-scoped load completes against the
	 * pad's map, and the map only refreshes while `vm.padChain.<note>` is
	 * subscribed — the scope effects release it on lift, so a finger that
	 * lifted inside the surface's 150 ms composite window left the slot
	 * `loading` until the timeout with the drag's values parked. Lives in
	 * the store's own effect root rather than a component, so no section
	 * has to be on screen; the holds are diffed per pad, so a second
	 * pad's load never re-subscribes the first. The manager refcounts
	 * with the scope effects, and `acquire` / `release` are untracked so
	 * the wire's bookkeeping cannot feed back into this effect.
	 *
	 * A pad is held only while its rack path still holds a Drum Rack in
	 * the tree. The surface tears a property row down when something else
	 * sits at its path (a MIDI effect loaded through the browser fallback
	 * transits the track at index 0 for ~200 ms, and the rack is
	 * `devices/1` meanwhile — ADR-430's follow-up), and it tells the UI
	 * nothing: the manager only learns from a release that reaches zero
	 * and an acquire that leaves it. With this hold pinning the count, the
	 * FX grid's own release and re-acquire around the transit went 2→1→2
	 * and no `property/subscribe` ever left, so the pad's records never
	 * came back and the load waited out its timeout. Dropping the hold
	 * while the rack is away lets the count reach zero, and re-acquiring
	 * when it returns sends the subscribe the surface needs (code review,
	 * 2026-09-12).
	 */
	private watchLoadingPads() {
		$effect.root(() => {
			$effect(() => {
				const racks = new Set(
					this.deps.getDevices()
						.filter((d) => d.className === 'DrumGroupDevice')
						.map((d) => d.devicePath)
				);
				const wanted = new Set(
					this.loadingPadScopes().filter((padPath) => {
						const rackPath = parsePadPath(padPath)?.rackPath;
						return rackPath !== undefined && racks.has(rackPath);
					})
				);
				untrack(() => {
					for (const [padPath, release] of [...this.loadingPadHolds]) {
						if (wanted.has(padPath)) continue;
						this.loadingPadHolds.delete(padPath);
						release();
					}
					for (const padPath of wanted) {
						if (this.loadingPadHolds.has(padPath)) continue;
						const release = this.deps.holdPadChain?.(padPath);
						if (release) this.loadingPadHolds.set(padPath, release);
					}
				});
			});
		});
	}

	private watchDeviceArrivals() {
		$effect.root(() => {
			$effect(() => {
				// The track's devices, and every subscribed pad's (issue #491):
				// a pad-scoped load completes against the pad's own map.
				const devices = [...this.deps.getDevices()];
				for (const padPath of this.scoped.keys()) devices.push(...this.deps.getPadDevices(padPath));
				// Built from the list in one expression, not an empty `new Set()` filled
				// in the loop: esbuild tags an empty `new Set()` `/* @__PURE__ */`, and
				// Svelte's server build strips this effect body but leaves that tag
				// behind, dangling before the closing brace — which Rollup reported on
				// every build as an INVALID_ANNOTATION plus "Error when using sourcemap
				// for reporting an error" (2026-09-24). Same set, same checks.
				const currentPaths = new Set<string>(devices.map((device) => device.devicePath));
				for (const device of devices) {
					if (!this.seenDevicePaths.has(device.devicePath)) {
						this.checkLoadingCompletion(device);
					}
				}
				this.seenDevicePaths = currentPaths;
			});
		});
	}

	/**
	 * Replace a slot with a patched copy so `SvelteMap` fires its readers.
	 *
	 * Mutating the held object (`slot.loadState = 'loading'`) is a no-op for
	 * reactivity — the map only signals on `set`/`delete`.
	 */
	private patchSlot(
		slotKey: PositionKey | DeviceTypeKey,
		patch: Partial<FXGridSlotState>,
		scope = ''
	): void {
		const table = this.table(scope);
		const current = table.get(slotKey);
		if (!current) return;
		table.set(slotKey, { ...current, ...patch });
	}

	/**
	 * The slot table for a scope on a WRITE path: the track's (`''`), or a
	 * pad's, made on first touch. Never call this from a `$derived` — creating
	 * a table is a state mutation, and Svelte refuses one inside a derived
	 * (`state_unsafe_mutation`); reads go through `tableFor`.
	 */
	private table(scope: string): SvelteMap<PositionKey | DeviceTypeKey, FXGridSlotState> {
		if (!scope) return this.slots;
		let table = this.scoped.get(scope);
		if (!table) {
			table = new SvelteMap<PositionKey | DeviceTypeKey, FXGridSlotState>();
			fillSlots(table);
			this.scoped.set(scope, table);
		}
		return table;
	}

	/** The slot table for a scope on a READ path: `undefined` for a pad nothing has touched yet. */
	private tableFor(scope: string): SvelteMap<PositionKey | DeviceTypeKey, FXGridSlotState> | undefined {
		return scope ? this.scoped.get(scope) : this.slots;
	}

	/** The devices a scope's slots match against. */
	private devicesIn(scope: string): DeviceRecord[] {
		return scope ? this.deps.getPadDevices(scope) : this.deps.getDevices();
	}

	private initializeSlots() {
		fillSlots(this.slots);
	}

	getSlot(positionOrDeviceType: PositionKey | DeviceTypeKey, scope = ''): FXGridSlot {
		const { slotKey, deviceType } = this.resolveSlotKey(positionOrDeviceType);

		// A pad scope nothing has loaded into yet has no table; its slots are
		// at rest. Reading must not create the table — see `table`.
		const table = this.tableFor(scope);
		const slot = table ? table.get(slotKey) : SLOT_AT_REST;
		if (!slot) {
			throw new Error(`[FXGridState] Slot not found for key: ${slotKey}`);
		}

		const config = DEVICE_PRESETS[deviceType];
		if (!config) {
			throw new Error(`[FXGridState] No config found for device type: ${deviceType}`);
		}

		// Find device from the scope's chain: the track's, or the pad's.
		const devices = this.devicesIn(scope);
		const device =
			devices.find(
				(d) => d.className === config.expectedClassName && d.name === config.defaultName
			) || null;

		return {
			...slot,
			device,
			state: device ? 'active' : slot.loadState,
			config
		};
	}

	/**
	 * Load the slot's preset. **The slot's own `loadState` is the single
	 * guard against duplicate loads** — callers must not keep their own
	 * "did I already trigger this" flag.
	 *
	 * Why this matters (2026-07-29): a slot can have several live
	 * consumers at once — the FX-grid control *and* a central view, which
	 * `VariationControl` mounts mid-drag by calling `setView` on the first
	 * interaction frame. When each consumer owned a private
	 * `loadingInitiated`, the freshly-mounted view saw `isGhost` still
	 * true (the load hadn't resolved), reset its own flag, and re-entered
	 * `loadDevice` on subsequent drag frames. The second call hit the
	 * `loading` early-return, so the load was silently dropped and the
	 * preset never appeared — while the drag's params still queued as
	 * pending. Slot-owned state makes the duplicate call a no-op instead
	 * of a lost load.
	 */
	async loadDevice(positionOrDeviceType: PositionKey | DeviceTypeKey, scope = ''): Promise<void> {
		const { slotKey, deviceType } = this.resolveSlotKey(positionOrDeviceType);

		const slot = this.table(scope).get(slotKey)!;
		const config = DEVICE_PRESETS[deviceType];

		if (slot.loadState === 'loading') {
			return;
		}

		// Already-present device: nothing to load. Without this, a consumer
		// that re-triggers after the device arrives would flip a live slot
		// back to `loading` and strand it until the 10s timeout.
		if (this.getSlot(slotKey, scope).device) {
			return;
		}

		this.patchSlot(slotKey, { loadState: 'loading', error: undefined }, scope);

		// Clear any existing timeout to prevent leaks if loadDevice is called rapidly
		if (slot.loadTimeout) {
			clearTimeout(slot.loadTimeout);
		}

		// 10s timeout. Revert to `ghost` (not `error`) so the device
		// control's `isGhost || isLoading` gate lets the next drag retry —
		// the `error` state is never rendered and would strand the slot
		// permanently (e.g. a load that silently never produces a device,
		// emitting no `/looping/v3/error` for handleLoadFailed to catch).
		// Re-read inside the callback: `slot` was captured before the patch
		// above replaced it, so the captured object's `loadState` is stale.
		const loadTimeout = setTimeout(() => {
			if (this.table(scope).get(slotKey)?.loadState === 'loading') {
				this.patchSlot(slotKey, { loadState: 'ghost', error: undefined }, scope);
			}
		}, 10000);
		this.patchSlot(slotKey, { loadTimeout }, scope);

		// The second argument is the pad path under a scope (issue #491,
		// 3.8.0): the surface loads INTO that pad's chain. Empty, the load
		// lands on the track as it always has.
		await send('/looping/v3/device/load', deviceLoadArgs(selectedTrackStore.selectedTrackPath, scope, config));
		if (scope) return; // a pad's effect never renames the track

		// Rename track when loading guitar or bass effect.
		// ROW 5 (2026-04-21): retargeted from `/cmd/rename_selected_track`
		// (M4L, implicitly-selected) to the path-addressed v3
		// `/looping/v3/track/name [trackPath, name]` on
		// TrackMetadataComponent. Only regular-track paths are writable;
		// master is `path-not-supported` on the Python side and we skip
		// the send so the wire stays clean.
		// The Bass rack's name is "Bass Amp" (defaultName), so we label
		// the track "Bass" directly instead of reusing config.defaultName.
		// Only audio tracks are renamed — adding a guitar/bass effect to a
		// MIDI track (e.g. a Mic track) leaves its existing name intact.
		if (deviceType === 'guitar' || deviceType === 'bass') {
			const trackPath = selectedTrackStore.selectedTrackPath;
			if (trackPath.startsWith('tracks/') && selectedTrackStore.trackType === 'audio') {
				const trackName = deviceType === 'bass' ? 'Bass' : config.defaultName;
				setTrackName(trackPath, trackName);
			}
		}
	}

	/**
	 * The pad paths with a load in flight (issue #491, from the code
	 * review): the grid keeps each one's chain row subscribed until the
	 * load lands or fails, because a pad-scoped load completes against
	 * the pad's map and that map only refreshes while the row is held —
	 * a finger that lifted before the device landed used to leave the
	 * slot `loading` until the timeout, its values parked.
	 */
	loadingPadScopes(): string[] {
		const out: string[] = [];
		for (const [scope, table] of this.scoped.entries()) {
			for (const slot of table.values()) {
				if (slot.loadState === 'loading') {
					out.push(scope);
					break;
				}
			}
		}
		return out;
	}

	checkLoadingCompletion(device: FXGridCandidateDevice) {
		// A device arriving inside a pad chain completes that pad's slot,
		// never the track's — a track-level Reverb landing while a pad-scope
		// Reverb load is pending must not complete the wrong slot (issue #491).
		const scope = scopeKeyOf(device.devicePath);
		if (scope && !this.scoped.has(scope)) return;
		for (const [key, slot] of this.table(scope).entries()) {
			const config = this.slotKeyConfig(key);
			if (!config) continue;

			if (
				slot.loadState === 'loading' &&
				device.className === config.expectedClassName &&
				device.name === config.defaultName
			) {
				// Clear timeout
				if (slot.loadTimeout) {
					clearTimeout(slot.loadTimeout);
				}

				// Apply pending params
				if (slot.pendingParams) {
					slot.pendingParams.forEach((value, paramIdx) => {
						this.deps.setParamValue(this.deps.paramPath(device, paramIdx), value);
					});
				}

				this.patchSlot(key, {
					loadTimeout: undefined,
					pendingParams: undefined,
					loadState: 'ghost' // Will show as 'active' due to device match
				}, scope);
				break;
			}
		}
	}

	storePendingParam(positionOrDeviceType: PositionKey | DeviceTypeKey, paramIndex: number, value: number, scope = '') {
		const { slotKey } = this.resolveSlotKey(positionOrDeviceType);

		const slot = this.table(scope).get(slotKey)!;

		// New Map + re-insert: mutating the held one signals nothing.
		const pendingParams = new Map(slot.pendingParams ?? []);
		pendingParams.set(paramIndex, value);
		this.patchSlot(slotKey, { pendingParams }, scope);
		// Mirror to the v3-level speculative store so the new-device hook
		// can seed the just-arrived ParamRecords with the user's intent.
		// The two stores converge on the same drain: the hook consumes
		// from speculative (seeding params + arming + sending OSC); the
		// existing checkLoadingCompletion drains from pendingParams (legacy
		// path). Once AutoFilter validates we'll collapse pendingParams.
		armSpeculative(speculativeKey(scope, slotKey), paramIndex, value);
	}

	/**
	 * Reset a slot stuck in `loading`/`error` back to `ghost` after the
	 * surface rejects a `/looping/v3/device/load`. Without this the slot
	 * waits out the 10s load timeout (or stays `error` forever) and the
	 * device control's `isGhost || isLoading` interaction gate never
	 * re-fires a load — the device becomes permanently un-loadable until
	 * a track change. Matches the failed load's key (carried in the
	 * `/looping/v3/error` `path` field: the preset's path, or a native
	 * device's `native:<class>`) against each slot's config.
	 */
	handleLoadFailed(presetPath: string, scope = '') {
		if (!presetPath) return;
		if (scope && !this.scoped.has(scope)) return;
		for (const [key, slot] of this.table(scope).entries()) {
			const config = this.slotKeyConfig(key);
			if (!config || loadKey(config) !== presetPath) continue;

			if (slot.loadTimeout) {
				clearTimeout(slot.loadTimeout);
			}
			this.patchSlot(key, {
				loadTimeout: undefined,
				loadState: 'ghost',
				error: undefined
			}, scope);
			break;
		}
	}

	resetForTrackChange() {
		for (const [slotKey, slot] of this.slots) {
			if (slot.loadTimeout) {
				clearTimeout(slot.loadTimeout);
			}
			this.patchSlot(slotKey, {
				loadState: 'ghost',
				error: undefined,
				loadTimeout: undefined,
				pendingParams: undefined
			});
			clearSpeculativeForSlot(slotKey);
		}
		// Every pad scope goes with the track it belonged to.
		for (const [scope, table] of this.scoped) {
			for (const [slotKey, slot] of table) {
				if (slot.loadTimeout) clearTimeout(slot.loadTimeout);
				clearSpeculativeForSlot(speculativeKey(scope, slotKey));
			}
		}
		this.scoped.clear();
		this.seenDevicePaths.clear();
	}

	findSlotForDevice(device: FXGridCandidateDevice): { position: PositionKey; deviceType: DeviceTypeKey } | null {
		// Use slotRegistry to find matching slot
		for (const [position, slotStore] of slotRegistry.getAllSlots().entries()) {
			const config = slotStore.config;
			if (device.className === config.expectedClassName && device.name === config.defaultName) {
				const deviceType = slotRegistry.getDeviceTypeForPosition(position);
				if (deviceType) {
					return { position, deviceType };
				}
			}
		}
		return null;
	}
}

// ============================================
// Module-level singleton (audit hotspot #9)
//
// FXGridState was previously instantiated as `private fxGrid = new
// FXGridState(...)` inside SelectedTrackStore — it owned a layer of
// state orthogonal to selection. It now lives as a sibling singleton
// constructed in `selectedTrackStore.svelte.ts` (which already owns
// the imports + has selectedTrackStore in scope).
//
// Construction lives in selectedTrackStore.svelte.ts because
// FXGridState's constructor synchronously runs `$effect` rooted in
// `watchDeviceArrivals`, which calls `getDevices` immediately —
// instantiating it here would crash at module init (the import cycle
// leaves selectedTrackStore undefined when the first reactive flush
// fires).
//
// Runtime consumers import `fxGrid` directly from
// `./selectedTrackStore.svelte`. A `export { fxGrid } from
// './selectedTrackStore.svelte'` re-export here would create a TDZ in
// the SSR production bundle: Rollup hoists the namespace object for
// this module above selectedTrackStore's body, then reads `fxGrid`
// eagerly before its `new FXGridState(...)` initializer runs.
// ============================================
