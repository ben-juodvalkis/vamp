import { describe, expect, it } from 'vitest';
import { cellHeightClass, cellWidthClass, CELL_TALL_MIN, CELL_WIDTH_STEPS } from '$lib/components/v6/device-panel/chain/cellSize';
import { rackMacrosFill } from '$lib/components/v6/device-panel/chain/RackFace.svelte';
import { permuteMuteLayout, permuteShowsPitch, PERMUTE_STEP_FLOOR } from '$lib/components/v6/device-panel/chain/PermuteStepsFace.svelte';

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

describe('rackMacrosFill (ADR-492)', () => {
	const size = (heightClass: 'short' | 'tall' | null) => ({ width: 200, height: 0, widthClass: 'medium' as const, heightClass });
	it('fills a tall cell with the macros and keeps them a strip otherwise', () => {
		expect(rackMacrosFill(size('tall'))).toBe(true);
		expect(rackMacrosFill(size('short'))).toBe(false);
		expect(rackMacrosFill(size(null))).toBe(false);
		expect(rackMacrosFill(null)).toBe(false);
	});
});

describe('permuteShowsPitch', () => {
	type W = 'narrow' | 'medium' | 'wide' | null;
	type H = 'short' | 'tall' | null;
	const size = (widthClass: W, heightClass: H) => ({ width: 0, height: 0, widthClass, heightClass });
	it('draws the pitch row only in a wide, tall cell', () => {
		expect(permuteShowsPitch(size('wide', 'tall'))).toBe(true);
		expect(permuteShowsPitch(size('medium', 'tall'))).toBe(false);
		expect(permuteShowsPitch(size('narrow', 'tall'))).toBe(false);
		expect(permuteShowsPitch(size('wide', 'short'))).toBe(false);
	});
	it('draws both rows outside a chain cell or before it is measured', () => {
		expect(permuteShowsPitch(null)).toBe(true);
		expect(permuteShowsPitch(size(null, null))).toBe(true);
	});
});

describe('permuteMuteLayout', () => {
	type W = 'narrow' | 'medium' | 'wide';
	type H = 'short' | 'tall';
	const size = (width: number, height: number, widthClass: W = 'medium', heightClass: H = 'short') => ({
		width,
		height,
		widthClass,
		heightClass
	});
	it('picks the one, two or four lines that make a step squarest', () => {
		// One-row chain, medium cell: 4 lines of 4 at about 50 x 57.
		expect(permuteMuteLayout(size(198, 230, 'medium', 'tall'), 16)).toEqual({ lines: 4, editable: true });
		// Eight steps in the same cell: 4 lines of 2 (99 x 57) beats 2 of 4 (49 x 115).
		expect(permuteMuteLayout(size(198, 230, 'medium', 'tall'), 8).lines).toBe(4);
	});
	it('only shows the steps when even the best lines are under the floor', () => {
		// Two-row chain: 4 lines of 4 at about 50 x 29, the best of 1, 2 or 4.
		expect(permuteMuteLayout(size(198, 116), 16)).toEqual({ lines: 4, editable: false });
		// Eight steps there: 2 lines of 4 at about 49 x 58.
		expect(permuteMuteLayout(size(198, 116), 8)).toEqual({ lines: 2, editable: true });
	});
	it('edits at exactly the floor', () => {
		expect(permuteMuteLayout(size(PERMUTE_STEP_FLOOR * 4, PERMUTE_STEP_FLOOR * 4), 16)).toEqual({ lines: 4, editable: true });
	});
	it('keeps one editable line beside the pitch row, outside the chain, and before measuring', () => {
		expect(permuteMuteLayout(size(400, 230, 'wide', 'tall'), 16)).toEqual({ lines: 1, editable: true });
		expect(permuteMuteLayout(null, 16)).toEqual({ lines: 1, editable: true });
		expect(permuteMuteLayout(size(0, 0), 16)).toEqual({ lines: 1, editable: true });
	});
});
