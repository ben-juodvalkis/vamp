import { describe, expect, it } from 'vitest';
import { fitBlocks, paletteBlocks, paletteColumns, paletteLabel } from '$lib/services/effectPalette';

const names = (row: ({ name: string } | null)[]) => row.map((e) => e?.name ?? null);

describe('effectPalette', () => {
	it("leads with the track's own block: MIDI on a MIDI track, the guitar rig on audio", () => {
		expect(paletteBlocks('kit')[0].family).toBe('midi');
		expect(paletteBlocks('instrument')[0].family).toBe('midi');
		expect(paletteBlocks('audio')[0].family).toBe('guitar');
		// No effects folder here: Note Chance (a Max device) is an empty slot that keeps its place.
		expect(names(paletteBlocks('kit')[0].top)).toEqual(['Arpeggiator', null, 'Velocity']);
		expect(names(paletteBlocks('instrument')[0].top)).toEqual(['Arpeggiator', 'Chord', 'Random']);
	});

	it('groups by family in the same order on every track, main effects on top', () => {
		for (const kind of ['kit', 'instrument', 'audio'] as const) {
			expect(paletteBlocks(kind).slice(1).map((b) => b.family)).toEqual(['tone', 'dynamics', 'distortion', 'modulation', 'time', 'glitch']);
		}
		const time = paletteBlocks('instrument').find((b) => b.family === 'time')!;
		expect(names(time.top)).toEqual(['Echo', 'Reverb']);
	});

	it('offers Drum Buss on a kit only', () => {
		const has = (kind: 'kit' | 'instrument' | 'audio') =>
			paletteBlocks(kind).some((b) => [...b.top, ...b.bottom].some((e) => e?.name === 'Drum Buss'));
		expect(has('kit')).toBe(true);
		expect(has('instrument')).toBe(false);
		expect(has('audio')).toBe(false);
	});

	it('fits whole blocks and room for +, dropping from the end', () => {
		const all = paletteBlocks('instrument');
		const cols = all.reduce((n, b) => n + b.cols, 0);
		expect(fitBlocks(all, cols + 1)).toHaveLength(all.length);
		expect(fitBlocks(all, cols)).toHaveLength(all.length - 1);
		expect(fitBlocks(all, 1)).toHaveLength(0);
	});

	it('loads as the defaults did: a MIDI effect is one', () => {
		expect(paletteBlocks('kit')[0].top[0]).toMatchObject({ kind: 'midi-effect', preset: 'arpeggiator', fullPath: 'default:arpeggiator' });
		expect(paletteBlocks('kit')[1].top[0]).toMatchObject({ kind: 'audio-effect', preset: 'filter' });
		expect(paletteLabel({ name: 'Glue Compressor', preset: 'squash' })).toBe('Glue');
	});

	it('fits as many tile columns as the width holds', () => {
		expect(paletteColumns(80, 80, 6)).toBe(1);
		expect(paletteColumns(165, 80, 6)).toBe(1);
		expect(paletteColumns(166, 80, 6)).toBe(2);
		expect(paletteColumns(0, 80, 6)).toBe(0);
	});
});
