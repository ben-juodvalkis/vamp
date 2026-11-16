/**
 * The gain reduction relay (handlers/reductionMeter.js, ADR-541): the page's
 * ask goes to Vamp for Mac alone, its readings to every client, and nothing
 * moves while the `reductionMeter` switch is off.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const nodeRequire = createRequire(import.meta.url);
const { createReductionMeter, WATCH_ADDRESS, READING_ADDRESS } = nodeRequire('../../../../bridge/handlers/reductionMeter.js');
const { createFeatureRegistry } = nodeRequire('../../../../bridge/utils/features.js');

const quiet = { warn() {}, info() {} };

function setup(on: boolean, appConnected = true) {
	const features = createFeatureRegistry({ features: { reductionMeter: on } }, { logger: quiet });
	const toApp: Array<[string, unknown[]]> = [];
	const toClients: Array<[string, unknown[]]> = [];
	const meter = createReductionMeter({
		features,
		appSend: () => (appConnected ? (address: string, args: unknown[]) => toApp.push([address, args]) : null),
		broadcast: (address: string, args: unknown[]) => toClients.push([address, args])
	});
	return { features, meter, toApp, toClients };
}

const watch = (...args: unknown[]) => ({ address: WATCH_ADDRESS, args });
const reading = (...args: unknown[]) => ({ address: READING_ADDRESS, args });

describe('createReductionMeter', () => {
	it("passes the page's ask to the app alone, with its OSC wrappers unwrapped", () => {
		const { meter, toApp, toClients } = setup(true);
		const levels = JSON.stringify([[0, ['Glue Compressor', 'Permute']]]);
		expect(meter.onClientMessage(watch({ type: 's', value: 'tracks/2/devices/0' }, 'GlueCompressor', { type: 's', value: levels }))).toBe(true);
		expect(toApp).toEqual([[WATCH_ADDRESS, ['tracks/2/devices/0', 'GlueCompressor', levels]]]);
		expect(toClients).toEqual([]);
	});

	it('an empty or malformed ask is a stop', () => {
		const { meter, toApp } = setup(true);
		meter.onClientMessage(watch(''));
		meter.onClientMessage(watch('tracks/1/devices/0', 'GlueCompressor', 7));
		expect(toApp).toEqual([
			[WATCH_ADDRESS, ['', '', '[]']],
			[WATCH_ADDRESS, ['', '', '[]']]
		]);
	});

	it("sends the app's readings to every client and marks the feature available", () => {
		const { meter, features, toClients } = setup(true);
		expect(features.isAvailable('reductionMeter')).toBe(false);
		meter.onClientMessage(reading('tracks/2/devices/0', 12.79, 'ok'));
		expect(toClients).toEqual([[READING_ADDRESS, ['tracks/2/devices/0', 12.79, 'ok']]]);
		expect(features.isAvailable('reductionMeter')).toBe(true);
	});

	it('drops a reading with the wrong types', () => {
		const { meter, toClients } = setup(true);
		expect(meter.onClientMessage(reading('tracks/2/devices/0', '12', 'ok'))).toBe(true);
		expect(toClients).toEqual([]);
	});

	it('switched off, takes both addresses and moves nothing', () => {
		const { meter, toApp, toClients } = setup(false);
		expect(meter.onClientMessage(watch('tracks/2/devices/0', 'GlueCompressor', '[[0, []]]'))).toBe(true);
		expect(meter.onClientMessage(reading('tracks/2/devices/0', 3, 'ok'))).toBe(true);
		expect(toApp).toEqual([]);
		expect(toClients).toEqual([]);
	});

	it('with no app connected, the ask goes nowhere', () => {
		const { meter, toApp } = setup(true, false);
		expect(meter.onClientMessage(watch('tracks/2/devices/0', 'GlueCompressor', '[[0, []]]'))).toBe(true);
		expect(toApp).toEqual([]);
	});

	it('leaves every other address alone', () => {
		const { meter } = setup(true);
		expect(meter.onClientMessage({ address: '/capture/input/monitor', args: [] })).toBe(false);
	});
});
