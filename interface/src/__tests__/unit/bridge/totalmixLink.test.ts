/**
 * vitest coverage for the bridge's TotalMix monitor link (ADR-423).
 *
 * The interesting cases here are all safety ones. This module decides what
 * dB reaches a mixer feeding speakers in a room with people in it, and it is
 * the only thing standing between a malformed OSC arg and a monitor level —
 * so the clamp, the read-only channel, and the "drop rather than guess"
 * behaviour are the assertions that matter.
 *
 * The address map itself is measured ground truth (see ADR-423), so it is
 * pinned literally: if someone edits `osc.totalmix.channels` in constants.json
 * without re-measuring, these fail loudly rather than silently pointing a
 * monitor fader at a different strip.
 */

import { describe, it, expect } from 'vitest';

import { createTotalMixLink, clampDb } from '../../../../bridge/handlers/totalmixLink.js';

const MIN_DB = -65;
const SILENCE_DB = -300;

describe('clampDb', () => {
	it('passes a normal level straight through', () => {
		expect(clampDb(-22.32)).toBe(-22.32);
	});

	it('maps the bottom of the fader to true silence, not merely quiet', () => {
		// -65 is inaudible but not silent; the mixer's off is -300. Pulling a
		// monitor fader all the way down has to mean off.
		expect(clampDb(MIN_DB)).toBe(SILENCE_DB);
		expect(clampDb(-70)).toBe(SILENCE_DB);
		expect(clampDb(-Infinity)).toBe(null);
	});

	it('ceilings at +6 rather than letting a bad value run away', () => {
		expect(clampDb(6)).toBe(6);
		expect(clampDb(99)).toBe(6);
		expect(clampDb(1e9)).toBe(6);
	});

	it('rejects non-numbers instead of coercing them to a level', () => {
		expect(clampDb(NaN)).toBe(null);
		// @ts-expect-error a non-number is the point of the test
		expect(clampDb(undefined)).toBe(null);
		// @ts-expect-error a non-number is the point of the test
		expect(clampDb('loud')).toBe(null);
	});
});

describe('fromMixer', () => {
	it('translates each measured mixer address to its channel', () => {
		const link = createTotalMixLink();
		const cases: [string, string][] = [
			['/mix/in/1/2/fader', 'room'],
			['/mix/pb/0/2/fader', 'playback'],
			['/mix/pb/2/2/fader', 'click'],
			['/output/2/volume', 'phones'],
			['/output/0/volume', 'main']
		];
		for (const [address, channel] of cases) {
			expect(link.fromMixer(address, [-12])).toEqual({
				channel,
				db: -12,
				address: `/looping/v3/totalmix/${channel}`
			});
		}
	});

	it('drops the rest of the mixer state dump', () => {
		// The dump is ~811 addresses; five matter. Everything else must not
		// reach WS clients at all.
		const link = createTotalMixLink();
		expect(link.fromMixer('/input/0/eq/band1freq', [80])).toBe(null);
		expect(link.fromMixer('/output/6/volume', [0])).toBe(null);
		expect(link.fromMixer('/status/connection', [0])).toBe(null);
		expect(link.fromMixer('/mix/pb/2/4/fader', [0])).toBe(null);
	});

	it('drops a non-numeric level rather than caching junk', () => {
		const link = createTotalMixLink();
		expect(link.fromMixer('/output/2/volume', [])).toBe(null);
		expect(link.fromMixer('/output/2/volume', [{}])).toBe(null);
		expect(link.get('phones')).toBeUndefined();
	});

	it('does NOT clamp inbound — the mixer reporting -300 is the truth', () => {
		const link = createTotalMixLink();
		expect(link.fromMixer('/output/0/volume', [-300])?.db).toBe(-300);
	});
});

describe('toMixer', () => {
	it('translates a channel write to the measured mixer address', () => {
		const link = createTotalMixLink();
		expect(link.toMixer('/totalmix/click', [-30])).toEqual({
			channel: 'click',
			db: -30,
			address: '/mix/pb/2/2/fader'
		});
	});

	it('clamps on the way out, so no writer can bypass the safety net', () => {
		const link = createTotalMixLink();
		expect(link.toMixer('/totalmix/room', [999])?.db).toBe(6);
		expect(link.toMixer('/totalmix/room', [-70])?.db).toBe(SILENCE_DB);
	});

	it('refuses to write main — it is the Control Room out', () => {
		const link = createTotalMixLink();
		expect(link.toMixer('/totalmix/main', [0])).toBe(null);
	});

	it('refuses an unknown channel rather than inventing an address', () => {
		const link = createTotalMixLink();
		expect(link.toMixer('/totalmix/reverb', [0])).toBe(null);
		expect(link.toMixer('/totalmix/', [0])).toBe(null);
	});

	it('ignores addresses outside its prefix', () => {
		const link = createTotalMixLink();
		expect(link.toMixer('/midi/cc', [1])).toBe(null);
	});

	it('caches the write, because the mixer never echoes one back', () => {
		// This is the whole reason writes touch the cache: with no echo, a
		// hello replay after a UI drag would otherwise hand the device a
		// level the room left behind.
		const link = createTotalMixLink();
		link.toMixer('/totalmix/click', [-18]);
		expect(link.get('click')).toBe(-18);
	});
});

describe('helloReplay', () => {
	it('is empty before anything has been heard', () => {
		// Fail-safe: a device that loads before the mixer has said anything
		// adopts nothing, so its gate stays shut and no write reaches hardware.
		expect(createTotalMixLink().helloReplay()).toEqual([]);
	});

	it('replays only channels actually heard from, never a guess', () => {
		const link = createTotalMixLink();
		link.fromMixer('/mix/pb/2/2/fader', [-22.3]);
		link.fromMixer('/output/2/volume', [-19.2]);
		expect(link.helloReplay()).toEqual([
			{ address: '/looping/v3/totalmix/click', db: -22.3 },
			{ address: '/looping/v3/totalmix/phones', db: -19.2 }
		]);
	});

	it('replays in the channel map order, not arrival order', () => {
		const link = createTotalMixLink();
		link.fromMixer('/output/0/volume', [-300]); // main, last in the map
		link.fromMixer('/mix/in/1/2/fader', [-4.1]); // room, first in the map
		expect(link.helloReplay().map((r: { address: string }) => r.address)).toEqual([
			'/looping/v3/totalmix/room',
			'/looping/v3/totalmix/main'
		]);
	});

	it('replays the newest value for a channel that moved twice', () => {
		const link = createTotalMixLink();
		link.fromMixer('/mix/pb/2/2/fader', [-22.3]);
		link.fromMixer('/mix/pb/2/2/fader', [-15]);
		expect(link.helloReplay()).toEqual([
			{ address: '/looping/v3/totalmix/click', db: -15 }
		]);
	});
});

describe('a /totalmix write from a browser (routeMessageToUDP)', () => {
	it('is dropped: the mixer is written by the Max patch, never a WS client', async () => {
		// The transport header's faders were the only WS sender, and they went
		// on 2026-09-27. Even with the mixer's port open, a stray write must
		// be counted and dropped, never guessed onto a port.
		const { __testing } = await import('../../../../bridge/transport/WebSocketServer.js');
		const sent: unknown[] = [];
		const metrics = { routingErrors: 0 };
		__testing.routeMessageToUDP(
			{ address: '/totalmix/click', args: [-18] },
			{ totalmix: { send: (m: unknown) => sent.push(m) } },
			metrics,
			undefined
		);
		expect(sent).toEqual([]);
		expect(metrics.routingErrors).toBe(1);
	});
});

describe('config', () => {
	it('uses the block it is made with, read when made rather than when required', () => {
		// The bridge requires this module whatever its switch says, and a
		// general edition's config has no osc.totalmix block — so the channel
		// map and the clamp's limits must come from the factory's argument.
		const link = createTotalMixLink({
			config: {
				channels: { _doc: 'not a channel', room: '/x/room' },
				writable: ['room'],
				minDb: -10,
				maxDb: 0,
				silenceDb: -99
			}
		});
		expect(link.channels()).toEqual(['room']);
		expect(link.toMixer('/totalmix/room', [-20])).toEqual({ channel: 'room', db: -99, address: '/x/room' });
		expect(link.toMixer('/totalmix/room', [3])?.db).toBe(0);
		expect(link.fromMixer('/x/room', [-5])).toEqual({
			channel: 'room',
			db: -5,
			address: '/looping/v3/totalmix/room'
		});
	});
});

describe('channels', () => {
	it('lists exactly the five monitor channels, no doc keys', () => {
		expect(createTotalMixLink().channels()).toEqual([
			'room',
			'playback',
			'click',
			'phones',
			'main'
		]);
	});
});
