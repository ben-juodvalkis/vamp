/**
 * The live meters relay (handlers/liveMeters.js, ADR-541): the page's ask
 * goes to Vamp for Mac alone, its readings (a needle's dB, a spectrum's
 * bands) to every client, and nothing moves while the `liveMeters` switch
 * is off.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const nodeRequire = createRequire(import.meta.url);
const { createLiveMeters, WATCH_ADDRESS, REDUCTION_ADDRESS, SPECTRUM_ADDRESS, ACTIVITY_ADDRESS } = nodeRequire('../../../../bridge/handlers/liveMeters.js');
const { createFeatureRegistry } = nodeRequire('../../../../bridge/utils/features.js');

const quiet = { warn() {}, info() {} };
const STOP = ['', '', '[]'];

function setup(on: boolean, appConnected = true) {
	const features = createFeatureRegistry({ features: { liveMeters: on } }, { logger: quiet });
	const toApp: Array<[string, unknown[]]> = [];
	const toClients: Array<[string, unknown[]]> = [];
	const meters = createLiveMeters({
		features,
		appSend: () => (appConnected ? (address: string, args: unknown[]) => toApp.push([address, args]) : null),
		broadcast: (address: string, args: unknown[]) => toClients.push([address, args])
	});
	return { features, meters, toApp, toClients };
}

const msg = (address: string, ...args: unknown[]) => ({ address, args });
const bands = Array.from({ length: 64 }, (_, i) => -60 + i / 4);

describe('createLiveMeters', () => {
	it("passes the page's ask to the app alone, with its OSC wrappers unwrapped", () => {
		const { meters, toApp, toClients } = setup(true);
		const levels = JSON.stringify([[0, ['Auto Filter']]]);
		expect(meters.onClientMessage(msg(WATCH_ADDRESS, { type: 's', value: 'tracks/2/devices/0' }, 'AutoFilter2', { type: 's', value: levels }))).toBe(true);
		expect(toApp).toEqual([[WATCH_ADDRESS, ['tracks/2/devices/0', 'AutoFilter2', levels]]]);
		expect(toClients).toEqual([]);
	});

	it('an empty or malformed ask is a stop', () => {
		const { meters, toApp } = setup(true);
		meters.onClientMessage(msg(WATCH_ADDRESS, ''));
		meters.onClientMessage(msg(WATCH_ADDRESS, 'tracks/1/devices/0', 'GlueCompressor', 7));
		expect(toApp).toEqual([[WATCH_ADDRESS, STOP], [WATCH_ADDRESS, STOP]]);
	});

	it("sends a needle's reading to every client and marks the feature available", () => {
		const { meters, features, toClients } = setup(true);
		expect(features.isAvailable('liveMeters')).toBe(false);
		meters.onClientMessage(msg(REDUCTION_ADDRESS, 'tracks/2/devices/0', 12.79, 'ok'));
		expect(toClients).toEqual([[REDUCTION_ADDRESS, ['tracks/2/devices/0', 12.79, 'ok']]]);
		expect(features.isAvailable('liveMeters')).toBe(true);
	});

	it("sends a spectrum's bands to every client, and a status with none", () => {
		const { meters, toClients } = setup(true);
		meters.onClientMessage(msg(SPECTRUM_ADDRESS, 'tracks/2/devices/0', 'ok', ...bands));
		meters.onClientMessage(msg(SPECTRUM_ADDRESS, 'tracks/2/devices/0', 'not-shown'));
		expect(toClients).toEqual([
			[SPECTRUM_ADDRESS, ['tracks/2/devices/0', 'ok', ...bands]],
			[SPECTRUM_ADDRESS, ['tracks/2/devices/0', 'not-shown']]
		]);
	});

	it("sends an activity view's heights to every client", () => {
		const { meters, toClients } = setup(true);
		meters.onClientMessage(msg(ACTIVITY_ADDRESS, 'tracks/1/devices/1', 'ok', 0.297, 0.47, 0.85));
		expect(toClients).toEqual([[ACTIVITY_ADDRESS, ['tracks/1/devices/1', 'ok', 0.297, 0.47, 0.85]]]);
	});

	it('drops a reading with the wrong types', () => {
		const { meters, toClients } = setup(true);
		expect(meters.onClientMessage(msg(REDUCTION_ADDRESS, 'tracks/2/devices/0', '12', 'ok'))).toBe(true);
		expect(meters.onClientMessage(msg(SPECTRUM_ADDRESS, 'tracks/2/devices/0', 'ok', -3, 'x'))).toBe(true);
		expect(toClients).toEqual([]);
	});

	it('switched off, takes every address and moves nothing', () => {
		const { meters, toApp, toClients } = setup(false);
		expect(meters.onClientMessage(msg(WATCH_ADDRESS, 'tracks/2/devices/0', 'GlueCompressor', '[[0, []]]'))).toBe(true);
		expect(meters.onClientMessage(msg(REDUCTION_ADDRESS, 'tracks/2/devices/0', 3, 'ok'))).toBe(true);
		expect(meters.onClientMessage(msg(SPECTRUM_ADDRESS, 'tracks/2/devices/0', 'ok', ...bands))).toBe(true);
		expect(toApp).toEqual([]);
		expect(toClients).toEqual([]);
	});

	it('with no app connected, the ask goes nowhere', () => {
		const { meters, toApp } = setup(true, false);
		expect(meters.onClientMessage(msg(WATCH_ADDRESS, 'tracks/2/devices/0', 'GlueCompressor', '[[0, []]]'))).toBe(true);
		expect(toApp).toEqual([]);
	});

	it('leaves every other address alone', () => {
		const { meters } = setup(true);
		expect(meters.onClientMessage({ address: '/capture/input/monitor', args: [] })).toBe(false);
	});
});
