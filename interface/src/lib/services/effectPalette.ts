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

/** What a chip in the palette bar says: short, so a row holds many. */
const LABELS: Record<string, string> = {
	arpeggiator: 'Arp', chance: 'Chance', velocity: 'Velocity', chord: 'Chord', random: 'Random',
	filter: 'Filter', eq: 'EQ', saturator: 'Drive', squash: 'Glue', compressor: 'Comp', echo: 'Echo',
	reverb: 'Reverb', chorus: 'Chorus', phaser: 'Phaser', tremolo: 'Tremolo', drum: 'Drum Buss',
	redux: 'Redux', gate: 'Gate', ott: 'OTT', shifter: 'Shifter', pedal: 'Pedal', roar: 'Roar',
	guitar: 'Guitar', bass: 'Bass Amp', wah: 'Wah', delay: 'Delay', limiter: 'Limiter', eq8: 'EQ Eight',
	toneShaper: 'Tone Shaper', comb: 'Comb', glitchLoop: 'Glitch', pitchHack: 'Pitch Hack', smudge: 'Blur',
	octave: 'Pitch Shift', variation: 'Stutter'
};

/** A palette entry's short name, else its device's. */
export function paletteLabel(effect: Pick<RecentEffect, 'name' | 'preset'>): string {
	return (effect.preset && LABELS[effect.preset]) || effect.name;
}

/** The MIDI section's slots in the first row; empty on an audio track, so the audio chips keep their places. */
export const MIDI_SLOTS = 3;
const MIDI: Record<PaletteKind, readonly (string | null)[]> = {
	kit: ['arpeggiator', 'chance', 'velocity'],
	instrument: ['arpeggiator', 'chord', 'random'],
	audio: []
};
/** MIDI effects that lead the second row, under the MIDI section, where a kind has more. */
const MIDI_MORE: Record<PaletteKind, readonly string[]> = {
	kit: [],
	instrument: ['chance', 'velocity'],
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

/** Every other audio effect, after a kind's own, so the rows are always full. */
const REST = ['ott', 'gate', 'redux', 'shifter', 'pedal', 'roar', 'drum', 'guitar', 'bass', 'wah', 'comb', 'glitchLoop', 'pitchHack', 'variation', 'smudge', 'octave', 'toneShaper', 'delay', 'limiter', 'eq8'];
/** What a kind never offers (the user, 2026-11-10): Drum Buss off a kit, the amps off a MIDI track. */
const NEVER: Record<PaletteKind, ReadonlySet<string>> = {
	kit: new Set(['guitar', 'bass']),
	instrument: new Set(['drum', 'guitar', 'bass']),
	audio: new Set(['drum'])
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

/** A kind's audio effects in reading order, every one it offers, once. */
function audioKeys(kind: PaletteKind): string[] {
	return [...new Set([...CORE, ...EXTRAS[kind], ...REST])].filter((key) => DEVICE_PRESETS[key] && !NEVER[kind].has(key) && effectAvailable(key));
}

/** The first `max` audio effects for a kind, in reading order. */
export function audioPalette(kind: PaletteKind, max: number): RecentEffect[] {
	return audioKeys(kind).slice(0, Math.max(0, max)).map(entry);
}

/**
 * The palette's two rows: the first row's audio chips (`first` of them),
 * then the second row (`second` chips): the kind's other MIDI effects
 * under the MIDI section, then the audio effects after the first row's.
 */
export function paletteRows(kind: PaletteKind, first: number, second: number): { row1: RecentEffect[]; row2: RecentEffect[] } {
	const audio = audioKeys(kind);
	const row1 = audio.slice(0, first);
	const more = MIDI_MORE[kind].filter((key) => effectAvailable(key));
	const row2 = [...more, ...audio.slice(first)].slice(0, Math.max(0, second));
	return { row1: row1.map(entry), row2: row2.map(entry) };
}

/** How many tile columns a palette `width` px wide holds, tiles at least `minTile` px and `gap` apart. */
export function paletteColumns(width: number, minTile: number, gap: number): number {
	return Math.max(0, Math.floor((width + gap) / (minTile + gap)));
}
