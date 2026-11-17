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
import { amountInk, rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
import { paintModeReactive } from '$lib/utils/paintMode.svelte';
import { schemeFromInk, setAmountInkSource, type DeviceColorScheme } from '$lib/config/devicePresets';

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
	const rec = v3Store.tracks.get('tracks/' + session.selectedTrackIndex);
	return rec ? schemeFromInk(amountInk(rgbToHex(rec.color), paintModeReactive())) : null;
}

/** The ink an amount takes with no track selected (the master): a mid grey, clear of ON's white and black. */
const NO_TRACK_AMOUNT = { dark: '#a8a8a4', light: '#55554f' } as const;

/**
 * The ink every amount is drawn in (ADR-544): the selected track's, a
 * deeper one of its hue on the light theme, a mid grey with no track
 * selected. A hex, so a canvas can take it.
 *
 * Reads rune-backed stores; call it inside a `$derived` or a template.
 */
export function selectedAmountInk(): string {
	const mode = paintModeReactive();
	const rec = v3Store.tracks.get('tracks/' + session.selectedTrackIndex);
	return rec ? amountInk(rgbToHex(rec.color), mode) : NO_TRACK_AMOUNT[mode];
}

/** `selectedAmountInk` as a scheme, for the controls that take one. */
export function selectedAmountScheme(): DeviceColorScheme {
	return schemeFromInk(selectedAmountInk());
}

// Every device scheme in `devicePresets` answers with this ink from here on:
// a device family has no colour of its own in the interface (ADR-544).
setAmountInkSource(selectedAmountInk);
