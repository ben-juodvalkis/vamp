/**
 * Device glyphs — what the track strip's device band draws when it has
 * no controls worth miniaturising.
 *
 * The band is wordless by design (user, 2026-09-14: "I don't think I want
 * any text in these instrument things"). An instrument draws the mark of
 * the CATEGORY its preset came from (`glyphForCategory`), else its first
 * control as a knob; everything else draws ONE mark that says what kind of
 * thing is on the track — a guitar on a guitar track being the case that
 * asked for this.
 *
 * Keys are `DEVICE_PRESETS` keys (the rig's own device vocabulary) plus a
 * few instrument types; the view maps each glyph name to its icon.
 */

import type { InstrumentType } from '$lib/services/instrumentService';

export type DeviceGlyph =
	| 'guitar'
	| 'mic'
	| 'keys'
	| 'keyboard'
	| 'synth'
	| 'upright-bass'
	| 'hand-drum'
	| 'violin'
	| 'trumpet'
	| 'saxophone'
	| 'harp'
	| 'sampler'
	| 'simpler'
	| 'drum'
	| 'shaker'
	| 'filter'
	| 'space'
	| 'dynamics'
	| 'drive'
	| 'movement'
	| 'gain'
	| 'device';

/**
 * Devices that say what a TRACK is, not merely what is being done to it.
 *
 * An audio track's chain head is usually an ordinary effect — the guitar
 * track's is an Auto Filter — so the head alone would put a filter glyph
 * on the one track a performer would recognise instantly from a guitar.
 * The band looks for one of these anywhere in the chain first, and only
 * then falls back to the head.
 */
export const CHARACTER_DEVICE_KEYS: readonly string[] = ['guitar', 'bass', 'vocal'];

/** `DEVICE_PRESETS` key → glyph. Anything unlisted draws the generic mark. */
export const DEVICE_GLYPHS: Readonly<Record<string, DeviceGlyph>> = {
	guitar: 'guitar',
	bass: 'guitar', // the Bass Amp rack — an amp is a guitar's mark here
	octave: 'guitar', // the Octave pitch shifter on a guitar or bass track
	vocal: 'mic',

	filter: 'filter',
	eq: 'filter',
	toneShaper: 'filter', // a tone balancer, beside the EQ
	wah: 'filter',

	echo: 'space',
	reverb: 'space',
	variation: 'space',
	pitchHack: 'space', // a pitch-shifting delay: its taps live in time
	glitchLoop: 'space', // PitchLoop89, a pitch-shifting delay like Pitch Hack

	compressor: 'dynamics',
	squash: 'dynamics',
	gate: 'dynamics',
	ott: 'dynamics',

	saturator: 'drive',
	pedal: 'drive',
	redux: 'drive',
	digital: 'drive',
	shifter: 'drive',
	drum: 'drive',
	smudge: 'drive',

	chorus: 'movement',
	tremolo: 'movement',
	phaser: 'movement',
	comb: 'movement',

	utility: 'gain',

	arpeggiator: 'movement',
	random: 'movement',
	velocity: 'movement',
	chord: 'movement',
	chance: 'movement',
	sequencer: 'movement'
};

/**
 * Glyph for an instrument the band could not draw controls for — a
 * plug-in whose parameters the rig does not know, a rack with nothing
 * mapped. Keyed loosely: what family of sound-source is it.
 */
export const INSTRUMENT_GLYPHS: Readonly<Partial<Record<InstrumentType, DeviceGlyph>>> = {
	// Not the drum: the drum is the Drum CATEGORY's mark (user, 2026-09-18),
	// and a Drum Rack is in Perc, Inst and FX too. A kit with no category
	// and no named macro to draw is only "an instrument".
	drumrack: 'device',
	// The pattern rack plays shaker and tambourine loops, and draws this mark
	// in place of a knob (user, 2026-09-17) — see useTrackDevice's mode rule.
	'instrument-rack-pattern': 'shaker',
	sampler: 'sampler',
	simpler: 'simpler',
	'komplete-kontrol': 'keys',
	omnisphere: 'keys',
	plugin: 'keys',
	unknown: 'device'
};

export function glyphForPresetKey(key: string | null): DeviceGlyph {
	if (!key) return 'device';
	return DEVICE_GLYPHS[key] ?? 'device';
}

export function glyphForInstrument(type: InstrumentType | null): DeviceGlyph {
	if (!type) return 'device';
	return INSTRUMENT_GLYPHS[type] ?? 'keys';
}

/**
 * The mark for an instrument, by the category its preset was chosen from
 * (user, 2026-09-18) — `category` a rail id (`drum`, `perc`, `bass`, `key`,
 * `synth`, `inst`, `fx`) and `folders` the folders under the category
 * folder, top down, when the preset path is known.
 *
 * Inst is a grab bag, so it is read one folder down: Guitar, String, Vocal,
 * Wind and Plucked are the whole of it across all three vendors (measured
 * 2026-09-18). Wind is two marks — Ableton's and NI's already file
 * `Wind/Brass` beside `Wind/Winds`, and Wind is to be split into Brass and
 * Wind folders of its own; both spellings of brass land on the trumpet. An
 * Inst preset in no known folder, or known only by its recorded role, is
 * "an instrument".
 *
 * Null leaves the band to draw what it drew before categories: FX has no
 * mark yet (user, 2026-09-18: "use the knob for now"), and neither does a
 * track whose load recorded no category at all.
 */
export function glyphForCategory(category: string | null, folders: readonly string[] = []): DeviceGlyph | null {
	switch (category) {
		case 'drum':
			return 'drum';
		case 'perc':
			return 'hand-drum';
		case 'bass':
			return 'upright-bass';
		case 'key':
			return 'keyboard';
		case 'synth':
			return 'synth';
		case 'inst':
			return INST_FOLDER_GLYPHS[instFolder(folders)] ?? 'device';
		default:
			return null;
	}
}

const INST_FOLDER_GLYPHS: Readonly<Record<string, DeviceGlyph>> = {
	guitar: 'guitar',
	string: 'violin',
	vocal: 'mic',
	brass: 'trumpet',
	wind: 'saxophone',
	plucked: 'harp'
};

/** The Inst subfolder that decides the mark — `Wind/Brass` counts as Brass. */
function instFolder(folders: readonly string[]): string {
	const first = folders[0]?.toLowerCase() ?? '';
	return first === 'wind' && folders[1]?.toLowerCase() === 'brass' ? 'brass' : first;
}
