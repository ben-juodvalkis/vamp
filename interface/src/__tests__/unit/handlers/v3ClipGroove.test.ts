/**
 * vitest coverage for the PR-5e2 v3 clip-groove dispatcher
 * (`handleV3ClipGroove`).
 *
 * Pairs with `test_groove_component.py` (producer side). These tests
 * cover the UI-side wire-to-store routing:
 *
 *  1. `/looping/v3/clip/groove/has_groove` flips the scalar
 *     `hasGroove` via `clipGrooveStore.handleHasGroove`.
 *  2. `/looping/v3/clip/groove/property` routes the 5 property names
 *     (`base`, `timing_amount`, `quantization_amount`,
 *     `random_amount`, `velocity_amount`) through
 *     `handleGrooveProperty`.
 *  3. Late-echo filter: fires whose clipPath doesn't match
 *     `session.focusedClipPath` are dropped on both addresses
 *     (write-path asymmetry from 04 §3.6).
 *  4. Address constants + `isV3ClipGrooveAddress` gate.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

const { mockSessionState, mockStore } = vi.hoisted(() => {
	const state = { focusedClipPath: null as string | null };
	const store = {
		handleHasGroove: vi.fn(),
		handleGrooveProperty: vi.fn(),
		handleFile: vi.fn()
	};
	return { mockSessionState: state, mockStore: store };
});

vi.mock('$lib/stores/session.svelte', () => ({
	session: {
		get focusedClipPath() {
			return mockSessionState.focusedClipPath;
		}
	}
}));

vi.mock('$lib/stores/v6/clipGrooveStore.svelte', () => ({
	clipGrooveStore: mockStore
}));

import {
	handleV3ClipGroove,
	isV3ClipGrooveAddress,
	V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS,
	V3_CLIP_GROOVE_PROPERTY_ADDRESS,
	V3_CLIP_GROOVE_SET_BASE_ADDRESS,
	V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS,
	V3_CLIP_GROOVE_SET_QUANTIZATION_AMOUNT_ADDRESS,
	V3_CLIP_GROOVE_SET_RANDOM_AMOUNT_ADDRESS,
	V3_CLIP_GROOVE_SET_VELOCITY_AMOUNT_ADDRESS,
	V3_CLIP_GROOVE_FILE_ADDRESS,
	V3_CLIP_GROOVE_SET_FILE_ADDRESS
} from '$lib/api/handlers/v3ClipGroove';

describe('v3ClipGroove handler', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSessionState.focusedClipPath = null;
	});

	describe('isV3ClipGrooveAddress', () => {
		it('matches the two inbound addresses', () => {
			expect(isV3ClipGrooveAddress(V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS)).toBe(true);
			expect(isV3ClipGrooveAddress(V3_CLIP_GROOVE_PROPERTY_ADDRESS)).toBe(true);
		});

		it('rejects the 5 outbound UI→Surf write addresses', () => {
			expect(isV3ClipGrooveAddress(V3_CLIP_GROOVE_SET_BASE_ADDRESS)).toBe(false);
			expect(isV3ClipGrooveAddress(V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS)).toBe(
				false
			);
			expect(
				isV3ClipGrooveAddress(V3_CLIP_GROOVE_SET_QUANTIZATION_AMOUNT_ADDRESS)
			).toBe(false);
			expect(isV3ClipGrooveAddress(V3_CLIP_GROOVE_SET_RANDOM_AMOUNT_ADDRESS)).toBe(
				false
			);
			expect(
				isV3ClipGrooveAddress(V3_CLIP_GROOVE_SET_VELOCITY_AMOUNT_ADDRESS)
			).toBe(false);
		});

		it('rejects unrelated addresses', () => {
			expect(isV3ClipGrooveAddress('/looping/v3/clip/focused')).toBe(false);
			expect(isV3ClipGrooveAddress('/clip/groove/swing')).toBe(false);
			expect(isV3ClipGrooveAddress('')).toBe(false);
		});
	});

	describe('address constants', () => {
		it('outbound write addresses are the v3 /clip/groove/set/<attr> paths', () => {
			expect(V3_CLIP_GROOVE_SET_BASE_ADDRESS).toBe('/looping/v3/clip/groove/set/base');
			expect(V3_CLIP_GROOVE_SET_TIMING_AMOUNT_ADDRESS).toBe(
				'/looping/v3/clip/groove/set/timing_amount'
			);
			expect(V3_CLIP_GROOVE_SET_QUANTIZATION_AMOUNT_ADDRESS).toBe(
				'/looping/v3/clip/groove/set/quantization_amount'
			);
			expect(V3_CLIP_GROOVE_SET_RANDOM_AMOUNT_ADDRESS).toBe(
				'/looping/v3/clip/groove/set/random_amount'
			);
			expect(V3_CLIP_GROOVE_SET_VELOCITY_AMOUNT_ADDRESS).toBe(
				'/looping/v3/clip/groove/set/velocity_amount'
			);
		});
	});

	describe('/looping/v3/clip/groove/has_groove', () => {
		beforeEach(() => {
			mockSessionState.focusedClipPath = 'tracks/0/slots/0/clip';
		});

		it('forwards true (int 1) to handleHasGroove', () => {
			handleV3ClipGroove(V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS, [
				'tracks/0/slots/0/clip',
				1
			]);
			expect(mockStore.handleHasGroove).toHaveBeenCalledWith(true);
		});

		it('forwards false (int 0) to handleHasGroove', () => {
			handleV3ClipGroove(V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS, [
				'tracks/0/slots/0/clip',
				0
			]);
			expect(mockStore.handleHasGroove).toHaveBeenCalledWith(false);
		});

		it('drops fires for a non-focused clipPath (late-echo filter)', () => {
			handleV3ClipGroove(V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS, [
				'tracks/0/slots/1/clip',
				1
			]);
			expect(mockStore.handleHasGroove).not.toHaveBeenCalled();
		});

		it('drops arity-deficient messages without crashing', () => {
			handleV3ClipGroove(V3_CLIP_GROOVE_HAS_GROOVE_ADDRESS, [
				'tracks/0/slots/0/clip'
			]);
			expect(mockStore.handleHasGroove).not.toHaveBeenCalled();
		});
	});

	describe('/looping/v3/clip/groove/property routing', () => {
		beforeEach(() => {
			mockSessionState.focusedClipPath = 'tracks/0/slots/0/clip';
		});

		it('routes base to handleGrooveProperty("base", <int>)', () => {
			handleV3ClipGroove(V3_CLIP_GROOVE_PROPERTY_ADDRESS, [
				'tracks/0/slots/0/clip',
				'base',
				2
			]);
			expect(mockStore.handleGrooveProperty).toHaveBeenCalledWith('base', 2);
		});

		it('routes timing_amount to handleGrooveProperty(name, float)', () => {
			handleV3ClipGroove(V3_CLIP_GROOVE_PROPERTY_ADDRESS, [
				'tracks/0/slots/0/clip',
				'timing_amount',
				42.5
			]);
			expect(mockStore.handleGrooveProperty).toHaveBeenCalledWith(
				'timing_amount',
				42.5
			);
		});

		it('routes all four *_amount names', () => {
			for (const name of [
				'quantization_amount',
				'random_amount',
				'velocity_amount'
			]) {
				handleV3ClipGroove(V3_CLIP_GROOVE_PROPERTY_ADDRESS, [
					'tracks/0/slots/0/clip',
					name,
					17
				]);
				expect(mockStore.handleGrooveProperty).toHaveBeenCalledWith(name, 17);
			}
		});

		it('drops property fires for a non-focused clipPath (late-echo filter)', () => {
			handleV3ClipGroove(V3_CLIP_GROOVE_PROPERTY_ADDRESS, [
				'tracks/0/slots/1/clip',
				'timing_amount',
				50
			]);
			expect(mockStore.handleGrooveProperty).not.toHaveBeenCalled();
		});

		it('drops all fires when no clip is focused (null)', () => {
			mockSessionState.focusedClipPath = null;
			handleV3ClipGroove(V3_CLIP_GROOVE_PROPERTY_ADDRESS, [
				'tracks/0/slots/0/clip',
				'base',
				1
			]);
			expect(mockStore.handleGrooveProperty).not.toHaveBeenCalled();
		});

		it('drops property messages with fewer than 3 args', () => {
			handleV3ClipGroove(V3_CLIP_GROOVE_PROPERTY_ADDRESS, [
				'tracks/0/slots/0/clip',
				'base'
			]);
			expect(mockStore.handleGrooveProperty).not.toHaveBeenCalled();
		});
	});

	describe('clip/groove/file (the groove chooser, 2026-09-29)', () => {
		it('is inbound; set/file is not', () => {
			expect(isV3ClipGrooveAddress(V3_CLIP_GROOVE_FILE_ADDRESS)).toBe(true);
			expect(isV3ClipGrooveAddress(V3_CLIP_GROOVE_SET_FILE_ADDRESS)).toBe(false);
			expect(V3_CLIP_GROOVE_SET_FILE_ADDRESS).toBe('/looping/v3/clip/groove/set/file');
		});

		it('names the focused clip\'s groove file and drops another clip\'s', () => {
			mockSessionState.focusedClipPath = 'tracks/0/slots/1/clip';
			handleV3ClipGroove(V3_CLIP_GROOVE_FILE_ADDRESS, ['tracks/0/slots/2/clip', 'Swing 8ths 73']);
			expect(mockStore.handleFile).not.toHaveBeenCalled();
			handleV3ClipGroove(V3_CLIP_GROOVE_FILE_ADDRESS, ['tracks/0/slots/1/clip', 'Swing 16ths 57']);
			expect(mockStore.handleFile).toHaveBeenCalledWith('Swing 16ths 57');
		});
	});
});
