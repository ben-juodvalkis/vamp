/**
 * PITCH (stop 1 of the visual redesign): which of the three candidate looks
 * this page load wears, from `localStorage['vamp.pitch']` by way of
 * `data-pitch` on <html> (app.html). Empty: the shipped look. Goes with the
 * two losing directions once one is chosen.
 */
import { schemeFromInk, type DeviceColorScheme } from '$lib/config/devicePresets';
import { paintModeReactive } from '$lib/utils/paintMode.svelte';
import { selectedTrackInk } from '$lib/utils/selectedTrackInk';

export const pitch: string =
	typeof document !== 'undefined' ? (document.documentElement.dataset.pitch ?? '') : '';
export const pitchOn = pitch !== '';

/**
 * What an amount is drawn in under a pitch direction, as the scheme the
 * device chokepoints hand every tile and view: Live's cyan (1), or the
 * selected track's ink (2, 3). Null: the shipped family colour. Reads
 * rune-backed stores; call it inside a `$derived`.
 */
export function pitchAmountScheme(): DeviceColorScheme | null {
	if (!pitchOn) return null;
	const light = paintModeReactive() === 'light';
	if (pitch === '1') return schemeFromInk(light ? '#0f9fb8' : '#3cc4dc');
	const ink = selectedTrackInk();
	if (!ink) return schemeFromInk(light ? '#14161a' : '#e6e8eb');
	if (!light) return schemeFromInk(ink);
	const deep = `oklch(from ${ink} 0.5 c h)`;
	return { ...schemeFromInk(ink), primary: deep, accent: deep };
}
