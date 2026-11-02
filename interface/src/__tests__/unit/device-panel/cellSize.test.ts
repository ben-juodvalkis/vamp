import { describe, expect, it } from 'vitest';
import { cellHeightClass, cellWidthClass, CELL_TALL_MIN, CELL_WIDTH_STEPS } from '$lib/components/v6/device-panel/chain/cellSize';
import { rackMacrosFill } from '$lib/components/v6/device-panel/chain/RackFace.svelte';
import { permuteMuteLines, permuteShowsPitch } from '$lib/components/v6/device-panel/chain/PermuteStepsFace.svelte';

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

describe('permuteMuteLines', () => {
	type W = 'narrow' | 'medium' | 'wide';
	type H = 'short' | 'tall';
	const size = (width: number, height: number, widthClass: W = 'medium', heightClass: H = 'short') => ({
		width,
		height,
		widthClass,
		heightClass
	});
	it('picks the one, two or four lines that make a step squarest', () => {
		// One-row chain: 4 lines of 4 at about 50 x 57.
		expect(permuteMuteLines(size(198, 230, 'medium', 'tall'), 16)).toBe(4);
		// Two-row chain: 4 lines of 4 (50 x 29) beats 2 of 8 (25 x 58).
		expect(permuteMuteLines(size(198, 116), 16)).toBe(4);
		// Eight steps there: 2 lines of 4 (49 x 58) beats 4 of 2 (99 x 29).
		expect(permuteMuteLines(size(198, 116), 8)).toBe(2);
		// Never three: 8 steps in a cell where 3 would win still get 4.
		expect(permuteMuteLines(size(198, 230, 'medium', 'tall'), 8)).toBe(4);
		// A short pattern in a long cell stays one line.
		expect(permuteMuteLines(size(198, 116), 2)).toBe(1);
	});
	it('keeps one line beside the pitch row, outside the chain, and before measuring', () => {
		expect(permuteMuteLines(size(400, 230, 'wide', 'tall'), 16)).toBe(1);
		expect(permuteMuteLines(null, 16)).toBe(1);
		expect(permuteMuteLines(size(0, 0), 16)).toBe(1);
	});
});
