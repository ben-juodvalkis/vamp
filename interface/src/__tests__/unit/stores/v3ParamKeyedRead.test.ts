/**
 * `v3Store.param(path)` is a keyed read through the owning device, so a
 * reader of one parameter is not invalidated by an echo for another.
 * `paramByPath` rebuilds its whole-set map on every echo and invalidates
 * every reader; this pins the difference by counting how often a
 * `$derived` over each recomputes while another parameter is echoed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SvelteMap } from 'svelte/reactivity';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
	v3Store,
	_resetForTests,
	replaceTree,
	applyParamValue,
	type TrackRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import { derivedProbe } from '../../helpers/runeHarness.svelte';

const DEVICES = 4;
const PARAMS = 16;
const pathOf = (d: number, p: number) => `tracks/0/devices/${d}/params/${p}`;

function seed(): void {
	const devices = new SvelteMap();
	for (let d = 0; d < DEVICES; d++) {
		const params = new SvelteMap<string, ParamRecord>();
		for (let p = 0; p < PARAMS; p++) {
			const paramPath = pathOf(d, p);
			params.set(paramPath, { paramPath, name: `P${p}`, displayName: `P${p}`, min: 0, max: 1, value: 0, unit: '' });
		}
		const devicePath = `tracks/0/devices/${d}`;
		devices.set(devicePath, { devicePath, name: `D${d}`, className: 'X', params, properties: new SvelteMap() });
	}
	replaceTree(1, [{ trackPath: 'tracks/0', devices, slots: new SvelteMap() } as unknown as TrackRecord]);
}

/** Echo `n` values onto params other than the one being read. */
function echoOthers(n: number): void {
	for (let i = 1; i <= n; i++) {
		applyParamValue(pathOf(i % DEVICES, (i % (PARAMS - 1)) + 1), i / (n + 1));
	}
}

describe('v3Store.param — keyed reads', () => {
	beforeEach(() => {
		_resetForTests();
		seed();
	});

	it('returns the same record paramByPath does', () => {
		applyParamValue(pathOf(2, 3), 0.4);
		expect(v3Store.param(pathOf(2, 3))).toBe(v3Store.paramByPath.get(pathOf(2, 3)));
		expect(v3Store.param(pathOf(2, 3))?.value).toBe(0.4);
		expect(v3Store.param('tracks/0/devices/9/params/0')).toBeUndefined();
		expect(v3Store.param('junk')).toBeUndefined();
	});

	it('is not invalidated by echoes for other params (paramByPath is, every time)', () => {
		const target = pathOf(0, 0);
		let keyedRuns = 0;
		let wholeSetRuns = 0;
		const keyed = derivedProbe(() => {
			keyedRuns++;
			return v3Store.param(target)?.value;
		});
		const wholeSet = derivedProbe(() => {
			wholeSetRuns++;
			return v3Store.paramByPath.get(target)?.value;
		});
		void keyed.value;
		void wholeSet.value;
		keyedRuns = 0;
		wholeSetRuns = 0;

		const ECHOES = 50;
		for (let i = 1; i <= ECHOES; i++) {
			echoOthers(1);
			void keyed.value;
			void wholeSet.value;
		}

		// Before: a reader on paramByPath re-ran once per echo.
		expect(wholeSetRuns).toBe(ECHOES);
		// After: the keyed reader never re-ran.
		expect(keyedRuns).toBe(0);

		// And it still follows its own param.
		applyParamValue(target, 0.75);
		expect(keyed.value).toBe(0.75);
		expect(keyedRuns).toBe(1);

		keyed.stop();
		wholeSet.stop();
	});
});
