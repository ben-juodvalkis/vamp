/**
 * valueBox — every slider in a central view is a value box (ADR-477).
 *
 * A `DeviceSlider` sweeps its rail over its own length, so its precision
 * is its size. Under `CentralDisplay` it sweeps over its own length or
 * `constants.ui.gestures.valueBoxTravelPx`, whichever is longer, and its
 * label stands upright, so a half-height box is as fine as the tall fader
 * it replaces and reads as a box rather than a fader on its side. A slider
 * still decides for itself through its own `travel` and `labelOrientation`.
 *
 * Decided by the mount point, like `fxScope`: the FX grid's tiles have no
 * `CentralDisplay` above them and keep sweeping over their own length.
 */

import { getContext, setContext } from 'svelte';
import constants from '$config/constants.json';

/** Finger travel, in px, that sweeps a value box's whole range. */
export const VALUE_BOX_TRAVEL: number = constants.ui.gestures.valueBoxTravelPx;

const KEY = Symbol('valueBox');

/** Called once by `CentralDisplay`: every slider below it is a value box. */
export function provideValueBoxes(): void {
	setContext(KEY, true);
}

/** True for a slider mounted in a central view. Call during component init. */
export function inValueBoxScope(): boolean {
	return getContext<boolean | undefined>(KEY) === true;
}
