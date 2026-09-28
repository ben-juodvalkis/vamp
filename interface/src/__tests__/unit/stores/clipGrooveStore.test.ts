/**
 * vitest coverage for the PR-5e2 scalar `clipGrooveStore`.
 *
 * Mirrors the producer-side `GrooveComponent`'s 5 amount
 * attributes: `base`, `timing_amount`, `quantization_amount`,
 * `random_amount`, `velocity_amount`. Paired with
 * `v3ClipGroove.test.ts` (dispatch) and
 * `test_groove_component.py` (surface-side emit).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { clipGrooveStore } from '$lib/stores/v6/clipGrooveStore.svelte';

describe('clipGrooveStore', () => {
	beforeEach(() => {
		clipGrooveStore.clearAll();
	});

	describe('defaults', () => {
		it('starts with hasGroove=false and zero amounts', () => {
			expect(clipGrooveStore.hasGroove).toBe(false);
			expect(clipGrooveStore.baseGrid).toBe(1);
			expect(clipGrooveStore.timingAmount).toBe(0);
			expect(clipGrooveStore.quantizationAmount).toBe(0);
			expect(clipGrooveStore.randomAmount).toBe(0);
			expect(clipGrooveStore.velocityAmount).toBe(0);
		});

		it('baseGridLabel maps baseGrid int to human label', () => {
			// seed via handler so we don't mutate private state directly
			clipGrooveStore.handleGrooveProperty('base', 1);
			expect(clipGrooveStore.baseGridLabel).toBe('1/8');
			clipGrooveStore.handleGrooveProperty('base', 2);
			expect(clipGrooveStore.baseGridLabel).toBe('1/8T');
			clipGrooveStore.handleGrooveProperty('base', 3);
			expect(clipGrooveStore.baseGridLabel).toBe('1/16');
		});
	});

	describe('handleHasGroove', () => {
		it('flips on (true) and back off (false)', () => {
			clipGrooveStore.handleHasGroove(true);
			expect(clipGrooveStore.hasGroove).toBe(true);
			clipGrooveStore.handleHasGroove(false);
			expect(clipGrooveStore.hasGroove).toBe(false);
		});
	});

	describe('handleGrooveProperty routing', () => {
		it('routes base → baseGrid', () => {
			clipGrooveStore.handleGrooveProperty('base', 3);
			expect(clipGrooveStore.baseGrid).toBe(3);
		});

		it('routes timing_amount → timingAmount', () => {
			clipGrooveStore.handleGrooveProperty('timing_amount', 75);
			expect(clipGrooveStore.timingAmount).toBe(75);
		});

		it('routes quantization_amount → quantizationAmount', () => {
			clipGrooveStore.handleGrooveProperty('quantization_amount', 50);
			expect(clipGrooveStore.quantizationAmount).toBe(50);
		});

		it('routes random_amount → randomAmount', () => {
			clipGrooveStore.handleGrooveProperty('random_amount', 12.5);
			expect(clipGrooveStore.randomAmount).toBe(12.5);
		});

		it('routes velocity_amount → velocityAmount', () => {
			clipGrooveStore.handleGrooveProperty('velocity_amount', 100);
			expect(clipGrooveStore.velocityAmount).toBe(100);
		});

		it('silently ignores unknown property names', () => {
			clipGrooveStore.handleGrooveProperty('not_a_prop', 99);
			// None of the known fields mutated.
			expect(clipGrooveStore.baseGrid).toBe(1);
			expect(clipGrooveStore.timingAmount).toBe(0);
		});
	});

	describe('clearAll', () => {
		it('resets every field after assignment', () => {
			clipGrooveStore.handleHasGroove(true);
			clipGrooveStore.handleGrooveProperty('base', 2);
			clipGrooveStore.handleGrooveProperty('timing_amount', 80);
			clipGrooveStore.handleGrooveProperty('quantization_amount', 40);
			clipGrooveStore.handleGrooveProperty('random_amount', 20);
			clipGrooveStore.handleGrooveProperty('velocity_amount', 10);

			clipGrooveStore.clearAll();

			expect(clipGrooveStore.hasGroove).toBe(false);
			expect(clipGrooveStore.baseGrid).toBe(1);
			expect(clipGrooveStore.timingAmount).toBe(0);
			expect(clipGrooveStore.quantizationAmount).toBe(0);
			expect(clipGrooveStore.randomAmount).toBe(0);
			expect(clipGrooveStore.velocityAmount).toBe(0);
		});
	});
});
