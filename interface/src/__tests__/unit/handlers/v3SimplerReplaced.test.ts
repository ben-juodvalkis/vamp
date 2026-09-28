/**
 * `/looping/v3/simpler/replaced` — the surface's success ack for both
 * Simpler load flows. A pure side channel: it carries the Simpler's
 * devicePath and the sample's absolute path to whoever started the
 * gesture, and touches no store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { logger } from '$lib/utils/logger';
import {
	handleV3SimplerReplaced,
	addSimplerReplacedWatcher,
	V3_SIMPLER_REPLACED_ADDRESS,
	type SimplerReplacedAck
} from '$lib/api/handlers/v3SimplerReplaced';

const CONVERT = '/looping/v3/simpler/replace_sample';
const CAPTURE = '/looping/v3/simpler/replace_sample_onto_track';

let seen: SimplerReplacedAck[];
let release: () => void;

beforeEach(() => {
	vi.clearAllMocks();
	// The registry is module-scoped, so each test takes its own array
	// and hands it back on teardown — otherwise a leftover watcher from
	// the previous test writes into this one's.
	seen = [];
	const mine = seen;
	release = addSimplerReplacedWatcher((ack) => mine.push(ack));
});

afterEach(() => release());

describe('handleV3SimplerReplaced', () => {
	it('address is stable', () => {
		expect(V3_SIMPLER_REPLACED_ADDRESS).toBe('/looping/v3/simpler/replaced');
	});

	it('fans the three args out to watchers', () => {
		handleV3SimplerReplaced([CONVERT, 'tracks/1/devices/0', '/tmp/sample.wav']);
		expect(seen).toEqual([
			{
				originAddress: CONVERT,
				devicePath: 'tracks/1/devices/0',
				filePath: '/tmp/sample.wav'
			}
		]);
	});

	it('carries the capture flow origin through unchanged', () => {
		handleV3SimplerReplaced([CAPTURE, 'tracks/2/devices/1', '/tmp/take1.wav']);
		expect(seen[0].originAddress).toBe(CAPTURE);
		expect(seen[0].devicePath).toBe('tracks/2/devices/1');
	});

	it('drops a short payload', () => {
		handleV3SimplerReplaced([CONVERT, 'tracks/1/devices/0']);
		expect(seen).toEqual([]);
		expect(logger.warn).toHaveBeenCalled();
	});

	it('drops an empty devicePath or filePath', () => {
		handleV3SimplerReplaced([CONVERT, '', '/tmp/sample.wav']);
		handleV3SimplerReplaced([CONVERT, 'tracks/1/devices/0', '']);
		expect(seen).toEqual([]);
	});

	it('a released watcher stops hearing', () => {
		release();
		handleV3SimplerReplaced([CONVERT, 'tracks/1/devices/0', '/tmp/sample.wav']);
		expect(seen).toEqual([]);
	});

	it('a throwing watcher does not starve the next one', () => {
		const after: SimplerReplacedAck[] = [];
		const releaseThrower = addSimplerReplacedWatcher(() => {
			throw new Error('boom');
		});
		const releaseAfter = addSimplerReplacedWatcher((ack) => after.push(ack));

		handleV3SimplerReplaced([CONVERT, 'tracks/1/devices/0', '/tmp/sample.wav']);

		releaseThrower();
		releaseAfter();
		expect(after).toHaveLength(1);
		expect(logger.warn).toHaveBeenCalled();
	});
});
