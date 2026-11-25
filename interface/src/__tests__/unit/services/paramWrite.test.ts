/**
 * `writeParam` is the one sender of `/looping/v3/param/set`, and
 * `sendParamsByName` shares its generation guard. Both drop a write while
 * the store's generation is UNSET_GENERATION (0): the guard used to test
 * for null/undefined, which 0 never is, so a by-name write before the
 * first state/full went to the wire with generation 0.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendSpy } = vi.hoisted(() => ({ sendSpy: vi.fn() }));
vi.mock('$lib/api/simpleClient', () => ({ send: sendSpy }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { writeParam, sendParamsByName } from '$lib/services/deviceParams';
import {
	v3Store,
	_resetForTests,
	setHandshake,
	replaceTree,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import { SvelteMap } from 'svelte/reactivity';
import { getArmedValue } from '$lib/stores/v3/paramArming.svelte';

const PATH = 'tracks/0/devices/0/params/1';

function seedTree(generation: number): void {
	setHandshake('s', generation);
	const params = new SvelteMap([
		[PATH, { paramPath: PATH, name: 'Freq', displayName: 'Freq', min: 0, max: 1, value: 0.2, unit: '' }]
	]);
	const device = {
		devicePath: 'tracks/0/devices/0',
		name: 'Auto Filter',
		className: 'AutoFilter2',
		params,
		properties: new SvelteMap()
	};
	const track = {
		trackPath: 'tracks/0',
		devices: new SvelteMap([[device.devicePath, device]]),
		slots: new SvelteMap()
	} as unknown as TrackRecord;
	replaceTree(generation, [track]);
}

describe('writeParam', () => {
	beforeEach(() => {
		_resetForTests();
		sendSpy.mockClear();
	});

	it('drops the write before a generation is accepted', () => {
		expect(v3Store.generation).toBe(0);
		expect(writeParam(PATH, 0.5)).toBe(false);
		expect(sendSpy).not.toHaveBeenCalled();
		expect(getArmedValue(PATH)).toBeUndefined();
	});

	it('applies and sends by default', () => {
		seedTree(7);
		expect(writeParam(PATH, 0.5)).toBe(true);
		expect(sendSpy).toHaveBeenCalledWith('/looping/v3/param/set', [PATH, 0.5, 7]);
		expect(v3Store.paramByPath.get(PATH)?.value).toBe(0.5);
		// The optimistic apply matches the arm and clears it (see writeParam).
		expect(getArmedValue(PATH)).toBeUndefined();
	});

	it('keeps the arm when the write is not optimistic (a device being seeded)', () => {
		seedTree(7);
		writeParam(PATH, 0.9, { optimistic: false });
		expect(sendSpy).toHaveBeenCalledWith('/looping/v3/param/set', [PATH, 0.9, 7]);
		expect(getArmedValue(PATH)).toBe(0.9);
		expect(v3Store.paramByPath.get(PATH)?.value).toBe(0.2);
	});

	it('arm: false leaves no arm', () => {
		seedTree(7);
		writeParam(PATH, 0.9, { optimistic: false, arm: false });
		expect(getArmedValue(PATH)).toBeUndefined();
	});
});

describe('sendParamsByName', () => {
	beforeEach(() => {
		_resetForTests();
		sendSpy.mockClear();
	});

	it('drops the write while the generation is UNSET (0)', () => {
		sendParamsByName('tracks/0/devices/0', { Freq: 0.5 });
		expect(sendSpy).not.toHaveBeenCalled();
	});

	it('sends with the accepted generation', () => {
		setHandshake('s', 3);
		sendParamsByName('tracks/0/devices/0', { Freq: 0.5 });
		expect(sendSpy).toHaveBeenCalledWith('/looping/v3/device/params/set', [
			'tracks/0/devices/0',
			JSON.stringify({ Freq: 0.5 }),
			3
		]);
	});
});
