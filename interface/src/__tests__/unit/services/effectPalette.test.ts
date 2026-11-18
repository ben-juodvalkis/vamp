import { describe, expect, it } from 'vitest';
import { afterEach, beforeEach } from 'vitest';
import { fitBlocks, paletteBlocks, paletteColumns, paletteLabel, paletteTail } from '$lib/services/effectPalette';
import { _setEffectsFolderForTests } from '$lib/services/effectSources.svelte';

const names = (row: ({ name: string } | null)[]) => row.map((e) => e?.name ?? null);

describe('effectPalette', () => {
	it('is one layout on every MIDI track', () => {
		expect(paletteBlocks('kit')).toEqual(paletteBlocks('instrument'));
		expect(paletteBlocks('kit').map((b) => b.family)).toEqual(['midi', 'guitar', 'tone', 'dynamics', 'distortion', 'modulation', 'glitch', 'time']);
	});

	it('drops only the MIDI block on an audio track, the rest in the same order', () => {
		expect(paletteBlocks('audio').map((b) => b.family)).toEqual(['guitar', 'tone', 'dynamics', 'distortion', 'modulation', 'glitch', 'time']);
		expect(paletteBlocks('audio')).toEqual(paletteBlocks('kit').slice(1));
	});

	it('keeps a slot for an effect not on this Mac', () => {
		// Live's own Random over Arpeggiator: both load by name, no file needed.
		const midi = paletteBlocks('kit')[0];
		expect(midi.rows.map(names)).toEqual([['Random'], ['Arpeggiator'], [null]]);
		expect(midi.rows[0][0]).toMatchObject({ kind: 'midi-effect', preset: 'random', fullPath: 'default:random' });
		const time = paletteBlocks('kit').find((b) => b.family === 'time')!;
		// Comb is a file in the effects folder, absent here.
		expect(time.rows.map(names)).toEqual([['Echo'], ['Reverb'], [null]]);
	});

	it('is nine columns, three rows deep, the closed bar its first row', () => {
		const all = paletteBlocks('kit');
		expect(all.reduce((n, b) => n + b.cols, 0)).toBe(9);
		expect(all.every((b) => b.rows.length === 3)).toBe(true);
		expect(fitBlocks(all, 9)).toHaveLength(all.length);
		expect(fitBlocks(all, 8)).toHaveLength(all.length - 1);
	});

	it('loads as the defaults did, with short labels', () => {
		expect(paletteBlocks('kit')[0].rows[1][0]).toMatchObject({ kind: 'midi-effect', preset: 'arpeggiator', fullPath: 'default:arpeggiator' });
		expect(paletteLabel({ name: 'Glue Compressor', preset: 'squash' })).toBe('Glue');
		expect(paletteLabel({ name: 'Blur', preset: 'smudge' })).toBe('Blur');
		expect(paletteLabel({ name: 'Multiband Dynamics', preset: 'ott' })).toBe('Multi\u00adband');
		expect(paletteLabel({ name: 'MidiWheels' })).toBe('Wheels');
	});

	it('fits as many tile columns as the width holds', () => {
		expect(paletteColumns(166, 80, 6)).toBe(2);
		expect(paletteColumns(0, 80, 6)).toBe(0);
	});

	describe('files in the effects folder (ADR-548)', () => {
		beforeEach(() =>
			_setEffectsFolderForTests({
				name: '+Effect',
				source: 'place:+Effect',
				path: '/fx',
				devices: { MidiWheels: 'Midi Effect/MidiWheels.amxd' }
			})
		);
		afterEach(() => _setEffectsFolderForTests(null));

		it('loads the wheels as their file', () => {
			expect(paletteBlocks('kit')[0].rows[2][0]).toEqual({ name: 'MidiWheels', fullPath: '/fx/Midi Effect/MidiWheels.amxd', source: 'place:+Effect', rel: 'Midi Effect/MidiWheels.amxd', kind: 'midi-effect' });
		});
	});

	it('loads Live\'s own Shifter, by name, where Ring Mod was', () => {
		const dist = paletteBlocks('kit').find((b) => b.family === 'distortion')!;
		expect(dist.rows[2][1]).toMatchObject({ name: 'Shifter', preset: 'shifter', fullPath: 'default:shifter' });
		expect(paletteLabel(dist.rows[2][1]!)).toBe('Shifter');
	});

	it('puts Blur and Pitch Shift under Gain', () => {
		expect(paletteTail().map((t) => t.family)).toEqual(['time', 'glitch']);
	});
});
