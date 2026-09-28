/**
 * The bridge's feature switches (general-release audit §7b).
 *
 * The rule these pin is the one the audit found broken everywhere else: a
 * subsystem is on only when the config says `true`. Deleting `midiPedals` or
 * `devices.wah` brings back built-in defaults, so "remove it" meant "keep it,
 * quietly" — and a switch that read a missing entry as ON would repeat that
 * for every subsystem gated through it. A typo'd key or a string "true" must
 * also leave a trace in the log rather than silently reading as off.
 */

import { describe, it, expect, vi } from 'vitest';

import {
	createFeatureRegistry,
	readFeatureFlags,
	FEATURE_IDS,
	BUILT_IN_IDS,
	FEATURES_ADDRESS
} from '../../../../bridge/utils/features.js';

const quietLogger = () => ({ info: vi.fn(), warn: vi.fn() });

describe('readFeatureFlags', () => {
	it('knows totalmix, the Tier 1 pilot', () => {
		expect(FEATURE_IDS).toContain('totalmix');
	});

	it('knows maxUtilityPatch, the owner\'s standalone Max patch', () => {
		expect(FEATURE_IDS).toContain('maxUtilityPatch');
		expect(readFeatureFlags({ features: { maxUtilityPatch: true } })).toEqual({
			totalmix: false,
			maxUtilityPatch: true,
			expressionPedal: false,
			menubar: false,
			axHelper: false
		});
	});

	it('knows expressionPedal, the owner\'s wah pedal', () => {
		expect(FEATURE_IDS).toContain('expressionPedal');
		expect(readFeatureFlags({ features: { expressionPedal: true } })).toEqual({
			totalmix: false,
			maxUtilityPatch: false,
			expressionPedal: true,
			menubar: false,
			axHelper: false
		});
	});

	it('reads a config with no features block as every switch off', () => {
		// The general edition's base config, and every config written before
		// the switches existed that is not the rig's.
		expect(readFeatureFlags({ osc: {} })).toEqual({ totalmix: false, maxUtilityPatch: false, expressionPedal: false, menubar: false, axHelper: false });
	});

	it('reads a missing switch as off, never as a default that turns it on', () => {
		expect(readFeatureFlags({ features: {} })).toEqual({ totalmix: false, maxUtilityPatch: false, expressionPedal: false, menubar: false, axHelper: false });
	});

	it('turns a subsystem on only for an explicit true', () => {
		expect(readFeatureFlags({ features: { totalmix: true } })).toEqual({ totalmix: true, maxUtilityPatch: false, expressionPedal: false, menubar: false, axHelper: false });
		expect(readFeatureFlags({ features: { totalmix: false } })).toEqual({ totalmix: false, maxUtilityPatch: false, expressionPedal: false, menubar: false, axHelper: false });
	});

	it('ignores `_`-prefixed documentation keys without a word', () => {
		const logger = quietLogger();
		const flags = readFeatureFlags(
			{ features: { _description: 'prose', _totalmixNote: 'more prose', totalmix: true } },
			logger
		);
		expect(flags).toEqual({ totalmix: true, maxUtilityPatch: false, expressionPedal: false, menubar: false, axHelper: false });
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it('treats a non-boolean as off, and says so', () => {
		// "true" as a string is the likeliest hand-edit mistake; reading it as
		// on would make the switch's type a matter of luck.
		const logger = quietLogger();
		expect(readFeatureFlags({ features: { totalmix: 'true' } }, logger)).toEqual({ totalmix: false, maxUtilityPatch: false, expressionPedal: false, menubar: false, axHelper: false });
		expect(logger.warn).toHaveBeenCalledWith(
			'Feature switch is not true or false; treated as off',
			{ key: 'totalmix', value: 'true' }
		);
	});

	it('warns about a switch it does not know rather than dropping it silently', () => {
		const logger = quietLogger();
		expect(readFeatureFlags({ features: { totalMix: true } }, logger)).toEqual({ totalmix: false, maxUtilityPatch: false, expressionPedal: false, menubar: false, axHelper: false });
		expect(logger.warn).toHaveBeenCalledWith(
			'Unknown feature switch; ignored',
			expect.objectContaining({ key: 'totalMix' })
		);
	});

	it('reads a features block that is not an object as every switch off', () => {
		const logger = quietLogger();
		expect(readFeatureFlags({ features: true }, logger)).toEqual({ totalmix: false, maxUtilityPatch: false, expressionPedal: false, menubar: false, axHelper: false });
		expect(readFeatureFlags({ features: ['totalmix'] }, logger)).toEqual({ totalmix: false, maxUtilityPatch: false, expressionPedal: false, menubar: false, axHelper: false });
		expect(logger.warn).toHaveBeenCalledTimes(2);
	});
});

describe('createFeatureRegistry', () => {
	const on = () => createFeatureRegistry({ features: { totalmix: true } }, { logger: quietLogger() });
	const off = () => createFeatureRegistry({ features: { totalmix: false } }, { logger: quietLogger() });

	it('publishes on the /bridge/features address', () => {
		expect(FEATURES_ADDRESS).toBe('/bridge/features');
		expect(on().FEATURES_ADDRESS).toBe('/bridge/features');
	});

	it('starts an enabled feature unavailable until something reports it', () => {
		const features = on();
		expect(features.isEnabled('totalmix')).toBe(true);
		expect(features.isAvailable('totalmix')).toBe(false);
		expect(features.snapshot()).toEqual({
			totalmix: { enabled: true, available: false, reason: '' },
			maxUtilityPatch: { enabled: false, available: false, reason: '' },
			expressionPedal: { enabled: false, available: false, reason: '' },
			menubar: { enabled: false, available: false, reason: '' },
			axHelper: { enabled: false, available: false, reason: '' },
			captureRecorder: { enabled: true, available: false, reason: '' }
		});
	});

	it('records availability and its reason, and clears the reason once available', () => {
		const features = on();
		features.setAvailability('totalmix', false, 'Waiting for TotalMix');
		expect(features.snapshot().totalmix).toEqual({
			enabled: true,
			available: false,
			reason: 'Waiting for TotalMix'
		});
		features.setAvailability('totalmix', true, 'ignored once available');
		expect(features.snapshot().totalmix).toEqual({ enabled: true, available: true, reason: '' });
		expect(features.isAvailable('totalmix')).toBe(true);
	});

	it('emits a change only when something changed', () => {
		// The mixer's ~811-address dump reports availability on every packet;
		// each of those must not become a broadcast.
		const features = on();
		const changes: unknown[] = [];
		features.on('change', (snapshot: unknown) => changes.push(snapshot));
		features.setAvailability('totalmix', true);
		features.setAvailability('totalmix', true);
		features.setAvailability('totalmix', true);
		expect(changes).toEqual([
			{
				totalmix: { enabled: true, available: true, reason: '' },
				maxUtilityPatch: { enabled: false, available: false, reason: '' },
				expressionPedal: { enabled: false, available: false, reason: '' },
				menubar: { enabled: false, available: false, reason: '' },
				axHelper: { enabled: false, available: false, reason: '' },
				captureRecorder: { enabled: true, available: false, reason: '' }
			}
		]);
	});

	it('never reports a switched-off feature as available', () => {
		const features = off();
		const changes: unknown[] = [];
		features.on('change', (snapshot: unknown) => changes.push(snapshot));
		features.setAvailability('totalmix', true);
		expect(features.isEnabled('totalmix')).toBe(false);
		expect(features.isAvailable('totalmix')).toBe(false);
		expect(features.snapshot()).toEqual({
			totalmix: { enabled: false, available: false, reason: '' },
			maxUtilityPatch: { enabled: false, available: false, reason: '' },
			expressionPedal: { enabled: false, available: false, reason: '' },
			menubar: { enabled: false, available: false, reason: '' },
			axHelper: { enabled: false, available: false, reason: '' },
			captureRecorder: { enabled: true, available: false, reason: '' }
		});
		expect(changes).toEqual([]);
	});

	it('always enables the capture recorder, whatever the config says', () => {
		// Every edition has the recorder (plan.md §4): it is in the snapshot for
		// its availability alone, and no switch can turn it off.
		const logger = quietLogger();
		const features = createFeatureRegistry({ features: { captureRecorder: false } }, { logger });
		expect(BUILT_IN_IDS).toEqual(['captureRecorder']);
		expect(FEATURE_IDS).not.toContain('captureRecorder');
		expect(features.isEnabled('captureRecorder')).toBe(true);
		expect(features.isAvailable('captureRecorder')).toBe(false);
		expect(logger.warn).toHaveBeenCalledWith('Unknown feature switch; ignored', expect.objectContaining({ key: 'captureRecorder' }));
		features.setAvailability('captureRecorder', false, 'No recorder on Return A');
		expect(features.snapshot().captureRecorder).toEqual({ enabled: true, available: false, reason: 'No recorder on Return A' });
		features.setAvailability('captureRecorder', true);
		expect(features.isAvailable('captureRecorder')).toBe(true);
	});

	it('answers false, not a throw, for an id it does not know', () => {
		const features = on();
		expect(features.isEnabled('move')).toBe(false);
		expect(features.isAvailable('move')).toBe(false);
	});

	it('puts the snapshot on the wire as one JSON string argument', () => {
		const features = on();
		features.setAvailability('totalmix', false, 'TotalMix not answering');
		const args = features.wireArgs();
		expect(args).toHaveLength(1);
		expect(JSON.parse(args[0])).toEqual({
			totalmix: { enabled: true, available: false, reason: 'TotalMix not answering' },
			maxUtilityPatch: { enabled: false, available: false, reason: '' },
			expressionPedal: { enabled: false, available: false, reason: '' },
			menubar: { enabled: false, available: false, reason: '' },
			axHelper: { enabled: false, available: false, reason: '' },
			captureRecorder: { enabled: true, available: false, reason: '' }
		});
	});
});
