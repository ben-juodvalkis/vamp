/**
 * Tests for /looping/v3/param/display handler — ADR-352.
 *
 * Mirror of v3ParamValue.test.ts but for the companion display-string
 * address. Covers:
 * - Happy path: known paramPath + display string → v3Store.displayValue updated.
 * - Unknown paramPath → silent drop (race-window: state/invalidate / cold-start).
 * - Short payload / empty path → log + drop.
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

import { handleV3ParamDisplay } from '$lib/api/handlers/v3ParamDisplay';
import {
	v3Store,
	replaceTree,
	_resetForTests,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import { logger } from '$lib/utils/logger';

function buildTree(): TrackRecord {
	return {
		trackPath: 'tracks/0',
		name: 't0',
		color: 0,
		mute: false,
		solo: false,
		arm: false,
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
								value: 0.5,
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

describe('handleV3ParamDisplay', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
	});

	it('writes the display string into the store on happy path', () => {
		replaceTree(1, [buildTree()]);

		handleV3ParamDisplay(['tracks/0/devices/0/params/0', '440 Hz']);

		const record = v3Store.paramByPath.get('tracks/0/devices/0/params/0');
		expect(record?.displayValue).toBe('440 Hz');
	});

	it('preserves the numeric value when applying display', () => {
		// Display fires must not perturb the float value — the two
		// fields are independent.
		replaceTree(1, [buildTree()]);

		handleV3ParamDisplay(['tracks/0/devices/0/params/0', '0.5']);

		const record = v3Store.paramByPath.get('tracks/0/devices/0/params/0');
		expect(record?.value).toBe(0.5);
		expect(record?.displayValue).toBe('0.5');
	});

	it('silently drops when path is not in store (race window)', () => {
		replaceTree(1, [buildTree()]);

		handleV3ParamDisplay(['tracks/9/devices/9/params/9', '123 Hz']);

		// No warn — debug only; original record untouched.
		expect(logger.warn).not.toHaveBeenCalled();
		expect(
			v3Store.paramByPath.get('tracks/0/devices/0/params/0')?.displayValue
		).toBeUndefined();
	});

	it('warns and drops on short payload', () => {
		handleV3ParamDisplay(['tracks/0/devices/0/params/0']);

		expect(logger.warn).toHaveBeenCalledWith(
			'v3 param/display: short payload',
			expect.any(Object)
		);
	});

	it('warns and drops on empty path', () => {
		handleV3ParamDisplay(['', '440 Hz']);

		expect(logger.warn).toHaveBeenCalledWith(
			'v3 param/display: empty path',
			expect.any(Object)
		);
	});

	it('coerces non-string display arg via toString helper', () => {
		// The wire types display as string but the OSC layer occasionally
		// hands handlers numbers. toString() coerces; the result lands
		// in the store as a string.
		replaceTree(1, [buildTree()]);

		handleV3ParamDisplay(['tracks/0/devices/0/params/0', 123 as unknown as string]);

		const record = v3Store.paramByPath.get('tracks/0/devices/0/params/0');
		expect(typeof record?.displayValue).toBe('string');
		expect(record?.displayValue).toBe('123');
	});
});
