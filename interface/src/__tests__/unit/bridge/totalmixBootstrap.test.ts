// @vitest-environment node
// (Real sockets in the last block: under jsdom a Node `Buffer` is not the
// realm's `Uint8Array`, so osc.js cannot decode what arrives and throws.)
/**
 * vitest coverage for the TotalMix startup bootstrap (ADR-423).
 *
 * Most of what is pinned here is the part that decides *whether a reading is
 * trustworthy*: parsing the mixer's own dB strings, and the seed rule that a
 * bootstrap value must never overwrite a fresher one. Both are the difference
 * between seeding a correct monitor level and seeding a wrong one.
 *
 * The last block walks the network against a fake mixer on loopback, for the
 * two things the feature switch (general-release audit §7b) reads off it:
 * whether TotalMix answered at all — which is what makes the feature
 * available — and, when nothing answers, one warning rather than a
 * "strip name mismatch" per channel on every start.
 */

import { describe, it, expect, vi } from 'vitest';
import dgram from 'node:dgram';
import { createRequire } from 'node:module';

import constants from '$config/constants.json';
import {
	bootstrapFromLegacy,
	parseDbString,
	legacyReads
} from '../../../../bridge/handlers/totalmixBootstrap.js';
import { createTotalMixLink } from '../../../../bridge/handlers/totalmixLink.js';

// The bridge's own OSC codec, required as the bridge requires it: `osc` ships
// no type declarations, and the fake mixer below only needs its two calls.
const osc = createRequire(import.meta.url)('osc') as {
	readPacket: (buf: Buffer, options: { metadata: boolean }) => unknown;
	writePacket: (packet: unknown, options: { metadata: boolean }) => Uint8Array;
};

// constants.json's own reads. The module no longer computes these when it is
// required (a bridge with TotalMix switched off carries no such block).
const READS = legacyReads();

const SILENCE_DB = -300;

describe('parseDbString', () => {
	it('reads the mixer’s dB strings', () => {
		expect(parseDbString('-19.2 dB')).toBe(-19.2);
		expect(parseDbString('0.0 dB')).toBe(0);
		expect(parseDbString('6.0 dB')).toBe(6);
		expect(parseDbString('-4.1 dB')).toBe(-4.1);
	});

	it('maps the mixer’s -oo to the protocol’s -300', () => {
		// The two halves of this system spell silence differently; the seed
		// has to land in the same units as everything downstream.
		expect(parseDbString('-oo')).toBe(SILENCE_DB);
		expect(parseDbString('-∞')).toBe(SILENCE_DB);
	});

	it('tolerates surrounding whitespace', () => {
		expect(parseDbString('  -12.5 dB  ')).toBe(-12.5);
	});

	it('rejects anything it cannot read rather than guessing a level', () => {
		expect(parseDbString('')).toBe(null);
		expect(parseDbString('quiet')).toBe(null);
		expect(parseDbString('-19.2')).toBe(null); // no unit — not the mixer's format
		// @ts-expect-error a non-string is the point of the test
		expect(parseDbString(undefined)).toBe(null);
		// @ts-expect-error a non-string is the point of the test
		expect(parseDbString(-19.2)).toBe(null);
	});
});

describe('READS map', () => {
	it('covers all five channels', () => {
		expect(Object.keys(READS).sort()).toEqual(
			['click', 'main', 'phones', 'playback', 'room'].sort()
		);
	});

	it('carries an expected strip name for every channel', () => {
		// The legacy bank window is never pinned, so the name check is the
		// only thing standing between a moved bank and a monitor fader
		// pointed at the wrong strip. A read without one is not safe.
		for (const [channel, spec] of Object.entries(READS) as [string, any][]) {
			expect(spec.expectName, `${channel} has no expectName`).toBeTruthy();
			expect(spec.bus, `${channel} has no bus`).toMatch(/^\/1\/bus/);
			expect(spec.slot, `${channel} has no slot`).toBeGreaterThan(0);
		}
	});
});

describe('totalmixLink.seed', () => {
	it('fills channels that are still unknown', () => {
		const link = createTotalMixLink();
		expect(link.seed({ room: -4.1, click: -22.3 }).sort()).toEqual(['click', 'room']);
		expect(link.get('room')).toBe(-4.1);
	});

	it('never overwrites a level already heard from the mixer', () => {
		// A change event that landed while the bootstrap was in flight is
		// both fresher and exact; the bootstrap's 0.1 dB reading must lose.
		const link = createTotalMixLink();
		link.fromMixer('/mix/in/1/2/fader', [-4.11]);
		expect(link.seed({ room: -4.1 })).toEqual([]);
		expect(link.get('room')).toBe(-4.11);
	});

	it('ignores channels it does not know', () => {
		const link = createTotalMixLink();
		expect(link.seed({ reverb: -10, _description: 0 })).toEqual([]);
	});

	it('ignores non-numeric values', () => {
		const link = createTotalMixLink();
		// @ts-expect-error non-numeric levels are the point of the test
		expect(link.seed({ room: NaN, click: 'loud', phones: null })).toEqual([]);
		expect(link.get('room')).toBeUndefined();
	});

	it('survives an empty or missing seed', () => {
		// The safe failure: nothing seeded, gates stay shut, no write reaches
		// hardware.
		const link = createTotalMixLink();
		expect(link.seed({})).toEqual([]);
		// @ts-expect-error a missing seed is the point of the test
		expect(link.seed(undefined)).toEqual([]);
		expect(link.helloReplay()).toEqual([]);
	});
});

describe('bootstrapFromLegacy on the wire', () => {
	type Spec = { bus: string; slot: number; expectName: string };
	const READS_BY_CHANNEL = READS as Record<string, Spec>;

	/** A UDP port nothing holds right now, for the bootstrap to bind. */
	async function freePort(): Promise<number> {
		const sock = dgram.createSocket('udp4');
		await new Promise<void>((resolve) => sock.bind(0, '127.0.0.1', () => resolve()));
		const { port } = sock.address();
		await new Promise<void>((resolve) => sock.close(() => resolve()));
		return port;
	}

	/** constants.json's legacy block, on test ports and with short waits. */
	function legacyOn(localPort: number, remotePort: number) {
		return {
			...constants.osc.totalmixLegacy,
			localPort,
			remotePort,
			host: '127.0.0.1',
			settleMs: 5,
			dumpWaitMs: 80
		};
	}

	const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

	it('with no mixer: nothing seeded, no reply reported, ONE warning', async () => {
		// Five "strip name mismatch" lines on every start was how a Mac with
		// no RME read, blaming the bank window for a mixer that is not there.
		const logger = makeLogger();
		const onReply = vi.fn();
		const found = await bootstrapFromLegacy({
			logger,
			legacy: legacyOn(await freePort(), await freePort()),
			silenceDb: -300,
			onReply
		});
		expect(found).toEqual({});
		expect(onReply).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(logger.warn.mock.calls[0][0]).toMatch(/no answer on controller 1/);
	});

	it('with a mixer: seeds every channel and reports the reply exactly once', async () => {
		const localPort = await freePort();
		const mixer = dgram.createSocket('udp4');
		await new Promise<void>((resolve) => mixer.bind(0, '127.0.0.1', () => resolve()));
		// Answer each bus-row assertion the way the legacy protocol does: the
		// row's strip names and their dB strings.
		mixer.on('message', (buf: Buffer) => {
			const packet = osc.readPacket(buf, { metadata: true }) as { address?: string };
			if (!packet.address?.startsWith('/1/bus')) return;
			for (const { bus, slot, expectName } of Object.values(READS_BY_CHANNEL)) {
				if (bus !== packet.address) continue;
				for (const [address, value] of [
					[`/1/trackname${slot}`, expectName],
					[`/1/volume${slot}Val`, '-12.5 dB']
				]) {
					const out = osc.writePacket({ address, args: [{ type: 's', value }] }, { metadata: true });
					mixer.send(Buffer.from(out), localPort, '127.0.0.1');
				}
			}
		});
		const logger = makeLogger();
		const onReply = vi.fn();
		try {
			const found = await bootstrapFromLegacy({
				logger,
				legacy: legacyOn(localPort, mixer.address().port),
				silenceDb: -300,
				onReply
			});
			expect(found).toEqual(
				Object.fromEntries(Object.keys(READS_BY_CHANNEL).map((channel) => [channel, -12.5]))
			);
			expect(onReply).toHaveBeenCalledTimes(1);
			expect(logger.warn).not.toHaveBeenCalled();
		} finally {
			mixer.close();
		}
	});

	it('counts a reply with the wrong strip names as TotalMix being there', async () => {
		// A moved bank window seeds nothing, but the mixer DID answer — the
		// feature is available, and the per-channel mismatch warnings stand.
		const localPort = await freePort();
		const mixer = dgram.createSocket('udp4');
		await new Promise<void>((resolve) => mixer.bind(0, '127.0.0.1', () => resolve()));
		mixer.on('message', (buf: Buffer) => {
			const packet = osc.readPacket(buf, { metadata: true }) as { address?: string };
			if (!packet.address?.startsWith('/1/bus')) return;
			const out = osc.writePacket(
				{ address: '/1/trackname1', args: [{ type: 's', value: 'Someone Else' }] },
				{ metadata: true }
			);
			mixer.send(Buffer.from(out), localPort, '127.0.0.1');
		});
		const logger = makeLogger();
		const onReply = vi.fn();
		try {
			const found = await bootstrapFromLegacy({
				logger,
				legacy: legacyOn(localPort, mixer.address().port),
				silenceDb: -300,
				onReply
			});
			expect(found).toEqual({});
			expect(onReply).toHaveBeenCalledTimes(1);
			const messages = logger.warn.mock.calls.map((call) => call[0]);
			expect(messages.every((m) => /strip name mismatch/.test(m))).toBe(true);
			expect(messages).toHaveLength(Object.keys(READS_BY_CHANNEL).length);
		} finally {
			mixer.close();
		}
	});
});
