/**
 * UI-armed parameter writes + speculative pre-load values.
 *
 * Replaces the ADR-140 / ADR-001 / ADR-002 stack of patches with a
 * single store-level mechanism. The component-local `$state` shadows
 * (`cutoffValue = $state(1)` mirroring the store via `$effect`) and the
 * separate `slot.pendingParams` Map both go away in favor of the
 * primitives here.
 *
 * Two concerns, one module:
 *
 * **Armed paths** — while the user is dragging a parameter, the UI is
 * authoritative. `armParam(path, value)` records what the UI last wrote
 * and `isArmed(path)` lets the v3-store reconciler skip overwrite-on-
 * echo until the surface confirms the round-trip (echo value matches
 * armed value) or the arm expires by TTL. This is the client-side mirror
 * of `MutationComponent.on_param_value_changed`'s server-side echo
 * suppression for hot pids.
 *
 * **Speculative writes** — when the user drags a ghost FX-grid slot,
 * the parameter path doesn't exist yet (the device hasn't been loaded).
 * `armSpeculative(slotKey, paramIndex, value)` stashes the intended
 * value keyed by slot. When the matching device finally lands in the
 * tree, `consumeSpeculative(slotKey, paramIndex)` reveals it so
 * `reconcileParams` can use it as the param's *initial* value (instead
 * of Live's just-loaded default). The handoff is invisible to readers:
 * the param appears in the store with the value the user wanted.
 *
 * No path prediction is needed — the slot key is the stable identity,
 * resolved to a path at device-arrival time by the FX-grid slot
 * registry. This subsumes the `slot.pendingParams` + `checkLoadingCompletion`
 * mechanism in `fxGridStore.svelte.ts` (which is now redundant and will
 * be removed in a follow-up step in this branch).
 */

import { SvelteMap } from 'svelte/reactivity';

// ============================================
// Armed paths
// ============================================

/**
 * How long an armed entry stays authoritative before stale incoming
 * values are allowed to overwrite the UI's last-written value. The
 * round-trip from UI → bridge → Python → Live → echo is typically
 * under 50ms; 1500ms is comfortable headroom for slow VST loads or
 * GC pauses without letting a forgotten arm pin a stale value
 * indefinitely.
 */
const ARM_TTL_MS = 1500;

/**
 * Tolerance for "echo matches armed value" comparison. Live quantizes
 * many params (Echo time → discrete steps, 4dB gain ladder, etc.); the
 * UI sends the unquantized request but receives the quantized echo.
 * If the echo is close to the armed value we treat the round-trip as
 * closed. Past the tolerance the echo wins (the user's input fell
 * outside Live's quantization grid).
 */
const ARM_MATCH_TOLERANCE = 1e-3;

interface ArmedEntry {
	value: number;
	ts: number;
}

const armed = new SvelteMap<string, ArmedEntry>();

/**
 * Mark `path` as UI-authoritative with the given last-written value.
 * Subsequent calls to {@link isArmed} return true until either the next
 * matching echo arrives via {@link reconcileEcho} or {@link ARM_TTL_MS}
 * elapses. Re-arming an already-armed path bumps the timestamp.
 */
export function armParam(path: string, value: number): void {
	const now = Date.now();
	// Prune here rather than in the readers. `armParam` runs from pointer
	// handlers (`selectedTrackStore.armParamPath`, `fxGridStore`), never
	// from inside a reaction, so mutating the SvelteMap is safe. The
	// readers below must stay pure — see their comments.
	for (const [key, entry] of armed) {
		if (now - entry.ts > ARM_TTL_MS) armed.delete(key);
	}
	armed.set(path, { value, ts: now });
}

/**
 * Drop the arm for `path`. Called on pointerup so a brief moment after
 * the gesture ends the store starts accepting echoes again, or on
 * external state change (track switch, device removed) where any
 * lingering arm would be stale by definition.
 */
export function disarmParam(path: string): void {
	armed.delete(path);
}

/**
 * True if `path` is currently UI-armed and the arm hasn't aged out.
 * The reconciler in `normalized.svelte.ts` consults this before
 * applying an incoming `param/value` echo: if armed and the echo
 * disagrees with the armed value past tolerance, the echo is dropped
 * (the UI's value wins). If the echo agrees, the arm is cleared and
 * the value is applied normally.
 */
export function isArmed(path: string): boolean {
	const entry = armed.get(path);
	if (!entry) return false;
	// PURE: no `armed.delete()` here. This is read from `$derived`
	// contexts, where mutating a `SvelteMap` throws `state_unsafe_mutation`
	// and tears down the reactive graph. Expired entries are reported as
	// not-armed and swept by `armParam` / `reconcileEcho`, both of which
	// run outside reactions.
	if (Date.now() - entry.ts > ARM_TTL_MS) return false;
	return true;
}

/**
 * Returns the armed value for `path`, or undefined if not armed (or
 * expired). Used by `paramValue()` reads to surface the user's intent
 * during the round-trip window even when the store's reconciler hasn't
 * been notified yet.
 */
export function getArmedValue(path: string): number | undefined {
	const entry = armed.get(path);
	if (!entry) return undefined;
	// PURE: see `isArmed`. This one matters most — it is reached from
	// ~140 `$derived` declarations across ~50 components via
	// `selectedTrackStore.paramValueArmed`, so a delete here throws
	// mid-set on any param whose arm reaches TTL.
	if (Date.now() - entry.ts > ARM_TTL_MS) return undefined;
	return entry.value;
}

/**
 * Decide whether an incoming echo for `path` with `incomingValue`
 * should be applied to the store. Returns:
 *
 * - `'apply'` — no arm, or the arm matched (round-trip closed; arm
 *   cleared as a side effect) — caller proceeds with the write.
 * - `'suppress'` — armed and the incoming value disagrees with what
 *   the UI sent. Caller drops the echo; the user's value stays.
 *
 * The suppress branch is what prevents the "lossy round-trip" jump
 * ADR-140 was avoiding: when Echo's continuous X=0.7 is round-tripped
 * to quantized 0.667, the echo arrives mid-drag, this function
 * returns 'suppress', and the visual stays at 0.7 until the user
 * lifts. On pointerup the component calls {@link disarmParam} and
 * the next echo (or the surface's resolved value) wins.
 */
export function reconcileEcho(path: string, incomingValue: number): 'apply' | 'suppress' {
	const entry = armed.get(path);
	if (!entry) return 'apply';
	if (Date.now() - entry.ts > ARM_TTL_MS) {
		armed.delete(path);
		return 'apply';
	}
	if (Math.abs(entry.value - incomingValue) <= ARM_MATCH_TOLERANCE) {
		armed.delete(path);
		return 'apply';
	}
	return 'suppress';
}

// ============================================
// Speculative writes (pre-load FX-grid slot values)
// ============================================

/**
 * Slot key as used by `fxGridStore` — a `PositionKey` like `fx1` or a
 * `DeviceTypeKey` like `filter`. Opaque string from this module's
 * perspective; the FX-grid layer is responsible for resolving the slot
 * to an `(expectedClassName, expectedDefaultName)` predicate that
 * matches the eventual device record.
 */
type SpeculativeKey = string;

interface SpeculativeEntry {
	/** paramIndex → value */
	values: Map<number, number>;
}

const speculative = new SvelteMap<SpeculativeKey, SpeculativeEntry>();

/**
 * Stash the user's pre-load gesture under a slot key. Survives until
 * either {@link consumeSpeculative} drains the entry on device arrival
 * or {@link clearSpeculativeForSlot} is called (track switch, slot
 * reset).
 *
 * Multiple param indices per slot accumulate — an XY drag stashes both
 * X and Y, a button press stashes one, etc.
 */
export function armSpeculative(
	slotKey: SpeculativeKey,
	paramIndex: number,
	value: number
): void {
	const entry = speculative.get(slotKey);
	if (entry) {
		entry.values.set(paramIndex, value);
		return;
	}
	const values = new Map<number, number>();
	values.set(paramIndex, value);
	speculative.set(slotKey, { values });
}

/**
 * Read (without consuming) the speculative value for a slot's param.
 * Used by component readers to display the user's intent immediately
 * after the gesture, before the device has arrived.
 */
export function peekSpeculative(
	slotKey: SpeculativeKey,
	paramIndex: number
): number | undefined {
	return speculative.get(slotKey)?.values.get(paramIndex);
}

/**
 * Consume all speculative values for a slot. Called by the FX-grid
 * arrival watcher when a matching device lands; the returned Map is
 * the seed used to override Live's just-loaded defaults in the new
 * `ParamRecord`s. The slot's entry is removed regardless of caller
 * use — speculative values have a single legitimate consumer.
 *
 * Returns `undefined` if the slot has no pending speculative values
 * (the user loaded the slot without dragging first — load Live's
 * defaults as normal).
 */
export function consumeSpeculative(slotKey: SpeculativeKey): Map<number, number> | undefined {
	const entry = speculative.get(slotKey);
	if (!entry) return undefined;
	speculative.delete(slotKey);
	return entry.values;
}

/**
 * Drop all speculative entries for `slotKey`. Called on track switch
 * (the user's gesture targeted a different track context) or on slot
 * reset (load failed / timed out and the slot returned to ghost).
 */
export function clearSpeculativeForSlot(slotKey: SpeculativeKey): void {
	speculative.delete(slotKey);
}

/**
 * Drop everything. Called on handshake reset / surface restart — any
 * armed or speculative state from the previous surface lifetime is
 * meaningless against the new tree.
 */
export function resetParamArming(): void {
	armed.clear();
	speculative.clear();
}

// ============================================
// Test introspection
// ============================================

/** Test-only: armed entry count. */
export function _armedCount(): number {
	return armed.size;
}

/** Test-only: speculative entry count. */
export function _speculativeCount(): number {
	return speculative.size;
}
