/**
 * The Tone Shaper relay (handlers/toneShaper.js): every device's frames
 * arrive on one port; only the ones a client watches go on.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const nodeRequire = createRequire(import.meta.url);
const { createToneShaper, FRAME_ADDRESS } = nodeRequire('../../../../bridge/handlers/toneShaper.js');

const frame = (path: string) => ({ address: FRAME_ADDRESS, args: [path, ...Array(118).fill(0)] });

describe('createToneShaper', () => {
	it('drops every frame until a client watches that device, then relays it', () => {
		const relay = createToneShaper();
		expect(relay.onDeviceMessage(frame('tracks/0/devices/1'))).toBe(true);
		relay.watch('client_a', 'tracks/0/devices/1');
		expect(relay.onDeviceMessage(frame('tracks/0/devices/1'))).toBe(false);
		expect(relay.onDeviceMessage(frame('tracks/2/devices/0'))).toBe(true);
	});

	it('keeps a device watched while any client looks at it', () => {
		const relay = createToneShaper();
		relay.watch('a', 'tracks/0/devices/1');
		relay.watch('b', 'tracks/0/devices/1');
		relay.watch('a', '');
		expect(relay.isWatched('tracks/0/devices/1')).toBe(true);
		relay.forget('b');
		expect(relay.isWatched('tracks/0/devices/1')).toBe(false);
		expect(relay.watchedPaths()).toEqual([]);
	});

	it('a client watches one device at a time, and a non-string watch is none', () => {
		const relay = createToneShaper();
		relay.watch('a', 'tracks/0/devices/1');
		relay.watch('a', 'tracks/3/devices/0');
		expect(relay.watchedPaths()).toEqual(['tracks/3/devices/0']);
		relay.watch('a', 7);
		expect(relay.watchedPaths()).toEqual([]);
	});

	it('lets every other address through', () => {
		const relay = createToneShaper();
		expect(relay.onDeviceMessage({ address: '/toneshaper/hello', args: [] })).toBe(false);
	});
});
