import { describe, it, expect } from 'vitest';
import { segmentIndex, gridCellIndex, type ScrubBox } from '$lib/utils/segmentScrub';

const BOX: ScrubBox = { left: 100, top: 50, width: 240, height: 80 };

describe('segmentIndex', () => {
	it('divides the axis into equal steps, first step inclusive of the start', () => {
		// 240px / 6 steps = 40px each, starting at 100.
		expect(segmentIndex(100, 100, 240, 6)).toBe(0);
		expect(segmentIndex(139, 100, 240, 6)).toBe(0);
		expect(segmentIndex(140, 100, 240, 6)).toBe(1);
		expect(segmentIndex(300, 100, 240, 6)).toBe(5);
	});

	it('clamps past either end, so a finger sliding off keeps the end step', () => {
		expect(segmentIndex(-500, 100, 240, 6)).toBe(0);
		expect(segmentIndex(5000, 100, 240, 6)).toBe(5);
		// The exact far edge is the LAST step, not one past it.
		expect(segmentIndex(340, 100, 240, 6)).toBe(5);
	});

	it('is total on degenerate boxes rather than returning NaN or -1', () => {
		expect(segmentIndex(120, 100, 0, 6)).toBe(0);
		expect(segmentIndex(120, 100, -10, 6)).toBe(0);
		expect(segmentIndex(120, 100, Number.NaN, 6)).toBe(0);
		expect(segmentIndex(120, 100, 240, 0)).toBe(0);
	});
});

describe('gridCellIndex', () => {
	it('reads row-major, the order an {#each} fills a CSS grid', () => {
		// 4 cols x 2 rows over the box: 60px columns, 40px rows.
		expect(gridCellIndex(100, 50, BOX, 4, 2)).toBe(0); // top-left
		expect(gridCellIndex(339, 50, BOX, 4, 2)).toBe(3); // top-right
		expect(gridCellIndex(100, 90, BOX, 4, 2)).toBe(4); // start of row 2
		expect(gridCellIndex(339, 129, BOX, 4, 2)).toBe(7); // bottom-right
	});

	it('clamps on both axes independently', () => {
		expect(gridCellIndex(-999, -999, BOX, 4, 2)).toBe(0);
		expect(gridCellIndex(9999, 9999, BOX, 4, 2)).toBe(7);
		// Off the left but low down: row clamps up, column clamps left.
		expect(gridCellIndex(-999, 9999, BOX, 4, 2)).toBe(4);
	});

	it('handles the 3x2 shape the OSC 2 waveform grid uses', () => {
		// 80px columns. Cell 0 is the OSC badge; waves are cells 1..5.
		expect(gridCellIndex(100, 50, BOX, 3, 2)).toBe(0);
		expect(gridCellIndex(180, 50, BOX, 3, 2)).toBe(1);
		expect(gridCellIndex(260, 50, BOX, 3, 2)).toBe(2);
		expect(gridCellIndex(100, 90, BOX, 3, 2)).toBe(3);
		expect(gridCellIndex(339, 129, BOX, 3, 2)).toBe(5);
	});
});
