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
