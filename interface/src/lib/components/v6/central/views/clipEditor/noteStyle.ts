/** How the clip editor names and inks a note. */

import { paintModeReactive } from '$lib/utils/paintMode.svelte';
import { deviceInk, trackInk } from '$lib/utils/formatters/trackFormatters';

export const VELOCITY_MAX = 127;

// The gutter's naming (C4 = 60, as it always drew the Cs).
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function pitchName(p: number): string {
	return `${PITCH_NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;
}

/**
 * GRATICULE (§5.4): velocity drives BOTH saturation (toward signal-dim)
 * and alpha — shared by the notes and the velocity-lane bars for visual
 * rhyme. The trackInk-normalized track color is the hue anchor; a Drum
 * Rack pad's chain colour (`pad`) goes through `padInk` instead.
 */
export function noteColor(color: string | undefined, velocity: number, pad = false): string {
	const t = Math.min(1, Math.max(0, velocity / VELOCITY_MAX));
	const satPct = Math.round((0.45 + 0.55 * t) * 100);
	const alphaPct = Math.round((0.5 + 0.5 * t) * 100);
	const ink = color ? (pad ? padInk(color) : trackInk(color, paintModeReactive())) : 'var(--signal-dim)';
	const sat = `color-mix(in oklab, ${ink} ${satPct}%, var(--signal-dim))`;
	return `color-mix(in oklab, ${sat} ${alphaPct}%, transparent)`;
}

/**
 * A pad's chain colour as ink: brightened to read as a line or a name the
 * way the track's is, but a grey pad stays grey (`deviceInk`), as its tile
 * in the pad grid is — `trackInk` would tint it.
 */
export function padInk(color: string): string {
	return deviceInk(color, paintModeReactive());
}
