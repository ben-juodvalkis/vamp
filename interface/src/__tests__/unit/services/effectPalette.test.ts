import { describe, expect, it } from 'vitest';
import { audioPalette, midiPalette, paletteColumns, paletteRows, MIDI_SLOTS } from '$lib/services/effectPalette';

describe('effectPalette', () => {
	it('keeps the MIDI slots in place, empty where a kind has none', () => {
		// No effects folder here, so Note Chance (a Max device found in it) is
		// an empty slot, and Velocity keeps its place after it.
		expect(midiPalette('kit').map((e) => e?.name ?? null)).toEqual(['Arpeggiator', null, 'Velocity']);
		expect(midiPalette('instrument').map((e) => e?.name ?? null)).toEqual(['Arpeggiator', 'Chord', 'Random']);
		expect(midiPalette('audio')).toEqual([]);
		expect(midiPalette('instrument')).toHaveLength(MIDI_SLOTS);
	});

	it('puts the shared audio effects first, the same for every kind', () => {
		const core = ['Auto Filter', 'Channel EQ', 'Saturator', 'Glue Compressor', 'Compressor', 'Echo', 'Reverb', 'Chorus', 'Phaser', 'Auto Pan Legacy'];
		for (const kind of ['kit', 'instrument', 'audio'] as const) {
			expect(audioPalette(kind, 10).map((e) => e.name)).toEqual(core);
		}
		expect(audioPalette('kit', 11)[10].name).toBe('Drum Buss');
		expect(audioPalette('instrument', 99).map((e) => e.name)).not.toContain('Drum Buss');
	});

	it('fills the second row: more MIDI under the MIDI section, then the audio effects after row 1', () => {
		const { row1, row2 } = paletteRows('instrument', 9, 10);
		expect(row1).toHaveLength(9);
		expect(row2).toHaveLength(10);
		expect(row2[0].name).toBe('Velocity');
		expect(row2.map((e) => e.name)).not.toContain(row1[0].name);
		expect([...row1, ...row2].map((e) => e.name)).not.toContain('Drum Buss');
		expect(paletteRows('kit', 9, 13).row2.map((e) => e.name)).toContain('Drum Buss');
	});

	it('loads as the defaults did: a MIDI effect is one', () => {
		expect(midiPalette('kit')[0]).toMatchObject({ kind: 'midi-effect', preset: 'arpeggiator', fullPath: 'default:arpeggiator' });
		expect(audioPalette('kit', 1)[0]).toMatchObject({ kind: 'audio-effect', preset: 'filter' });
	});

	it('fits as many tile columns as the width holds', () => {
		expect(paletteColumns(80, 80, 6)).toBe(1);
		expect(paletteColumns(165, 80, 6)).toBe(1);
		expect(paletteColumns(166, 80, 6)).toBe(2);
		expect(paletteColumns(0, 80, 6)).toBe(0);
	});
});
