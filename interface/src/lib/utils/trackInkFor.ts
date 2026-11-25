/**
 * A track's ink, by path: its Live colour through `trackInk` (the calibrated
 * ink envelope, hue preserved) for the current paint mode.
 *
 * The strips row's group arms, its clip grid and stop row, the mini session,
 * the phone's ribbon and its clip grid all wrote this out in full. Reactive
 * where it is read inside a `$derived` or the template: it reads the v3
 * store's record. A track with no record yet (or `null`, no track) is the
 * uncoloured grey `TRACK_DEFAULTS.color` is.
 */

import { v3Store } from '$lib/stores/v3/normalized.svelte';
import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
import { paintModeReactive } from '$lib/utils/paintMode.svelte';

/** Live's colour for a track it left uncoloured (`TRACK_DEFAULTS.color`). */
const UNCOLOURED = 0x808080;

export function trackInkFor(trackPath: string | null): string {
	const color = (trackPath ? v3Store.tracks.get(trackPath)?.color : undefined) ?? UNCOLOURED;
	return trackInk(rgbToHex(color), paintModeReactive());
}
