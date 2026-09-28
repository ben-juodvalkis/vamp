/**
 * The UI half of the feature switches (general-release audit §7b): what the
 * bridge's `/bridge/features` snapshot turns into for the controls that read
 * it.
 *
 * Three rules. A feature the bridge has not named is OFF — nothing is drawn
 * for a subsystem until the bridge vouches for it. An enabled feature that is
 * not available always carries a reason to draw, never a blank. And the 5 s
 * beacon repeating an unchanged snapshot must not re-run every reader.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
import { handleBridgeMessage } from '$lib/api/handlers/miscHandlers';
import { logger } from '$lib/utils/logger';
import { derivedProbe } from '../../helpers/runeHarness.svelte';

const snapshot = (totalmix: { enabled: boolean; available: boolean; reason: string }) =>
	JSON.stringify({ totalmix });

beforeEach(() => {
	bridgeStatus.updateFeatures('{}');
	vi.mocked(logger.warn).mockClear();
});

describe('bridgeStatus features', () => {
	it('reads a feature the bridge has not named as off', () => {
		expect(bridgeStatus.feature('totalmix')).toEqual({ enabled: false, available: false, reason: '' });
		expect(bridgeStatus.isFeatureOn('totalmix')).toBe(false);
		// Off draws nothing at all, so there is no reason to draw either.
		expect(bridgeStatus.unavailableReason('totalmix')).toBe('');
	});

	it('takes a snapshot: on and answering', () => {
		bridgeStatus.updateFeatures(snapshot({ enabled: true, available: true, reason: '' }));
		expect(bridgeStatus.isFeatureOn('totalmix')).toBe(true);
		expect(bridgeStatus.unavailableReason('totalmix')).toBe('');
	});

	it('hands a control the reason for a feature that is on but not there', () => {
		bridgeStatus.updateFeatures(
			snapshot({ enabled: true, available: false, reason: 'TotalMix not answering' })
		);
		expect(bridgeStatus.isFeatureOn('totalmix')).toBe(true);
		expect(bridgeStatus.unavailableReason('totalmix')).toBe('TotalMix not answering');
	});

	it('never hands a control a blank reason, which would draw it live', () => {
		bridgeStatus.updateFeatures(snapshot({ enabled: true, available: false, reason: '' }));
		expect(bridgeStatus.unavailableReason('totalmix')).toBe('Unavailable');
	});

	it('gives a switched-off feature no reason: the host draws nothing', () => {
		bridgeStatus.updateFeatures(snapshot({ enabled: false, available: false, reason: 'ignored' }));
		expect(bridgeStatus.isFeatureOn('totalmix')).toBe(false);
		expect(bridgeStatus.unavailableReason('totalmix')).toBe('');
	});

	it('keeps the last good snapshot when a frame does not parse', () => {
		bridgeStatus.updateFeatures(snapshot({ enabled: true, available: true, reason: '' }));
		bridgeStatus.updateFeatures('{not json');
		bridgeStatus.updateFeatures('[1, 2]');
		expect(bridgeStatus.isFeatureOn('totalmix')).toBe(true);
		expect(logger.warn).toHaveBeenCalledTimes(2);
	});

	it('coerces field types rather than trusting the wire', () => {
		bridgeStatus.updateFeatures(JSON.stringify({ totalmix: { enabled: 'yes', available: 1, reason: 7 } }));
		expect(bridgeStatus.feature('totalmix')).toEqual({ enabled: false, available: false, reason: '' });
	});

	it('does not replace an identical snapshot (the 5 s beacon)', () => {
		bridgeStatus.updateFeatures(snapshot({ enabled: true, available: true, reason: '' }));
		const held = bridgeStatus.features;
		bridgeStatus.updateFeatures(snapshot({ enabled: true, available: true, reason: '' }));
		expect(bridgeStatus.features).toBe(held);
	});

	it('signals a change to a reader through a real $derived', () => {
		const probe = derivedProbe(() => bridgeStatus.unavailableReason('totalmix'));
		try {
			bridgeStatus.updateFeatures(snapshot({ enabled: true, available: false, reason: 'Waiting for TotalMix' }));
			expect(probe.value).toBe('Waiting for TotalMix');
			bridgeStatus.updateFeatures(snapshot({ enabled: true, available: true, reason: '' }));
			expect(probe.value).toBe('');
		} finally {
			probe.stop();
		}
	});
});

describe('/bridge/features on the wire', () => {
	it('reaches the store through the bridge-message handler', async () => {
		handleBridgeMessage('/bridge/features', [
			snapshot({ enabled: true, available: false, reason: 'TotalMix not answering' })
		]);
		await vi.waitFor(() =>
			expect(bridgeStatus.unavailableReason('totalmix')).toBe('TotalMix not answering')
		);
	});
});
