import { describe, expect, it } from 'vitest';
import { controlFor, type ButtonsControl, type Get } from '$lib/components/v6/device-panel/deviceControls';

/** Chord's +12 and -12 (2026-10-27): each sets Shift1 to its octave, or back to 0. */
describe('Chord buttons', () => {
	const chord = controlFor('chord') as ButtonsControl;
	const at = (shift: number | undefined): Get => (ref) => (ref === 1 ? shift : undefined);

	it('is two buttons, +12 then -12', () => {
		expect(chord.kind).toBe('buttons');
		expect(chord.buttons.map((b) => b.label)).toEqual(['+12', '-12']);
	});

	it('sets the first shift to its octave, from a ghost or from 0', () => {
		expect(chord.buttons[0].press(at(undefined))).toEqual([[1, 12]]);
		expect(chord.buttons[1].press(at(0))).toEqual([[1, -12]]);
		expect(chord.buttons[1].press(at(12))).toEqual([[1, -12]]);
	});

	it('lights the button at its octave, and a press there returns to 0', () => {
		expect(chord.buttons.map((b) => b.on(at(12)))).toEqual([true, false]);
		expect(chord.buttons.map((b) => b.on(at(undefined)))).toEqual([false, false]);
		expect(chord.buttons[0].press(at(12))).toEqual([[1, 0]]);
	});
});
