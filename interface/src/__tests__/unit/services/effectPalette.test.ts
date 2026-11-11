import { describe, expect, it } from 'vitest';
import { fitBlocks, paletteBlocks, paletteColumns, paletteLabel } from '$lib/services/effectPalette';

const names = (row: ({ name: string } | null)[]) => row.map((e) => e?.name ?? null);

describe('effectPalette', () => {
	it('is one layout on every MIDI track', () => {
		expect(paletteBlocks('kit')).toEqual(paletteBlocks('instrument'));
		expect(paletteBlocks('kit').map((b) => b.family)).toEqual(['midi', 'guitar', 'tone', 'dynamics', 'distortion', 'modulation', 'time', 'glitch']);
	});

	it('drops only the MIDI block on an audio track, the rest in the same order', () => {
		expect(paletteBlocks('audio').map((b) => b.family)).toEqual(['guitar', 'tone', 'dynamics', 'distortion', 'modulation', 'time', 'glitch']);
		expect(paletteBlocks('audio')).toEqual(paletteBlocks('kit').slice(1));
	});

	it('keeps a slot for an effect not on this Mac', () => {
		// No effects folder in tests: Random Octave (a file there) is an empty slot over Arpeggiator.
		const midi = paletteBlocks('kit')[0];
		expect(names(midi.top)).toEqual([null]);
		expect(names(midi.bottom)).toEqual(['Arpeggiator']);
		const time = paletteBlocks('kit').find((b) => b.family === 'time')!;
		expect(names(time.top)).toEqual(['Echo', 'Reverb']);
		// Comb and Blur are files in the effects folder, absent here.
		expect(names(time.bottom)).toEqual([null, null]);
	});

	it('fits whole blocks, dropping from the end', () => {
		const all = paletteBlocks('kit');
		const cols = all.reduce((n, b) => n + b.cols, 0);
		expect(cols).toBe(11);
		expect(fitBlocks(all, cols)).toHaveLength(all.length);
		expect(fitBlocks(all, cols - 1)).toHaveLength(all.length - 1);
	});

	it('loads as the defaults did, with short labels', () => {
		expect(paletteBlocks('kit')[0].bottom[0]).toMatchObject({ kind: 'midi-effect', preset: 'arpeggiator', fullPath: 'default:arpeggiator' });
		expect(paletteLabel({ name: 'Glue Compressor', preset: 'squash' })).toBe('Glue');
		expect(paletteLabel({ name: 'Blur', preset: 'smudge' })).toBe('Blur');
	});

	it('fits as many tile columns as the width holds', () => {
		expect(paletteColumns(166, 80, 6)).toBe(2);
		expect(paletteColumns(0, 80, 6)).toBe(0);
	});
});
