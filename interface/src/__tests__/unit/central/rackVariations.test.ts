import { describe, expect, it } from 'vitest';
import { parseVariations, variationLabels } from '$lib/components/v6/central/RackVariations.svelte';

describe('parseVariations (ADR-531)', () => {
	it('reads the count and the selected variation', () => {
		expect(parseVariations('{"count":4,"selected":1}')).toEqual({ count: 4, selected: 1 });
		expect(parseVariations('{"count":0,"selected":-1}')).toEqual({ count: 0, selected: -1 });
	});
	it('is null before the row answers or on a malformed value', () => {
		expect(parseVariations(undefined)).toBeNull();
		expect(parseVariations('not json')).toBeNull();
	});
});

describe('variationLabels (ADR-531)', () => {
	it("uses the file's names when there are as many as Live's variations", () => {
		expect(variationLabels(2, ['Boombox', 'Cheap Unit'])).toEqual(['Boombox', 'Cheap Unit']);
	});
	it('numbers them when there are no names or the count no longer matches', () => {
		expect(variationLabels(3, null)).toEqual(['1', '2', '3']);
		expect(variationLabels(3, ['Boombox', 'Cheap Unit'])).toEqual(['1', '2', '3']);
	});
	it('numbers an unnamed variation among named ones', () => {
		expect(variationLabels(2, ['A', ' '])).toEqual(['A', '2']);
	});
});

import { liveMacroSlots } from '$lib/utils/macroLayoutUtils';

describe("liveMacroSlots: Live's macro panel (ADR-532)", () => {
	const names = ['Device On', 'Drive', 'Tone', 'Macro 3', 'Macro 4', 'Mix', 'Macro 6', 'Macro 7', 'Macro 8'];
	it('lays eight visible macros out as Live does, 1-4 over 5-8', () => {
		const g = liveMacroSlots(names, 8);
		expect([g.rows, g.cols]).toEqual([2, 4]);
		expect(g.slots.map((m) => m?.macroIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(g.slots.map((m) => m?.dim)).toEqual([false, false, true, true, false, true, true, true]);
		expect(g.slots[4]?.name).toBe('Mix');
	});
	it('follows the visible count, eight when unknown, an odd count leaving the last place empty', () => {
		expect(liveMacroSlots(names, undefined).cols).toBe(4);
		const g = liveMacroSlots(names, 5);
		expect([g.rows, g.cols, g.slots.length, g.slots[5]]).toEqual([2, 3, 6, null]);
		expect(liveMacroSlots(names, 1)).toMatchObject({ rows: 1, cols: 1 });
		expect(liveMacroSlots(names, 16).cols).toBe(8);
	});
});
