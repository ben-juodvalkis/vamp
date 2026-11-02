import { describe, expect, it } from 'vitest';
import { cellHeightClass, cellWidthClass, CELL_TALL_MIN, CELL_WIDTH_STEPS } from '$lib/components/v6/device-panel/chain/cellSize';
import { rackMacrosFill } from '$lib/components/v6/device-panel/chain/RackFace.svelte';
import { permuteMuteRows, permuteShowsPitch, PERMUTE_MIN_STEP_W } from '$lib/components/v6/device-panel/chain/PermuteStepsFace.svelte';

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

describe('permuteMuteRows', () => {
	type W = 'narrow' | 'medium' | 'wide' | null;
	const size = (widthClass: W, width: number) => ({ width, height: 200, widthClass, heightClass: 'tall' as const });
	it('wraps the mute row into two lines when a step would be too thin to tap', () => {
		expect(permuteMuteRows(size('narrow', 100), 16)).toBe(2);
		expect(permuteMuteRows(size('medium', 200), 16)).toBe(2);
		expect(permuteMuteRows(size('medium', 16 * PERMUTE_MIN_STEP_W), 16)).toBe(1);
		expect(permuteMuteRows(size('medium', 200), 4)).toBe(1);
	});
	it('keeps one line in a wide cell, outside the chain, and before measuring', () => {
		expect(permuteMuteRows(size('wide', 240), 16)).toBe(1);
		expect(permuteMuteRows(null, 16)).toBe(1);
		expect(permuteMuteRows(size(null, 0), 16)).toBe(1);
	});
});
