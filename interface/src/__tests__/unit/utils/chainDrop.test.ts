import { describe, expect, it } from 'vitest';
import { chainDropIndex } from '$lib/utils/chainDrop';

describe('chainDropIndex', () => {
	it('moves left to the slot', () => {
		expect(chainDropIndex({ from: 3, slot: 1, count: 5, instrument: null })).toBe(1);
	});
	it('moves right to one before the slot', () => {
		expect(chainDropIndex({ from: 1, slot: 4, count: 5, instrument: null })).toBe(3);
	});
	it('moves to the end', () => {
		expect(chainDropIndex({ from: 0, slot: 5, count: 5, instrument: null })).toBe(4);
	});
	it('is no move beside where it started', () => {
		expect(chainDropIndex({ from: 2, slot: 2, count: 5, instrument: null })).toBeNull();
		expect(chainDropIndex({ from: 2, slot: 3, count: 5, instrument: null })).toBeNull();
	});
	it('never moves the instrument', () => {
		expect(chainDropIndex({ from: 1, slot: 4, count: 5, instrument: 1 })).toBeNull();
	});
	it('keeps an audio effect after the instrument', () => {
		expect(chainDropIndex({ from: 4, slot: 0, count: 5, instrument: 1 })).toBe(2);
	});
	it('keeps a MIDI effect before the instrument', () => {
		expect(chainDropIndex({ from: 0, slot: 5, count: 5, instrument: 2 })).toBe(1);
	});
});
