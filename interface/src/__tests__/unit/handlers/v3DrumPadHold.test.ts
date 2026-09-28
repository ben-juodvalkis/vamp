/**
 * v3DrumPadHold — the surface's "this pad is held on the Move" message
 * lands on the pad scope as an external hold (ADR-432).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('$lib/stores/v6/selectedTrackStore.svelte', () => ({
	selectedTrackStore: { propertyValue: vi.fn(), setPropertyValue: vi.fn() }
}));

import {
	V3_DRUM_PAD_HOLD_ADDRESS,
	handleV3DrumPadHold,
	isV3DrumPadHoldAddress
} from '$lib/api/handlers/v3DrumPadHold';
import { handleV3HandshakeAccept } from '$lib/api/handlers/v3Handshake';
import { drumPadScope } from '$lib/stores/v6/drumPadScope.svelte';
import { logger } from '$lib/utils/logger';

const RACK = 'tracks/1/devices/0';

describe('v3DrumPadHold', () => {
	beforeEach(() => {
		drumPadScope.clear();
		vi.mocked(logger.warn).mockClear();
	});

	it('answers to its address only', () => {
		expect(isV3DrumPadHoldAddress(V3_DRUM_PAD_HOLD_ADDRESS)).toBe(true);
		expect(isV3DrumPadHoldAddress('/looping/v3/move/pad_hold')).toBe(false);
	});

	it('presses the pad on its rack for held=1 and releases it for held=0', () => {
		handleV3DrumPadHold(V3_DRUM_PAD_HOLD_ADDRESS, [RACK, 38, 1]);
		expect(drumPadScope.scopeNote(RACK)).toBe(38);
		handleV3DrumPadHold(V3_DRUM_PAD_HOLD_ADDRESS, [RACK, 38, 0]);
		expect(drumPadScope.scopeNote(RACK)).toBeNull();
		expect(drumPadScope.latchedNote(RACK)).toBeNull(); // never a latch
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("releases only the rack's own hold: a release for the same note on another rack is not ours", () => {
		handleV3DrumPadHold(V3_DRUM_PAD_HOLD_ADDRESS, [RACK, 36, 1]);
		handleV3DrumPadHold(V3_DRUM_PAD_HOLD_ADDRESS, ['tracks/4/devices/0', 36, 0]);
		expect(drumPadScope.scopeNote(RACK)).toBe(36);
		handleV3DrumPadHold(V3_DRUM_PAD_HOLD_ADDRESS, ['tracks/4/devices/0', 36, 1]);
		expect(drumPadScope.scopeNote(RACK)).toBeNull();
		expect(drumPadScope.scopeNote('tracks/4/devices/0')).toBe(36);
	});

	it('holds two pads as two holds', () => {
		handleV3DrumPadHold(V3_DRUM_PAD_HOLD_ADDRESS, [RACK, 36, 1]);
		handleV3DrumPadHold(V3_DRUM_PAD_HOLD_ADDRESS, [RACK, 38, 1]);
		expect(drumPadScope.heldNotes(RACK)).toEqual([36, 38]);
		handleV3DrumPadHold(V3_DRUM_PAD_HOLD_ADDRESS, [RACK, 36, 0]);
		expect(drumPadScope.heldNotes(RACK)).toEqual([38]);
	});

	it('drops every external hold on a handshake accept, and only those', () => {
		handleV3DrumPadHold(V3_DRUM_PAD_HOLD_ADDRESS, [RACK, 38, 1]);
		drumPadScope.press(RACK, 40, 1, 0); // a finger, still down
		handleV3HandshakeAccept(['3.11.0', 'sess-fresh', 7]);
		expect(drumPadScope.heldNotes(RACK)).toEqual([40]);
	});

	it('takes a rack on the master too', () => {
		handleV3DrumPadHold(V3_DRUM_PAD_HOLD_ADDRESS, ['master/devices/2', 38, 1]);
		expect(drumPadScope.scopeNote('master/devices/2')).toBe(38);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it.each([
		['short', [RACK, 38]],
		['empty rack path', ['', 38, 1]],
		['a track path, not a device path', ['tracks/1', 38, 1]],
		['a pad path', ['tracks/1/devices/0/pads/38', 38, 1]],
		['a parameter path', ['tracks/1/devices/0/params/3', 38, 1]],
		['a leading zero', ['tracks/01/devices/0', 38, 1]],
		['note out of range', [RACK, 128, 1]],
		['fractional note', [RACK, 38.5, 1]],
		['held not 0|1', [RACK, 38, 2]]
	])('drops a malformed message (%s) with a warning and touches nothing', (_label, args) => {
		handleV3DrumPadHold(V3_DRUM_PAD_HOLD_ADDRESS, args as never);
		expect(drumPadScope.scopeNote(RACK)).toBeNull();
		expect(logger.warn).toHaveBeenCalledTimes(1);
	});
});
