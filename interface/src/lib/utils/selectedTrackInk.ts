/**
 * selectedTrackInk — the focused track's calibrated ink (trackInk over the
 * v3 record's Live color), or `null` when no record exists for the selected
 * index. One recipe, three consumers: CentralDisplay's frame fallback accent
 * and the fx-grid chokepoints' trackTint device schemes (ADR-400).
 *
 * Reads rune-backed stores — call it inside a `$derived` so selection,
 * color, and theme changes propagate.
 */

import { v3Store } from '$lib/stores/v3/normalized.svelte';
import { session } from '$lib/stores/session.svelte';
import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
import { paintModeReactive } from '$lib/utils/paintMode.svelte';
import { schemeFromInk, type DeviceColorScheme } from '$lib/config/devicePresets';

export function selectedTrackInk(): string | null {
	const rec = v3Store.tracks.get('tracks/' + session.selectedTrackIndex);
	return rec ? trackInk(rgbToHex(rec.color), paintModeReactive()) : null;
}

/**
 * The focused track's calibrated ink as a full DeviceColorScheme — the
 * trackTint treatment (primary/accent = the track ink, secondary = 10% wash,
 * via `schemeFromInk`), or `null` when no track record exists (cold start /
 * master).
 *
 * Instrument central views paint their body chrome with this so the whole
 * view reads as the track it's on — extending ADR-400 §4's `trackTint` from
 * the lone utility device to the instrument itself (an instrument IS the
 * track's voice, not a module on it). See ADR-402. Insert FX views keep their
 * family ink; genuinely informational sub-palettes (pitch/mod wheels, DrumRack
 * modes, Omnisphere sections) keep their function hues.
 *
 * Reads rune-backed stores — call it inside a `$derived` so selection, color,
 * and theme changes propagate.
 */
export function selectedTrackScheme(): DeviceColorScheme | null {
	const ink = selectedTrackInk();
	return ink ? schemeFromInk(ink) : null;
}
