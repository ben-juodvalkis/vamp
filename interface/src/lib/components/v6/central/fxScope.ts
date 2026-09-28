/**
 * fxScope — which drum pad the FX grid's slots resolve against (issue
 * #491, 2026-09-10).
 *
 * Every effect central view finds its device through `useFxGridSlot`,
 * and every grid tile through `BaseDeviceControl`. Both read this
 * context. Set — by the FX grid while a pad is held on the selected
 * track's Drum Rack, and by the pad pane inside the Drum Rack view — the
 * consumer resolves its slot against the pad's chain, loads with the pad
 * as the target, and keeps its pending values in that pad's slot table.
 * With no ancestor setting it (a top-level effect view, the tiles when
 * nothing is held) the slot is the track's exactly as before. Same
 * components, two answers, decided by the mount point.
 *
 * The value is a **getter**, not a snapshot: the scoped pad changes while
 * a view stays mounted (a second finger, a latch moving), and a consumer
 * that captured the pad at mount would keep writing the old one. The
 * getter is expected to read reactive state, so a `$derived` over it
 * re-evaluates when the scope moves.
 */

import { getContext, setContext } from 'svelte';

export interface FxScope {
	/** The Drum Rack's device path (`tracks/2/devices/0`). */
	rackPath: string;
	/** The scoped pad's MIDI note. */
	note: number;
	/** `${rackPath}/pads/${note}` — the slot table key and the load target. */
	padPath: string;
	/** The pad's chain colour as an RGB int, or null (Live left it uncoloured). */
	color: number | null;
	/** The pad's name, for the scope chip; '' when the census dropped it. */
	name: string;
}

const KEY = Symbol('fxScope');

export type FxScopeGetter = () => FxScope | null;

/**
 * The one constructor. The router (for the FX grid) and the Drum Rack
 * view (for its pane) both build a scope from a rack path, a note and the
 * census's pad entry; two hand-written literals drifted into existence in
 * the first week and are collapsed here (code review, 2026-09-12).
 */
export function fxScopeFor(
	rackPath: string,
	note: number,
	pad: { color: number | null; name: string } | null | undefined
): FxScope {
	return {
		rackPath,
		note,
		padPath: `${rackPath}/pads/${note}`,
		color: pad?.color ?? null,
		name: pad?.name ?? ''
	};
}

/** Provide the scope to every slot consumer below this component. */
export function provideFxScope(get: FxScopeGetter): void {
	setContext<FxScopeGetter>(KEY, get);
}

/**
 * The scope getter an ancestor provided, or one that answers `null` —
 * the track — when nothing above cares about pads. Call during
 * component init, like any `getContext`.
 */
export function readFxScope(): FxScopeGetter {
	return getContext<FxScopeGetter | undefined>(KEY) ?? (() => null);
}
