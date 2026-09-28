/**
 * Tests for /looping/v3/param/value handler — Phase 2 PR-2b.
 *
 * Covers:
 * - Happy path: known paramPath + numeric value → v3Store updated.
 * - Unknown paramPath → silent drop (documented race-window behaviour).
 * - Short payload / empty path / non-finite value → log + drop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

import { handleV3ParamValue } from '$lib/api/handlers/v3ParamValue';
import {
	v3Store,
	replaceTree,
	_resetForTests,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import {
	armParam,
	isArmed,
	resetParamArming
} from '$lib/stores/v3/paramArming.svelte';
import { logger } from '$lib/utils/logger';

function buildTree(paramValue = 0.1): TrackRecord {
	return {
		trackPath: 'tracks/0',
		name: 't0',
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		// PR-3.5.3 — default fixture to MIDI-only.
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		// ADR-410: plain top-level track (not a group, not folded, no parent).
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		devices: new Map([
			[
				'tracks/0/devices/0',
				{
					devicePath: 'tracks/0/devices/0',
					name: 'd0',
					className: 'AudioEffect',
					params: new Map([
						[
							'tracks/0/devices/0/params/0',
							{
								paramPath: 'tracks/0/devices/0/params/0',
								name: 'p0',
								displayName: 'P0',
								min: 0,
								max: 1,
								value: paramValue,
								unit: ''
							}
						]
					]),
					properties: new Map()
				}
			]
		]),
		slots: new Map()
	};
}

describe('handleV3ParamValue', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		resetParamArming();
	});

	it('updates the v3 store param value on happy path', () => {
		replaceTree(1, [buildTree(0.1)]);

		handleV3ParamValue(['tracks/0/devices/0/params/0', 0.42]);

		const record = v3Store.paramByPath.get('tracks/0/devices/0/params/0');
		expect(record?.value).toBe(0.42);
	});

	it('silently drops when path is not in store (cold-start race)', () => {
		replaceTree(1, [buildTree(0.1)]);

		handleV3ParamValue(['tracks/9/devices/9/params/9', 0.5]);

		// No warn — debug only; original record untouched.
		expect(logger.warn).not.toHaveBeenCalled();
		expect(v3Store.paramByPath.get('tracks/0/devices/0/params/0')?.value).toBe(0.1);
	});

	it('warns and drops on short payload', () => {
		handleV3ParamValue(['tracks/0/devices/0/params/0']);

		expect(logger.warn).toHaveBeenCalledWith(
			'v3 param/value: short payload',
			expect.any(Object)
		);
	});

	it('warns and drops on empty path', () => {
		handleV3ParamValue(['', 0.5]);

		expect(logger.warn).toHaveBeenCalledWith(
			'v3 param/value: empty path',
			expect.any(Object)
		);
	});

	it('warns and drops on non-finite value', () => {
		handleV3ParamValue(['tracks/0/devices/0/params/0', Number.NaN]);

		expect(logger.warn).toHaveBeenCalledWith(
			'v3 param/value: non-finite value',
			expect.any(Object)
		);
	});

	// ============================================
	// ADR-359 — armed-path echo suppression
	// ============================================

	describe('arm suppression (ADR-359)', () => {
		it('drops echoes that disagree with the armed value past tolerance', () => {
			replaceTree(1, [buildTree(0.1)]);
			armParam('tracks/0/devices/0/params/0', 0.7);

			// 0.4 vs 0.7 = 0.3 difference, well past the 1e-3 tolerance.
			handleV3ParamValue(['tracks/0/devices/0/params/0', 0.4]);

			// Store value must be unchanged — UI's armed value wins until
			// the round-trip closes.
			expect(v3Store.paramByPath.get('tracks/0/devices/0/params/0')?.value).toBe(0.1);
			// Arm persists so subsequent disagreeing echoes also suppress.
			expect(isArmed('tracks/0/devices/0/params/0')).toBe(true);
		});

		it('applies and clears the arm when echo matches within tolerance', () => {
			replaceTree(1, [buildTree(0.1)]);
			armParam('tracks/0/devices/0/params/0', 0.7);

			// Within 1e-3 of armed value — round-trip closed.
			handleV3ParamValue(['tracks/0/devices/0/params/0', 0.7001]);

			expect(v3Store.paramByPath.get('tracks/0/devices/0/params/0')?.value).toBeCloseTo(0.7001);
			// Arm cleared so the next echo (e.g. external automation) wins.
			expect(isArmed('tracks/0/devices/0/params/0')).toBe(false);
		});

		it('applies any echo once the arm has expired (TTL)', () => {
			vi.useFakeTimers();
			const start = Date.now();
			vi.setSystemTime(start);

			replaceTree(1, [buildTree(0.1)]);
			armParam('tracks/0/devices/0/params/0', 0.7);

			// Past ARM_TTL_MS the arm is stale — surface wins.
			vi.setSystemTime(start + 1501);
			handleV3ParamValue(['tracks/0/devices/0/params/0', 0.4]);

			expect(v3Store.paramByPath.get('tracks/0/devices/0/params/0')?.value).toBe(0.4);

			vi.useRealTimers();
		});
	});
});
