/**
 * The client side of `/bridge/machine` (onboarding.plan.md §6.5): the machine
 * store, the FX preset paths resolved from it, and the TotalMix range it sets.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { machineStore } from '$lib/stores/machineStore.svelte';
import { DEVICE_PRESETS, deviceLoadArgs, loadKey, resolvePresetPath } from '$lib/config/devicePresets';
import { MIN_DB, MAX_DB, setTotalMixRange } from '$lib/utils/totalmixScale';
import * as scale from '$lib/utils/totalmixScale';
import { handleBridgeMessage } from '$lib/api/handlers/miscHandlers';

afterEach(() => {
	machineStore.reset();
	setTotalMixRange({ minDb: -65, maxDb: 6, silenceDb: -300 });
});

describe('machineStore', () => {
	it('starts empty, takes a snapshot, and ignores an unreadable frame', () => {
		expect(machineStore.known).toBe(false);
		expect(machineStore.paths.effectPresetsBase).toBe('');
		machineStore.update('{not json');
		expect(machineStore.known).toBe(false);
		machineStore.update(JSON.stringify({ paths: { instrumentsBase: '/Lib/Instruments', effectPresetsBase: '/Lib/Effects', m4lDevicesRoot: '/repo/Vamp Devices' }, totalmix: null }));
		expect(machineStore.known).toBe(true);
		expect(machineStore.paths).toEqual({ instrumentsBase: '/Lib/Instruments', effectPresetsBase: '/Lib/Effects', m4lDevicesRoot: '/repo/Vamp Devices' });
	});

	it('resolves a file tile’s preset path from the snapshot, and sends it on device/load', () => {
		expect(DEVICE_PRESETS.digital.presetPath).toBe('{effectPresetsBase}/Digital.adg');
		expect(resolvePresetPath(DEVICE_PRESETS.digital.presetPath!)).toBe('{effectPresetsBase}/Digital.adg');
		machineStore.update(JSON.stringify({ paths: { instrumentsBase: '', effectPresetsBase: '/Lib/Effects', m4lDevicesRoot: '' }, totalmix: null }));
		expect(resolvePresetPath(DEVICE_PRESETS.digital.presetPath!)).toBe('/Lib/Effects/Digital.adg');
		expect(deviceLoadArgs('tracks/1', '', DEVICE_PRESETS.digital)).toEqual(['tracks/1', '', '/Lib/Effects/Digital.adg']);
		// A native tile names its device, not a file, whatever the snapshot says (3.12.0).
		expect(deviceLoadArgs('tracks/1', '', DEVICE_PRESETS.reverb)).toEqual(['tracks/1', '', '', 'native:Hybrid', 'Reverb']);
		expect(loadKey(DEVICE_PRESETS.reverb)).toBe('native:Hybrid');
		expect(deviceLoadArgs('tracks/1', '', DEVICE_PRESETS.sequencer)).toEqual(['tracks/1', '', '', 'place:Vamp Devices', 'Permute/Permute.amxd']);
	});

	it('sets the TotalMix range, which the scale reads live', async () => {
		expect([MIN_DB, MAX_DB]).toEqual([-65, 6]);
		handleBridgeMessage('/bridge/machine', [JSON.stringify({ paths: {}, totalmix: { minDb: -40, maxDb: 12, silenceDb: -300 } })]);
		// The handler imports the store lazily; the same import settles after it, then its `then` runs.
		await import('$lib/stores/machineStore.svelte');
		await Promise.resolve();
		await Promise.resolve();
		expect([scale.MIN_DB, scale.MAX_DB]).toEqual([-40, 12]);
		expect(scale.dbToFraction(-40)).toBe(0);
		expect(scale.dbToFraction(12)).toBe(1);
	});
});
