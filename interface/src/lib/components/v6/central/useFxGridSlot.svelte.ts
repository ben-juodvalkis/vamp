/**
 * useFxGridSlot — shared rune helper for central views.
 *
 * Every device central view needs the same scaffolding: query the slot,
 * track ghost/loading state, fall back to a color, and dispatch
 * parameter writes through the ghost → loading → active state machine.
 * Without this helper each view re-implements ~30 lines of identical
 * boilerplate, and drift is invisible until something breaks (see the
 * `getParameterValue`/`setParameter` deprecation that left old views
 * compiling against APIs that no longer exist).
 *
 * Returns getters so the consumer's reactivity hooks into the slot's
 * `$derived` chain — direct field reads would snapshot.
 *
 * Property subscriptions (Hybrid Reverb's `ir_*`, etc.) are NOT covered
 * here. Subscriptions need a single multi-property `$effect` so the
 * teardown can release them as a batch when the devicePath changes;
 * forcing them through a per-property helper would either lose
 * reactivity or proliferate effects. Mount them inline in the view.
 */

import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import type { SlotKey } from '$lib/stores/v6/selectedTrackStore.svelte';
import type { FXGridSlot, FXGridCandidateDevice } from '$lib/stores/v6/fxGridStore.svelte';
import { familyScheme, schemeFromInk, type DeviceColorScheme } from '$lib/config/devicePresets';
import { deviceInk } from '$lib/utils/formatters/trackFormatters';
import { paintModeReactive } from '$lib/utils/paintMode.svelte';
import { selectedTrackInk } from '$lib/utils/selectedTrackInk';
import { readFxScope, type FxScope } from './fxScope';
import { sendParam } from '$lib/services/deviceParams';

// Every SlotKey has a DEVICE_PRESETS config, so this is a should-never-happen
// guard, not a per-view styling hook (views must not pass their own copies).
const FALLBACK_COLOR: DeviceColorScheme = familyScheme('pitchSeq');

export interface FxGridSlotHandle {
	readonly slot: FXGridSlot;
	readonly device: FXGridCandidateDevice | null;
	readonly devicePath: string | undefined;
	/** The pad this slot resolves against (issue #491), or null — the track. */
	readonly scope: FxScope | null;
	readonly isGhost: boolean;
	readonly isLoading: boolean;
	readonly color: DeviceColorScheme;
	/** Read a parameter; returns `undefined` until v3 state lands. */
	paramValue(paramIndex: number): number | undefined;
	/**
	 * Read Live's GUI-formatted display string for a parameter ("440 Hz",
	 * "1/4", "-12.0 dB"). Returns `undefined` until the surface has
	 * emitted at least one `/looping/v3/param/display` fire for this path
	 * — which only happens during active interaction. Consumers should
	 * fall back to a local format on `undefined`.
	 */
	paramDisplay(paramIndex: number): string | undefined;
	/**
	 * Write a parameter, routing through the ghost/loading/active state
	 * machine. Ghost: stores pending + triggers load. Loading: stores
	 * pending only. Active: sends immediately. Duplicate load triggers
	 * are de-duped by the slot's own `loadState`, so it's safe for this
	 * view and the FX-grid control to both drive the same slot.
	 */
	sendParam(paramIndex: number, value: number): void;
	/**
	 * Trigger a device load without writing a parameter. For tap-to-load
	 * views (Redux) that have no param to piggy-back on. No-op if not
	 * ghost, and a no-op if a load is already in flight.
	 */
	loadIfGhost(): void;
}

export function useFxGridSlot(
	slotKey: SlotKey,
	fallbackColor: DeviceColorScheme = FALLBACK_COLOR
): FxGridSlotHandle {
	// Issue #491: an ancestor (the FX grid under a hold, the Drum Rack
	// view's pane) may scope every slot below it to a drum pad. The getter
	// is read here, at init; the scope itself is reactive.
	const getScope = readFxScope();
	const scope = $derived(getScope());
	const scopeKey = $derived(scope?.padPath ?? '');
	const slot = $derived(selectedTrackStore.getFxGridSlot(slotKey, scopeKey));
	const device = $derived(slot.device);
	const devicePath = $derived(device?.devicePath);
	const isGhost = $derived(slot.state === 'ghost');
	const isLoading = $derived(slot.state === 'loading');
	// Calibration chokepoint (ADR-400): the scheme every view receives is
	// already deviceInk-normalized, so fx tiles, frames, and view interiors
	// agree. View-side trackInk twins become no-ops (family hexes are ink
	// fixed points). trackTint devices wear the focused track's ink instead.
	const color = $derived.by((): DeviceColorScheme => {
		if (slot.config?.trackTint) {
			const ink = selectedTrackInk();
			if (ink) return schemeFromInk(ink);
		}
		const raw = slot.config?.color ?? fallbackColor;
		const mode = paintModeReactive();
		return {
			primary: deviceInk(raw.primary, mode),
			secondary: raw.secondary,
			accent: deviceInk(raw.accent, mode)
		};
	});

	function paramValue(paramIndex: number): number | undefined {
		if (!device) return undefined;
		// `paramValueArmed` returns the UI-armed value during the
		// round-trip after a finger gesture, falling back to the v3
		// store. Without it, lossy-quantization controls (Echo time,
		// AutoPan rate) would visually snap to the surface's quantized
		// echo on pointerup. See paramArming.svelte for details.
		return selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, paramIndex));
	}

	function paramDisplay(paramIndex: number): string | undefined {
		if (!device) return undefined;
		return selectedTrackStore.paramDisplay(selectedTrackStore.paramPath(device, paramIndex));
	}

	// A ghost or loading slot holds the write until its device arrives
	// (services/deviceParams).
	function writeParam(paramIndex: number, value: number): void {
		void sendParam({ device, pending: { slotKey, scopeKey, isGhost, isLoading } }, paramIndex, value);
	}

	function loadIfGhost(): void {
		if (isGhost) {
			selectedTrackStore.loadFxGridDevice(slotKey, scopeKey);
		}
	}

	return {
		get slot() { return slot; },
		get device() { return device; },
		get devicePath() { return devicePath; },
		get scope() { return scope; },
		get isGhost() { return isGhost; },
		get isLoading() { return isLoading; },
		get color() { return color; },
		paramValue,
		paramDisplay,
		sendParam: writeParam,
		loadIfGhost
	};
}
