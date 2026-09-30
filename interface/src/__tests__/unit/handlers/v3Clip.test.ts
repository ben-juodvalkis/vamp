/**
 * vitest coverage for the PR-5e1 v3 clip dispatcher (`handleV3Clip`).
 *
 * Pairs with the pytest suite
 * `surface/tests/test_clip_properties_component.py`,
 * which covers producer behaviour. These tests cover the UI side of
 * the PR-5e1 plumbing:
 *
 *  1. `/looping/v3/clip/focused` → `handleFocusedClipPath` (empty
 *     string normalizes to null-ish).
 *  2. `/looping/v3/clip/property` routes to scalar
 *     `clipPropertiesStore` handlers.
 *  3. Late-echo filter: property fires whose clipPath doesn't match
 *     `session.focusedClipPath` are dropped.
 *  4. Address constants + `isV3ClipAddress` gate.
 *
 * Unit coverage for `handleFocusedClipPath` + `clipPropertiesStore.clearAll`
 * lives in sibling files; this file focuses on wire-to-store routing.
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

const { mockSessionState, mockHandleFocusedClipPath, mockStore } = vi.hoisted(() => {
	const state = { focusedClipPath: null as string | null };
	const handler = vi.fn((path: string) => {
		state.focusedClipPath = path === '' ? null : path;
	});
	const store = {
		handleLoopStart: vi.fn(),
		handleLoopEnd: vi.fn(),
		handleStartMarker: vi.fn(),
		handleEndMarker: vi.fn(),
		handleWarpMode: vi.fn(),
		handleLoopEnabled: vi.fn(),
		handlePitchCoarse: vi.fn(),
		handleGain: vi.fn(),
		handleGainDisplay: vi.fn(),
		handleWarpMarkers: vi.fn()
	};
	return { mockSessionState: state, mockHandleFocusedClipPath: handler, mockStore: store };
});

vi.mock('$lib/stores/session.svelte', () => ({
	handleFocusedClipPath: (p: string) => mockHandleFocusedClipPath(p),
	session: {
		get focusedClipPath() {
			return mockSessionState.focusedClipPath;
		}
	}
}));

vi.mock('$lib/stores/v6/clipPropertiesStore.svelte', () => ({
	clipPropertiesStore: mockStore
}));

import {
	handleV3Clip,
	isV3ClipAddress,
	V3_CLIP_FOCUSED_ADDRESS,
	V3_CLIP_PROPERTY_ADDRESS,
	V3_CLIP_SET_LOOP_START_ADDRESS,
	V3_CLIP_SET_LOOP_END_ADDRESS,
	V3_CLIP_SET_START_MARKER_ADDRESS,
	V3_CLIP_SET_END_MARKER_ADDRESS,
	V3_CLIP_SET_WARP_MODE_ADDRESS,
	V3_CLIP_SET_LOOPING_ADDRESS,
	V3_CLIP_SET_PITCH_COARSE_ADDRESS,
	V3_CLIP_WARP_MARKERS_ADDRESS,
	V3_CLIP_WARP_MARKER_MOVE_ADDRESS
} from '$lib/api/handlers/v3Clip';

describe('v3Clip handler', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSessionState.focusedClipPath = null;
	});

	describe('isV3ClipAddress', () => {
		it('matches the two inbound addresses', () => {
			expect(isV3ClipAddress(V3_CLIP_FOCUSED_ADDRESS)).toBe(true);
			expect(isV3ClipAddress(V3_CLIP_PROPERTY_ADDRESS)).toBe(true);
		});

		it('rejects UI→Surf write addresses (those are outbound)', () => {
			expect(isV3ClipAddress(V3_CLIP_SET_LOOP_START_ADDRESS)).toBe(false);
			expect(isV3ClipAddress(V3_CLIP_SET_WARP_MODE_ADDRESS)).toBe(false);
		});

		it('rejects unrelated addresses', () => {
			expect(isV3ClipAddress('/looping/v3/session/tempo')).toBe(false);
			expect(isV3ClipAddress('/clip/property/loop_start')).toBe(false);
			expect(isV3ClipAddress('')).toBe(false);
		});
	});

	describe('address constants', () => {
		it('write addresses are the v3-namespaced /clip/set/<attr> paths', () => {
			expect(V3_CLIP_SET_LOOP_START_ADDRESS).toBe('/looping/v3/clip/set/loop_start');
			expect(V3_CLIP_SET_LOOP_END_ADDRESS).toBe('/looping/v3/clip/set/loop_end');
			expect(V3_CLIP_SET_START_MARKER_ADDRESS).toBe('/looping/v3/clip/set/start_marker');
			expect(V3_CLIP_SET_END_MARKER_ADDRESS).toBe('/looping/v3/clip/set/end_marker');
			expect(V3_CLIP_SET_WARP_MODE_ADDRESS).toBe('/looping/v3/clip/set/warp_mode');
			expect(V3_CLIP_SET_LOOPING_ADDRESS).toBe('/looping/v3/clip/set/looping');
			expect(V3_CLIP_SET_PITCH_COARSE_ADDRESS).toBe('/looping/v3/clip/set/pitch_coarse');
		});
	});

	describe('/looping/v3/clip/focused', () => {
		it('forwards clipPath to handleFocusedClipPath', () => {
			handleV3Clip(V3_CLIP_FOCUSED_ADDRESS, ['tracks/0/slots/0/clip']);
			expect(mockHandleFocusedClipPath).toHaveBeenCalledWith('tracks/0/slots/0/clip');
		});

		it('forwards empty string (no focused clip)', () => {
			handleV3Clip(V3_CLIP_FOCUSED_ADDRESS, ['']);
			expect(mockHandleFocusedClipPath).toHaveBeenCalledWith('');
		});

		it('drops zero-arg messages with a warning (no crash)', () => {
			handleV3Clip(V3_CLIP_FOCUSED_ADDRESS, []);
			expect(mockHandleFocusedClipPath).not.toHaveBeenCalled();
		});
	});

	describe('/looping/v3/clip/property routing', () => {
		beforeEach(() => {
			mockSessionState.focusedClipPath = 'tracks/0/slots/0/clip';
		});

		it('routes loop_start to handleLoopStart', () => {
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/0/slots/0/clip', 'loop_start', 2.5]);
			expect(mockStore.handleLoopStart).toHaveBeenCalledWith(2.5);
		});

		it('routes loop_end to handleLoopEnd', () => {
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/0/slots/0/clip', 'loop_end', 16]);
			expect(mockStore.handleLoopEnd).toHaveBeenCalledWith(16);
		});

		it('routes start_marker to handleStartMarker', () => {
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/0/slots/0/clip', 'start_marker', 0.25]);
			expect(mockStore.handleStartMarker).toHaveBeenCalledWith(0.25);
		});

		it('routes end_marker to handleEndMarker', () => {
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/0/slots/0/clip', 'end_marker', 12]);
			expect(mockStore.handleEndMarker).toHaveBeenCalledWith(12);
		});

		it('routes warp_mode to handleWarpMode (int)', () => {
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/0/slots/0/clip', 'warp_mode', 4]);
			expect(mockStore.handleWarpMode).toHaveBeenCalledWith(4);
		});

		it('routes looping=1 to handleLoopEnabled(true)', () => {
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/0/slots/0/clip', 'looping', 1]);
			expect(mockStore.handleLoopEnabled).toHaveBeenCalledWith(true);
		});

		it('routes looping=0 to handleLoopEnabled(false)', () => {
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/0/slots/0/clip', 'looping', 0]);
			expect(mockStore.handleLoopEnabled).toHaveBeenCalledWith(false);
		});

		it('routes pitch_coarse to handlePitchCoarse (int semitones)', () => {
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/0/slots/0/clip', 'pitch_coarse', -7]);
			expect(mockStore.handlePitchCoarse).toHaveBeenCalledWith(-7);
		});

		it('routes gain to handleGain and Live\'s dB text to handleGainDisplay', () => {
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/0/slots/0/clip', 'gain', 0.4]);
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/0/slots/0/clip', 'gain_display', '-6.0 dB']);
			expect(mockStore.handleGain).toHaveBeenCalledWith(0.4);
			expect(mockStore.handleGainDisplay).toHaveBeenCalledWith('-6.0 dB');
		});

		it('drops unknown attribute name without touching store', () => {
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/0/slots/0/clip', 'bogus', 1]);
			expect(mockStore.handleLoopStart).not.toHaveBeenCalled();
			expect(mockStore.handleLoopEnabled).not.toHaveBeenCalled();
		});

		it('drops property messages with fewer than 3 args', () => {
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/0/slots/0/clip', 'loop_start']);
			expect(mockStore.handleLoopStart).not.toHaveBeenCalled();
		});
	});

	describe('late-echo filter (clipPath ≠ session.focusedClipPath)', () => {
		it('drops property fires for a non-focused clip', () => {
			mockSessionState.focusedClipPath = 'tracks/0/slots/0/clip';
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/0/slots/1/clip', 'loop_start', 4]);
			expect(mockStore.handleLoopStart).not.toHaveBeenCalled();
		});

		it('drops all fires when no clip is focused (null)', () => {
			mockSessionState.focusedClipPath = null;
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/0/slots/0/clip', 'warp_mode', 3]);
			expect(mockStore.handleWarpMode).not.toHaveBeenCalled();
		});

		it('accepts fires when clipPath matches focused', () => {
			mockSessionState.focusedClipPath = 'tracks/2/slots/3/clip';
			handleV3Clip(V3_CLIP_PROPERTY_ADDRESS, ['tracks/2/slots/3/clip', 'loop_end', 8]);
			expect(mockStore.handleLoopEnd).toHaveBeenCalledWith(8);
		});
	});

	describe('clip/warp_markers', () => {
		const PATH = 'tracks/0/slots/0/clip';

		it('is inbound; the move is outbound', () => {
			expect(isV3ClipAddress(V3_CLIP_WARP_MARKERS_ADDRESS)).toBe(true);
			expect(isV3ClipAddress(V3_CLIP_WARP_MARKER_MOVE_ADDRESS)).toBe(false);
		});

		it('hands the focused clip its markers as beat/second pairs', () => {
			mockSessionState.focusedClipPath = PATH;
			handleV3Clip(V3_CLIP_WARP_MARKERS_ADDRESS, [PATH, 1, 8, 0, 0, 4, 2]);
			expect(mockStore.handleWarpMarkers).toHaveBeenCalledWith(true, 8, [
				{ beat: 0, sec: 0 },
				{ beat: 4, sec: 2 }
			]);
		});

		it('drops markers for a clip that is no longer focused', () => {
			mockSessionState.focusedClipPath = 'tracks/1/slots/0/clip';
			handleV3Clip(V3_CLIP_WARP_MARKERS_ADDRESS, [PATH, 1, 8, 0, 0]);
			expect(mockStore.handleWarpMarkers).not.toHaveBeenCalled();
		});

		it('drops a message too short to carry the header', () => {
			mockSessionState.focusedClipPath = PATH;
			handleV3Clip(V3_CLIP_WARP_MARKERS_ADDRESS, [PATH, 1]);
			expect(mockStore.handleWarpMarkers).not.toHaveBeenCalled();
		});
	});
});
