import { describe, expect, it } from 'vitest';
import { cellHeightClass, cellWidthClass, CELL_TALL_MIN, CELL_WIDTH_STEPS } from '$lib/components/v6/device-panel/chain/cellSize';
import { rackMacrosFill } from '$lib/components/v6/device-panel/chain/RackFace.svelte';

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
