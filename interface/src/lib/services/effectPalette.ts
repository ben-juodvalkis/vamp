/**
 * The chain's palette (the user, 2026-11-10): a fixed set of ghost effects
 * under the chain, the same ones in the same places every time, so a hand
 * learns where each one is. It replaced the Recent column (ADR-484), whose
 * order changed with every effect added.
 *
 * What the palette offers depends only on the kind of track: a Drum Rack
 * (or a pad of one), another instrument, or audio. MIDI effects sit on the
 * left, audio effects on the right; the audio effects every kind shares
 * come first, so they never move, and the kind's own fill the slots after.
 * An effect already on the chain stays in its slot.
 *
 * Every entry loads as the defaults did: a Live device by name, one of
 * Vamp's effects by name from the user's effects folder (`effectSources`).
 */
import { DEVICE_PRESETS, deviceLoadArgs } from '$lib/config/devicePresets';
import { effectAvailable } from '$lib/services/effectSources.svelte';
import type { RecentEffect } from '$lib/services/recentEffects.svelte';

export type PaletteKind = 'kit' | 'instrument' | 'audio';

/** The MIDI section's slots, two columns of two. `null` is a slot left empty, so the others keep their places. */
export const MIDI_SLOTS = 4;
const MIDI: Record<PaletteKind, readonly (string | null)[]> = {
	kit: ['arpeggiator', 'chance', 'velocity', null],
	instrument: ['arpeggiator', 'chance', 'chord', 'random'],
	audio: []
};

/** The audio effects every kind shares, first, in reading order. */
const CORE = ['filter', 'eq', 'saturator', 'squash', 'compressor', 'echo', 'reverb', 'chorus', 'phaser', 'tremolo'] as const;
/** Each kind's own, after the core: what fits is shown, the rest is a tap on +. */
const EXTRAS: Record<PaletteKind, readonly string[]> = {
	kit: ['drum', 'redux', 'gate', 'ott', 'shifter', 'pedal', 'roar'],
	instrument: ['pedal', 'roar', 'redux', 'shifter', 'gate', 'ott'],
	audio: ['guitar', 'bass', 'wah', 'pedal', 'shifter', 'gate', 'ott', 'roar']
};

const MIDI_KEYS = new Set(['arpeggiator', 'chance', 'velocity', 'chord', 'random']);

function entry(key: string): RecentEffect {
	const preset = DEVICE_PRESETS[key];
	const [, , , source = '', rel = ''] = deviceLoadArgs('', '', preset);
	return {
		name: preset.defaultName,
		fullPath: `default:${key}`,
		source,
		rel,
		kind: MIDI_KEYS.has(key) ? 'midi-effect' : 'audio-effect',
		preset: key
	};
}

/** The MIDI slots for a kind, `null` where a slot stays empty; none on an audio track. */
export function midiPalette(kind: PaletteKind): (RecentEffect | null)[] {
	return MIDI[kind].map((key) => (key && effectAvailable(key) ? entry(key) : null));
}

/** The first `max` audio effects for a kind, in reading order. */
export function audioPalette(kind: PaletteKind, max: number): RecentEffect[] {
	return [...CORE, ...EXTRAS[kind]].filter((key) => effectAvailable(key)).slice(0, Math.max(0, max)).map(entry);
}

/** How many tile columns a palette `width` px wide holds, tiles at least `minTile` px and `gap` apart. */
export function paletteColumns(width: number, minTile: number, gap: number): number {
	return Math.max(0, Math.floor((width + gap) / (minTile + gap)));
}
