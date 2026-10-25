/**
 * v3DeviceAppointed — the surface's report of Live's blue hand lands on
 * `fxChainStore` without being sent back, and a tile gesture then
 * re-appoints only a device the hand is not already on.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('$lib/services/deviceMoveService', () => ({ selectDevice: vi.fn(async () => {}) }));

import {
	V3_DEVICE_APPOINTED_ADDRESS,
	handleV3DeviceAppointed,
	isV3DeviceAppointedAddress
} from '$lib/api/handlers/v3DeviceAppointed';
import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';
import { selectDevice } from '$lib/services/deviceMoveService';

describe('v3DeviceAppointed', () => {
	beforeEach(() => {
		fxChainStore.reset();
		vi.mocked(selectDevice).mockClear();
	});

	it('answers to its address only', () => {
		expect(isV3DeviceAppointedAddress(V3_DEVICE_APPOINTED_ADDRESS)).toBe(true);
		expect(isV3DeviceAppointedAddress('/looping/v3/device/select')).toBe(false);
	});

	it('records where the hand is, and "" as nowhere, sending nothing', () => {
		handleV3DeviceAppointed(V3_DEVICE_APPOINTED_ADDRESS, ['tracks/6/devices/3']);
		expect(fxChainStore.appointed).toBe('tracks/6/devices/3');
		handleV3DeviceAppointed(V3_DEVICE_APPOINTED_ADDRESS, ['']);
		expect(fxChainStore.appointed).toBeNull();
		expect(selectDevice).not.toHaveBeenCalled();
	});

	it('a gesture appoints only a device the hand is not on', () => {
		handleV3DeviceAppointed(V3_DEVICE_APPOINTED_ADDRESS, ['tracks/6/devices/3']);
		fxChainStore.appoint('tracks/6/devices/3');
		expect(selectDevice).not.toHaveBeenCalled();
		// The hand moved in Live: the next gesture on the tile sends again.
		handleV3DeviceAppointed(V3_DEVICE_APPOINTED_ADDRESS, ['tracks/6/devices/5']);
		fxChainStore.appoint('tracks/6/devices/3');
		expect(selectDevice).toHaveBeenCalledWith('tracks/6/devices/3');
	});

	it('a deliberate tap re-sends even when the hand is already there', () => {
		handleV3DeviceAppointed(V3_DEVICE_APPOINTED_ADDRESS, ['tracks/6/devices/3']);
		fxChainStore.appoint('tracks/6/devices/3', { force: true });
		expect(selectDevice).toHaveBeenCalledTimes(1);
	});

	it('ignores an empty payload', () => {
		handleV3DeviceAppointed(V3_DEVICE_APPOINTED_ADDRESS, []);
		expect(fxChainStore.appointed).toBeNull();
	});
});
