import { describe, it, expect } from 'vitest';
import { glyphForName, CONTROL_GLYPHS } from '$lib/config/controlGlyphMap';

describe('glyphForName', () => {
	it.each([
		['Filter Cutoff', 'cutoff'],
		['Cutoff', 'cutoff'],
		['Resonance', 'resonance'],
		['Amp Attack', 'attack'],
		['Filter Env Decay', 'decay'],
		['Release', 'release'],
		['Reverb', 'reverb'],
		['Delay Time', 'delay'],
		['Dry/Wet', 'mix'],
		['Drive', 'drive'],
		['Transpose', 'transpose'],
		['Volume', 'gain'],
		['Stereo Width', 'width'],
		['LFO Rate', 'lfo'],
		['Bitcrush', 'redux']
	])('reads %s as %s', (name, glyph) => {
		expect(glyphForName(name)).toBe(glyph);
	});

	it('answers nothing for a name that says nothing', () => {
		expect(glyphForName('Macro 7 Thing')).toBe('macro');
		expect(glyphForName('Zorp')).toBeUndefined();
		expect(glyphForName('')).toBeUndefined();
		expect(glyphForName(null)).toBeUndefined();
	});

	it('only ever answers a glyph ControlGlyph draws', () => {
		for (const name of ['Cutoff', 'Space', 'Shape', 'Chance', 'Swing', 'Sub', 'Comp', 'Tone'])
			expect(CONTROL_GLYPHS).toContain(glyphForName(name));
	});
});
