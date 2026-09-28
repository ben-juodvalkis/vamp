/**
 * Tests for the v3 Permute step-position telemetry store + its handler.
 *
 * This store exists because Permute's "Mute Current"/"Pitch Current"
 * params arrive frozen (Live fires no value-changed for "Visible (Not
 * Stored)" params), so step position rides a dedicated telemetry wire
 * instead of `paramByPath`. See stores/v3/permuteSteps.svelte.ts.
 *
 * The invariants worth protecting here are the ones whose absence caused
 * real bugs: mute and pitch must not collide, devices must not collide,
 * and the wire value must not be silently re-offset.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
	applyPermuteStep,
	clearPermuteSteps,
	permuteStepStore,
	__resetPermuteStepStoreForTests
} from '$lib/stores/v3/permuteSteps.svelte';
import {
	handleV3PermuteStep,
	isV3PermuteStepAddress,
	V3_PERMUTE_STEP_ADDRESS
} from '$lib/api/handlers/v3PermuteStep';

const DEV_A = 'tracks/0/devices/1';
const DEV_B = 'tracks/2/devices/1';

beforeEach(() => {
	__resetPermuteStepStoreForTests();
});

describe('permuteStepStore', () => {
	it('reports idle for a device it has never heard from', () => {
		expect(permuteStepStore.get(DEV_A)).toEqual({ mute: -1, pitch: -1 });
	});

	it('stores mute and pitch independently for one device', () => {
		applyPermuteStep(DEV_A, 'mute', 3);
		applyPermuteStep(DEV_A, 'pitch', 6);

		expect(permuteStepStore.get(DEV_A)).toEqual({ mute: 3, pitch: 6 });
	});

	it('writing one kind preserves the other', () => {
		applyPermuteStep(DEV_A, 'mute', 3);
		applyPermuteStep(DEV_A, 'pitch', 6);
		applyPermuteStep(DEV_A, 'mute', 4);

		expect(permuteStepStore.get(DEV_A)).toEqual({ mute: 4, pitch: 6 });
	});

	it('keeps devices independent', () => {
		applyPermuteStep(DEV_A, 'mute', 1);
		applyPermuteStep(DEV_B, 'mute', 7);

		expect(permuteStepStore.get(DEV_A).mute).toBe(1);
		expect(permuteStepStore.get(DEV_B).mute).toBe(7);
	});

	it('carries the step verbatim — 0 is a real step, -1 is idle', () => {
		applyPermuteStep(DEV_A, 'mute', 0);
		applyPermuteStep(DEV_A, 'pitch', -1);

		expect(permuteStepStore.get(DEV_A)).toEqual({ mute: 0, pitch: -1 });
	});

	it('rejects an unknown kind', () => {
		// @ts-expect-error — exercising the runtime guard
		expect(applyPermuteStep(DEV_A, 'reverb', 3)).toBe(false);
		expect(permuteStepStore.get(DEV_A).mute).toBe(-1);
	});

	it('rejects an empty devicePath', () => {
		expect(applyPermuteStep('', 'mute', 3)).toBe(false);
	});

	it('clearPermuteSteps drops everything back to idle', () => {
		applyPermuteStep(DEV_A, 'mute', 3);
		applyPermuteStep(DEV_B, 'pitch', 5);

		clearPermuteSteps();

		expect(permuteStepStore.size()).toBe(0);
		expect(permuteStepStore.get(DEV_A)).toEqual({ mute: -1, pitch: -1 });
	});

	it('clears on bridge-resync so a reconnect never paints a stale step', () => {
		applyPermuteStep(DEV_A, 'mute', 3);

		window.dispatchEvent(new CustomEvent('bridge-resync'));

		expect(permuteStepStore.get(DEV_A).mute).toBe(-1);
	});
});

describe('handleV3PermuteStep', () => {
	it('matches only its own address', () => {
		expect(isV3PermuteStepAddress(V3_PERMUTE_STEP_ADDRESS)).toBe(true);
		expect(isV3PermuteStepAddress('/looping/v3/param/value')).toBe(false);
	});

	it('routes a well-formed fire into the store', () => {
		handleV3PermuteStep(V3_PERMUTE_STEP_ADDRESS, [DEV_A, 'mute', 5]);

		expect(permuteStepStore.get(DEV_A).mute).toBe(5);
	});

	it('routes the idle sentinel', () => {
		handleV3PermuteStep(V3_PERMUTE_STEP_ADDRESS, [DEV_A, 'pitch', -1]);

		expect(permuteStepStore.get(DEV_A).pitch).toBe(-1);
	});

	it('drops short args', () => {
		handleV3PermuteStep(V3_PERMUTE_STEP_ADDRESS, [DEV_A, 'mute']);

		expect(permuteStepStore.size()).toBe(0);
	});

	it('drops an unknown kind', () => {
		handleV3PermuteStep(V3_PERMUTE_STEP_ADDRESS, [DEV_A, 'reverb', 3]);

		expect(permuteStepStore.size()).toBe(0);
	});

	it('drops a non-numeric step', () => {
		handleV3PermuteStep(V3_PERMUTE_STEP_ADDRESS, [DEV_A, 'mute', 'three']);

		expect(permuteStepStore.size()).toBe(0);
	});

	it('coerces a numeric string step (OSC senders may type it loosely)', () => {
		handleV3PermuteStep(V3_PERMUTE_STEP_ADDRESS, [DEV_A, 'mute', '5']);

		expect(permuteStepStore.get(DEV_A).mute).toBe(5);
	});
});
