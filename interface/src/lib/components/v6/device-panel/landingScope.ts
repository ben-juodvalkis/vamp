/**
 * landingScope — the load a chain cell's tile stands for while the effect
 * is on its way into Live (ADR-540).
 *
 * The chain wraps a ghost cell's tile in `LandingScope`; `BaseDeviceControl`
 * reads it, and while it names a load the tile has no device, is drawn
 * loading, and keeps what it writes on that load's record
 * (`landingEffects`), which writes it to the device that lands. The value
 * is a getter: the same tile stays mounted when the device arrives, and
 * then the getter answers null and the tile is the device's.
 */
import { getContext, setContext } from 'svelte';

const KEY = Symbol('landingScope');

export function provideLanding(get: () => string | null | undefined): void {
	setContext(KEY, get);
}

export function readLanding(): () => string | null {
	const get = getContext<(() => string | null | undefined) | undefined>(KEY);
	return () => get?.() ?? null;
}
