import { describe, it, expect } from 'vitest';
import {
	MELD_ENGINE,
	MELD_OSC_TYPES,
	MELD_FILTER_TYPES,
	MELD_FILTER_EXTRA_NAMES,
	MELD_OCTAVES,
	stepOscType
} from '$lib/components/v6/central/views/meldParams';

describe('meldParams', () => {
	it('puts every Engine B index 60 past its Engine A twin (device dump, 2026-10-22)', () => {
		for (const key of Object.keys(MELD_ENGINE.A) as (keyof typeof MELD_ENGINE.A)[]) {
			expect(MELD_ENGINE.B[key], key).toBe(MELD_ENGINE.A[key] + 60);
		}
	});

	it("lists Live's 25 oscillator types in Live's order, its labels less the scale mark", () => {
		expect(MELD_OSC_TYPES).toHaveLength(25);
		expect(MELD_OSC_TYPES[0]).toBe('Basic Shapes');
		expect(MELD_OSC_TYPES[1]).toBe('Dual Basic Shapes'); // Live: "Dual Basic Shapes  (♭♯)"
		expect(MELD_OSC_TYPES[15]).toBe("Shepard's Pi");
		expect(MELD_OSC_TYPES[24]).toBe('Chord'); // Live: "Chord  (♭♯)"
	});

	it("has a filter type for each of Live's 17 steps and Live's -3..3 octaves", () => {
		expect(MELD_FILTER_TYPES).toHaveLength(17);
		expect(MELD_OCTAVES).toEqual([-3, -2, -1, 0, 1, 2, 3]);
	});

	it("names the filter's second macro as Live does under each type (rig, 2026-10-22)", () => {
		// parameters[17].name, A Filter Type stepped 0..16, "A Filter " dropped.
		expect(MELD_FILTER_EXTRA_NAMES).toEqual([
			'L-B-H-N', 'L-B-H-N', 'Drive', 'Drive', 'Drive', 'Drive', 'Lofi', 'Drive', 'Q',
			'Q', 'Spread', 'Lofi', 'Morph', 'Damp', 'Damp', 'Ratio', 'Damp'
		]);
	});

	it('steps the oscillator type round both ends', () => {
		expect(stepOscType(0, -1)).toBe(24);
		expect(stepOscType(24, 1)).toBe(0);
		expect(stepOscType(7, 1)).toBe(8);
	});
});
