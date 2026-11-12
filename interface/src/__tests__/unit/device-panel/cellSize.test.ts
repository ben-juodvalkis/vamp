import { describe, expect, it } from 'vitest';
import { cellHeightClass, cellWidthClass, CELL_TALL_MIN, CELL_WIDTH_STEPS } from '$lib/components/v6/device-panel/chain/cellSize';
import { rackMacroWindow } from '$lib/components/v6/device-panel/chain/RackFace.svelte';
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

describe('rackMacroWindow (ADR-532)', () => {
	const named = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'slider' as const, macroIndex: i + 1, name: `M${i + 1}`, dim: false }));
	const grid8 = { rows: 2, cols: 4, slots: named(8) };
	it('shows the whole panel before the face is measured', () => {
		expect(rackMacroWindow(grid8, 0, 0)).toEqual({ rows: 2, cols: 4, more: 0, compact: false });
	});
	it("shows Live's two rows at full size in a tall cell", () => {
		// A one-row chain's rack on the iPad: about 290 x 155.
		expect(rackMacroWindow(grid8, 290, 155)).toEqual({ rows: 2, cols: 4, more: 0, compact: false });
	});
	it('shows the left columns of both rows where the cell is narrow, counting the rest', () => {
		expect(rackMacroWindow(grid8, 150, 155)).toEqual({ rows: 2, cols: 2, more: 4, compact: false });
	});
	it('keeps both rows in a short cell with compact knobs', () => {
		// A two-row chain's rack: about 150 x 95.
		expect(rackMacroWindow(grid8, 150, 95)).toEqual({ rows: 2, cols: 2, more: 4, compact: true });
	});
	it('drops to the top row only where even compact knobs cannot make two', () => {
		expect(rackMacroWindow(grid8, 150, 60)).toEqual({ rows: 1, cols: 2, more: 6, compact: false });
	});
	it('counts only named macros left out, not the dim ones', () => {
		const dim = (i: number) => ({ type: 'slider' as const, macroIndex: i, name: `Macro ${i}`, dim: true });
		const slots = [...named(2), dim(3), dim(4), ...named(4)];
		expect(rackMacroWindow({ rows: 2, cols: 4, slots }, 150, 155).more).toBe(2);
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
