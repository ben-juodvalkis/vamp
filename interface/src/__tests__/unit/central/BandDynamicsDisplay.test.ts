import { describe, expect, it } from 'vitest';
import { bandTarget, ratioFromUnit, ratioUnit } from '$lib/components/v6/central/views/multiband/BandDynamicsDisplay.svelte';

describe("Multiband Dynamics' band display (ADR-515)", () => {
	it('puts 1 : 1 in the middle of both blocks, and up louder', () => {
		expect(ratioUnit('above', 0)).toBe(0.5);
		expect(ratioUnit('below', 0)).toBe(0.5);
		// Above: -1 is 1 : Inf (downward compression) at the floor, 1 is 1 : 0.50 at the top.
		expect(ratioUnit('above', -1)).toBe(0);
		expect(ratioUnit('above', 1)).toBe(1);
		// Below: -3 is 1 : 0.25 (downward expansion) at the floor, 1 is 1 : Inf (upward compression) at the top.
		expect(ratioUnit('below', -3)).toBe(0);
		expect(ratioUnit('below', 1)).toBe(1);
	});

	it('round-trips a ratio through its position', () => {
		for (const r of [-1, -0.985, -0.3, 0, 0.5, 1]) expect(ratioFromUnit('above', ratioUnit('above', r))).toBeCloseTo(r, 9);
		for (const r of [-3, -1.5, 0, 0.76, 1]) expect(ratioFromUnit('below', ratioUnit('below', r))).toBeCloseTo(r, 9);
		expect(ratioFromUnit('above', 2)).toBe(1);
		expect(ratioFromUnit('below', -1)).toBe(-3);
	});

	it("takes a threshold's edge within reach, else the block under the finger", () => {
		// Below edge at 300px, Above edge at 600px, 22px reach.
		expect(bandTarget(310, 300, 600, 22)).toBe('below-threshold');
		expect(bandTarget(590, 300, 600, 22)).toBe('above-threshold');
		expect(bandTarget(100, 300, 600, 22)).toBe('below-ratio');
		expect(bandTarget(800, 300, 600, 22)).toBe('above-ratio');
		expect(bandTarget(450, 300, 600, 22)).toBeNull();
		// Edges together: the nearer one wins.
		expect(bandTarget(305, 300, 312, 22)).toBe('below-threshold');
		expect(bandTarget(310, 300, 312, 22)).toBe('above-threshold');
	});
});
