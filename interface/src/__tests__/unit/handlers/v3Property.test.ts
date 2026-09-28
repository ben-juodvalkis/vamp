/**
 * Tests for /looping/v3/property/value handler — PR-3.5.7-impl.
 *
 * Covers:
 * - Happy path: known (devicePath, propertyName) → store updated.
 * - Drop-on-missing: unknown devicePath → no-op (race window).
 * - Short payload / empty path / empty propertyName → log + drop.
 * - Value type-passthrough: int / float / string / int-coerced bool.
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

import { handleV3PropertyValue, V3_PROPERTY_VALUE_ADDRESS } from '$lib/api/handlers/v3Property';
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
					name: 'Simpler',
					className: 'Simpler',
					params: new Map(),
					properties: new Map()
				}
			]
		]),
		slots: new Map()
	};
}

describe('handleV3PropertyValue', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
	});

	it('exposes the canonical OSC address', () => {
		expect(V3_PROPERTY_VALUE_ADDRESS).toBe('/looping/v3/property/value');
	});

	it('writes a known (devicePath, propertyName) into the store', () => {
		replaceTree(1, [buildTree()]);

		handleV3PropertyValue(['tracks/0/devices/0', 'playback_mode', 2]);

		const device = v3Store.deviceByPath.get('tracks/0/devices/0');
		expect(device?.properties.get('playback_mode')).toBe(2);
	});

	it('passes value through unchanged for int / float / string / bool-as-int', () => {
		replaceTree(1, [buildTree()]);

		handleV3PropertyValue(['tracks/0/devices/0', 'playback_mode', 1]);
		handleV3PropertyValue(['tracks/0/devices/0', 'sample.gain', 0.42]);
		handleV3PropertyValue(['tracks/0/devices/0', 'sample.warp_mode', 'beats']);
		handleV3PropertyValue(['tracks/0/devices/0', 'sample.warping', 1]);

		const props = v3Store.deviceByPath.get('tracks/0/devices/0')?.properties;
		expect(props?.get('playback_mode')).toBe(1);
		expect(props?.get('sample.gain')).toBe(0.42);
		expect(props?.get('sample.warp_mode')).toBe('beats');
		expect(props?.get('sample.warping')).toBe(1);
	});

	it('drops silently when devicePath is not in the store (race window)', () => {
		replaceTree(1, [buildTree()]);

		handleV3PropertyValue(['tracks/9/devices/9', 'playback_mode', 2]);

		expect(logger.warn).not.toHaveBeenCalled();
		expect(logger.debug).toHaveBeenCalledWith(
			'v3 property/value: device not in store, dropped',
			expect.objectContaining({ devicePath: 'tracks/9/devices/9' })
		);
	});

	it('warns and drops on short payload', () => {
		handleV3PropertyValue(['tracks/0/devices/0', 'playback_mode']);

		expect(logger.warn).toHaveBeenCalledWith(
			'v3 property/value: short payload',
			expect.objectContaining({ length: 2 })
		);
	});

	it('warns and drops when devicePath is empty', () => {
		handleV3PropertyValue(['', 'playback_mode', 2]);

		expect(logger.warn).toHaveBeenCalledWith(
			'v3 property/value: empty devicePath',
			expect.any(Object)
		);
	});

	it('warns and drops when propertyName is empty', () => {
		handleV3PropertyValue(['tracks/0/devices/0', '', 2]);

		expect(logger.warn).toHaveBeenCalledWith(
			'v3 property/value: empty propertyName',
			expect.any(Object)
		);
	});

	it('stores dict-shaped properties as JSON strings (ADR-002 amendment)', () => {
		// PR-3.5.7-impl-followup-b: Compressor's input_routing_type and
		// available_input_routing_types arrive as JSON strings per the
		// ADR-002 amendment. The handler is a pass-through — view code
		// parses via parsePropertyValue() on read. Here we only assert
		// the string round-trips into the store without being decoded
		// prematurely (any decode-here would break the symmetry with the
		// wire).
		replaceTree(1, [buildTree()]);
		const jsonStr = '{"identifier":1,"display_name":"1-MIDI"}';
		handleV3PropertyValue(['tracks/0/devices/0', 'input_routing_type', jsonStr]);

		const stored = v3Store.deviceByPath
			.get('tracks/0/devices/0')
			?.properties.get('input_routing_type');
		expect(stored).toBe(jsonStr);
		// And the string is parseable by the view's helper (sanity).
		expect(JSON.parse(stored as string)).toEqual({
			identifier: 1,
			display_name: '1-MIDI'
		});
	});
});
