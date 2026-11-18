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

/** A palette entry's short name, else its device's. */
export function paletteLabel(effect: Pick<ChainEffect, 'name' | 'preset'>): string {
	return (effect.preset && LABELS[effect.preset]) || effect.name;
}

/**
 * The palette is laid out in family blocks (the user, 2026-11-11): each
 * family a few columns, its main effects on the first row and its others
 * under them, so when the second row goes (a chain on two rows) every
 * family keeps its main ones, and the colours read as blocks.
 */
export interface PaletteBlock {
	family: string;
	/** Columns: the longer of its two rows. */
	cols: number;
	/** Each row, `null` where an effect is not on this Mac (its slot stays). */
	top: (ChainEffect | null)[];
	bottom: (ChainEffect | null)[];
}

type BlockSpec = { family: string; top: readonly string[]; bottom: readonly string[] };

/**
 * One layout on every track (the user, 2026-11-11, from the chip picker):
 * the same blocks in the same columns, for muscle memory. Only the MIDI
 * block goes on an audio track, and the rest stretch to fill the row.
 */
const BLOCKS: readonly BlockSpec[] = [
	{ family: 'midi', top: ['random'], bottom: ['arpeggiator'] },
	{ family: 'guitar', top: ['guitar'], bottom: ['bass'] },
	{ family: 'tone', top: ['filter', 'eq'], bottom: ['toneShaper'] },
	{ family: 'dynamics', top: ['squash'], bottom: ['ott'] },
	{ family: 'distortion', top: ['drum', 'pedal'], bottom: ['roar', 'redux'] },
	{ family: 'modulation', top: ['tremolo', 'chorus'], bottom: ['phaser'] },
	{ family: 'glitch', top: ['variation'], bottom: ['glitchLoop'] },
	{ family: 'time', top: ['echo', 'reverb'], bottom: ['comb', 'smudge'] }
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

const slot = (key: string) => (DEVICE_PRESETS[key] && effectAvailable(key) ? entry(key) : null);

/** The blocks for a track: all of them, but the MIDI block on an audio track. */
export function paletteBlocks(kind: PaletteKind): PaletteBlock[] {
	return BLOCKS.filter((b) => !(kind === 'audio' && b.family === 'midi')).map(({ family, top, bottom }) => ({
		family,
		cols: Math.max(top.length, bottom.length),
		top: top.map(slot),
		bottom: bottom.map(slot)
	}));
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

/**
 * The palette's third row (ADR-548): the rest of the + menu, the user's
 * effects folder less what the two rows above already hold (Utility is
 * the Gain chip), shown only while the + is open. Not under the family
 * columns, since the families have one to four each: a row in family
 * order, each chip in its own family's wash. A Live device or a type
 * loads as the chips above do; Ring Mod has no type and loads as its file.
 */
type ExtraSpec = { family: string; key?: string; file?: string };
const EXTRA_ROW: readonly ExtraSpec[] = [
	{ family: 'midi', key: 'chord' },
	{ family: 'midi', key: 'velocity' },
	{ family: 'midi', key: 'chance' },
	{ family: 'midi', key: 'randomOctave' },
	{ family: 'guitar', key: 'wah' },
	{ family: 'dynamics', key: 'compressor' },
	{ family: 'dynamics', key: 'gate' },
	{ family: 'distortion', key: 'saturator' },
	{ family: 'distortion', file: 'Ring Mod' },
	{ family: 'glitch', key: 'pitchHack' },
	{ family: 'glitch', key: 'octave' }
];

export interface PaletteExtra {
	family: string;
	/** `null` where the effect is not on this Mac (its slot stays). */
	fx: ChainEffect | null;
}

function fileEntry(name: string): ChainEffect | null {
	const found = effectSource({ defaultName: name });
	if (!found) return null;
	return { name, fullPath: found.presetPath, source: found.source, rel: found.rel, kind: 'audio-effect' };
}

/** The third row for a track: all of it, but the MIDI effects on an audio track. */
export function paletteExtras(kind: PaletteKind): PaletteExtra[] {
	return EXTRA_ROW.filter((e) => !(kind === 'audio' && e.family === 'midi')).map(({ family, key, file }) => ({
		family,
		fx: key ? slot(key) : fileEntry(file ?? '')
	}));
}
