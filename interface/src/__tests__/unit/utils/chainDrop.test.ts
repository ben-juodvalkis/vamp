import { describe, expect, it } from 'vitest';
import { chainGrid, clampChainIndex, moved } from '$lib/utils/chainDrop';

describe('clampChainIndex', () => {
	it('lands where the finger is', () => {
		expect(clampChainIndex({ from: 3, to: 1, count: 5, instrument: null })).toBe(1);
		expect(clampChainIndex({ from: 1, to: 3, count: 5, instrument: null })).toBe(3);
	});
	it('clamps to the chain', () => {
		expect(clampChainIndex({ from: 0, to: 9, count: 5, instrument: null })).toBe(4);
	});
	it('never moves the instrument', () => {
		expect(clampChainIndex({ from: 1, to: 4, count: 5, instrument: 1 })).toBeNull();
	});
	it('keeps an audio effect after the instrument', () => {
		expect(clampChainIndex({ from: 4, to: 0, count: 5, instrument: 1 })).toBe(2);
	});
	it('keeps a MIDI effect before the instrument', () => {
		expect(clampChainIndex({ from: 0, to: 4, count: 5, instrument: 2 })).toBe(1);
	});
});

describe('moved', () => {
	it('moves one item and keeps the rest in order', () => {
		expect(moved(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
		expect(moved(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
	});
});

describe('chainGrid', () => {
	it('keeps a short chain on one row, the + cell included', () => {
		expect(chainGrid(2, 4)).toEqual({ cols: 3, rows: 1 });
		expect(chainGrid(4, 4)).toEqual({ cols: 5, rows: 1 });
	});
	it('splits a longer chain evenly over two rows', () => {
		expect(chainGrid(5, 4)).toEqual({ cols: 3, rows: 2 });
		expect(chainGrid(8, 4)).toEqual({ cols: 5, rows: 2 });
		expect(chainGrid(12, 4)).toEqual({ cols: 7, rows: 2 });
	});
	it('an empty chain is the + cell alone', () => {
		expect(chainGrid(0, 4)).toEqual({ cols: 1, rows: 1 });
	});
});
