/**
 * The chain's palette (ADR-523): a fixed set of effect chips over the
 * chain, the same ones in the same places every time, so a hand learns
 * where each one is. It replaced the Recent column (ADR-484), whose order
 * changed with every effect added.
 *
 * Every track has the same palette, but an audio track has no MIDI block.
 * An effect already on the chain stays in its slot.
 *
 * Every entry loads as the defaults did: a Live device by name, one of
 * Vamp's effects by name from the user's effects folder (`effectSources`).
 */
import { DEVICE_PRESETS, deviceLoadArgs } from '$lib/config/devicePresets';
import { effectAvailable, effectSource } from '$lib/services/effectSources.svelte';
import type { ChainEffect } from '$lib/services/chainEffects.svelte';
import type { ItemKind } from '$lib/utils/placeKinds';

export type PaletteKind = 'kit' | 'instrument' | 'audio';

/** What a chip in the palette bar says: short, so a row holds many. Multiband's soft hyphen breaks it as Multi-band only on a narrow chip. */
const LABELS: Record<string, string> = {
	arpeggiator: 'Arp', chance: 'Chance', velocity: 'Velocity', chord: 'Chord', random: 'Random',
	filter: 'Filter', eq: 'EQ', saturator: 'Drive', squash: 'Glue', compressor: 'Comp', echo: 'Echo',
	reverb: 'Reverb', chorus: 'Chorus', phaser: 'Phaser', tremolo: 'Trem', drum: 'Drum Buss',
	redux: 'Redux', gate: 'Gate', ott: 'Multi\u00adband', shifter: 'Shifter', pedal: 'Pedal', roar: 'Roar',
	guitar: 'Guitar', bass: 'Bass', wah: 'Wah', delay: 'Delay', limiter: 'Limiter', eq8: 'EQ Eight',
	toneShaper: 'Tone Shaper', comb: 'Comb', glitchLoop: 'Glitch', pitchHack: 'Pitch Hack', smudge: 'Blur',
	octave: 'Pitch Shift', variation: 'Stutter', randomOctave: 'Rand Oct', grainDelay: 'Grain'
};

/** A chip loaded as a file, by its file's name. */
const FILE_LABELS: Record<string, string> = { MidiWheels: 'Wheels' };

/** A palette entry's short name, else its device's. */
export function paletteLabel(effect: Pick<ChainEffect, 'name' | 'preset'>): string {
	return (effect.preset && LABELS[effect.preset]) || FILE_LABELS[effect.name] || effect.name;
}

/**
 * The palette is laid out in family blocks (the user, 2026-11-11): each
 * family a column or two, three rows deep (ADR-548, laid out by Ben in the
 * Palette Planner, 2026-11-18): its main effects on the first row, the one
 * that shows while the bar is closed, and its others under them.
 */
export interface PaletteBlock {
	family: string;
	/** Columns: the longest of its rows. */
	cols: number;
	/** Each row, top first, `null` where an effect is not on this Mac (its slot stays). */
	rows: (ChainEffect | null)[][];
}

/** A chip: a `DEVICE_PRESETS` type, or a file in the effects folder by name (no type of its own). */
type SlotSpec = string | { file: string; kind: ItemKind };
type BlockSpec = { family: string; rows: readonly (readonly SlotSpec[])[] };

/**
 * One layout on every track: the same blocks in the same columns, for
 * muscle memory. Only the MIDI block goes on an audio track, and the rest
 * stretch to fill the row.
 */
const BLOCKS: readonly BlockSpec[] = [
	{ family: 'midi', rows: [['random'], ['arpeggiator'], [{ file: 'MidiWheels', kind: 'midi-effect' }]] },
	{ family: 'guitar', rows: [['guitar'], ['bass'], ['wah']] },
	{ family: 'tone', rows: [['filter'], ['eq'], ['toneShaper']] },
	{ family: 'dynamics', rows: [['squash'], ['ott'], ['gate']] },
	{ family: 'distortion', rows: [['drum', 'pedal'], ['roar', 'redux'], ['saturator', 'shifter']] },
	{ family: 'modulation', rows: [['tremolo'], ['chorus'], ['phaser']] },
	{ family: 'glitch', rows: [['variation'], ['glitchLoop'], ['pitchHack']] },
	{ family: 'time', rows: [['echo'], ['reverb'], ['comb']] }
];

/**
 * Under the Gain chip, rows two and three: two more, each in its own
 * family's wash.
 */
const TAIL: readonly { family: string; spec: SlotSpec }[] = [
	{ family: 'time', spec: 'smudge' },
	{ family: 'glitch', spec: 'octave' }
];

const MIDI_KEYS = new Set(['arpeggiator', 'chance', 'velocity', 'chord', 'random', 'randomOctave']);

function entry(key: string): ChainEffect {
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

/** A file in the effects folder that has no type: it loads as its file. */
function fileEntry(name: string, kind: ItemKind): ChainEffect | null {
	const found = effectSource({ defaultName: name });
	if (!found) return null;
	return { name, fullPath: found.presetPath, source: found.source, rel: found.rel, kind };
}

const slot = (spec: SlotSpec): ChainEffect | null =>
	typeof spec === 'string' ? (DEVICE_PRESETS[spec] && effectAvailable(spec) ? entry(spec) : null) : fileEntry(spec.file, spec.kind);

/** The blocks for a track: all of them, but the MIDI block on an audio track. */
export function paletteBlocks(kind: PaletteKind): PaletteBlock[] {
	return BLOCKS.filter((b) => !(kind === 'audio' && b.family === 'midi')).map(({ family, rows }) => ({
		family,
		cols: Math.max(...rows.map((r) => r.length)),
		rows: rows.map((r) => r.map(slot))
	}));
}

export interface PaletteExtra {
	family: string;
	/** `null` where the effect is not on this Mac (its slot stays). */
	fx: ChainEffect | null;
}

/** The chips under Gain, rows two and three. */
export function paletteTail(): PaletteExtra[] {
	return TAIL.map(({ family, spec }) => ({ family, fx: slot(spec) }));
}

/** The blocks that fit `columns` chip columns: whole blocks, dropped from the end. */
export function fitBlocks(blocks: readonly PaletteBlock[], columns: number): PaletteBlock[] {
	const out: PaletteBlock[] = [];
	let used = 0;
	for (const block of blocks) {
		if (used + block.cols > columns) break;
		out.push(block);
		used += block.cols;
	}
	return out;
}

/** How many tile columns a palette `width` px wide holds, tiles at least `minTile` px and `gap` apart. */
export function paletteColumns(width: number, minTile: number, gap: number): number {
	return Math.max(0, Math.floor((width + gap) / (minTile + gap)));
}
