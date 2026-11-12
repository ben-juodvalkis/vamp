import { describe, expect, it } from 'vitest';
import { cellHeightClass, cellWidthClass, CELL_TALL_MIN, CELL_WIDTH_STEPS } from '$lib/components/v6/device-panel/chain/cellSize';
import { rackMacroFit, RACK_MACRO_MIN } from '$lib/components/v6/device-panel/chain/RackFace.svelte';
import { permuteFaceLayout, PERMUTE_PITCH_FLOOR } from '$lib/components/v6/device-panel/chain/PermuteStepsFace.svelte';

describe('cellWidthClass (ADR-492)', () => {
	it('is null until the cell is measured', () => {
		expect(cellWidthClass(0)).toBeNull();
		expect(cellWidthClass(Number.NaN)).toBeNull();
	});
	it('steps at the medium and wide bounds', () => {
		expect(cellWidthClass(CELL_WIDTH_STEPS.medium - 1)).toBe('narrow');
		expect(cellWidthClass(CELL_WIDTH_STEPS.medium)).toBe('medium');
		expect(cellWidthClass(CELL_WIDTH_STEPS.wide - 1)).toBe('medium');
		expect(cellWidthClass(CELL_WIDTH_STEPS.wide)).toBe('wide');
	});
});

describe('cellHeightClass (ADR-492)', () => {
	it('is short below the tall bound and tall from it, null unmeasured', () => {
		expect(cellHeightClass(0)).toBeNull();
		expect(cellHeightClass(CELL_TALL_MIN - 1)).toBe('short');
		expect(cellHeightClass(CELL_TALL_MIN)).toBe('tall');
	});
});

describe('rackMacroFit', () => {
	it('draws nothing before the face is measured', () => {
		expect(rackMacroFit(8, 0, 0).shown).toBe(0);
	});
	it('shows every visible macro the face has room for, and no more', () => {
		// A one-row chain's two-unit rack on the iPad, about 160 x 155: two rows of three.
		expect(rackMacroFit(8, 160, 155)).toEqual({ shown: 6, rows: 2, cols: 3 });
		expect(rackMacroFit(16, 160, 240)).toEqual({ shown: 9, rows: 3, cols: 3 });
		// A two-row chain's, about 160 x 100: one row of three.
		expect(rackMacroFit(8, 160, 100)).toEqual({ shown: 3, rows: 1, cols: 3 });
	});
	it('takes as few rows as hold what it shows', () => {
		expect(rackMacroFit(2, 160, 240)).toEqual({ shown: 2, rows: 1, cols: 2 });
		expect(rackMacroFit(4, 160, 240)).toEqual({ shown: 4, rows: 2, cols: 2 });
	});
	it('keeps one macro in a face smaller than one box', () => {
		expect(rackMacroFit(8, RACK_MACRO_MIN.w - 10, RACK_MACRO_MIN.h - 10).shown).toBe(1);
	});
});

describe('permuteFaceLayout', () => {
	const size = (width: number, height: number) => ({ width, height, widthClass: null, heightClass: null });
	it('draws both lanes where each fits in half the cell at the floor, wrapping each to two lines', () => {
		// A one-row chain's medium cell, 8 + 8: two lines of four each, about 49 x 56.
		expect(permuteFaceLayout(size(198, 230), 8, 8)).toEqual({ showPitch: true, muteLines: 2, pitchLines: 2 });
		// A wide one: one line of eight each, about 75 x 112, beats two of four (150 x 56).
		expect(permuteFaceLayout(size(600, 230), 8, 8)).toEqual({ showPitch: true, muteLines: 1, pitchLines: 1 });
	});
	it('never wraps a lane past two lines beside the other', () => {
		const tall = permuteFaceLayout(size(PERMUTE_PITCH_FLOOR * 8, 1000), 16, 16);
		expect(tall.showPitch).toBe(true);
		expect(tall.muteLines).toBeLessThanOrEqual(2);
		expect(tall.pitchLines).toBeLessThanOrEqual(2);
	});
	it('hides pitch when either lane would fall under the floor, the mute lane then filling the cell', () => {
		// 16 + 16 in the medium cell: half the height leaves 25 x 56 at best.
		expect(permuteFaceLayout(size(198, 230), 16, 16)).toEqual({ showPitch: false, muteLines: 4, pitchLines: 1 });
		// A long pitch lane alone hides it too.
		expect(permuteFaceLayout(size(198, 230), 8, 16).showPitch).toBe(false);
		// A two-row chain's short cell.
		expect(permuteFaceLayout(size(198, 116), 8, 8)).toEqual({ showPitch: false, muteLines: 2, pitchLines: 1 });
		expect(permuteFaceLayout(size(198, 116), 16, 8)).toEqual({ showPitch: false, muteLines: 4, pitchLines: 1 });
	});
	it('draws both lanes, one line each, outside the chain or before measuring', () => {
		expect(permuteFaceLayout(null, 16, 16)).toEqual({ showPitch: true, muteLines: 1, pitchLines: 1 });
		expect(permuteFaceLayout(size(0, 0), 16, 16)).toEqual({ showPitch: true, muteLines: 1, pitchLines: 1 });
	});
});
